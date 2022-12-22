'use strict';

const utils         = require('@iobroker/adapter-core');
const twinkly       = require('./lib/twinkly');
const apiObjectsMap = require('./lib/twinklyApi2Objects').apiObjectsMap;
const twinklyMovies = require('./lib/twinklyMovies');
const stateTools    = require('./lib/stateTools');
const tools         = require('./lib/tools');

// TODO: uploadMovie, LEDMovieConfig, sendRealtimeFrame, Summary, Mic, Music

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

/**
 * Interval für das Polling
 */
let pollingInterval = null;

/**
 * Twinkly-Verbindungen
 * @type {{[x: string]: {enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly}}}
 */
const connections = {};

/**
 * Sentry Messages
 * @type {string[]}}
 */
const sentryMessages = [];

/**
 * Liste aller States
 * @type {{[x: string]: {connection: String, group: String, command: String}}}
 */
const subscribedStates = {};

/**
 * Let commands only run once at startup
 * @type {boolean}
 */
let initializing = true;

/**
 * Anzulegende States
 * @type {String[]}
 */
const statesConfig = [
    apiObjectsMap.connected.id,
    apiObjectsMap.firmware.parent.id,
    apiObjectsMap.ledBri.parent.id,
    apiObjectsMap.ledColor.parent.id,
    // apiObjectsMap.ledConfig.id,
    apiObjectsMap.ledEffect.parent.id,
    // apiObjectsMap.ledLayout.parent.id, //Prüfen, weshalb es nicht klappt
    apiObjectsMap.ledMode.parent.id,
    apiObjectsMap.ledMovie.parent.id,
    apiObjectsMap.ledSat.parent.id,
    apiObjectsMap.name.parent.id,
    apiObjectsMap.on.id,
    apiObjectsMap.paused.id,
    apiObjectsMap.ledPlaylist.parent.id,
    apiObjectsMap.timer.parent.id
];

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: 'twinkly'});

    adapter = new utils.Adapter(options)
        .on('ready', main)
        .on('stateChange', stateChange)
        .on('message', processMessage)
        .on('unload', onStop);

    return adapter;
}

async function stateChange(id, state) {
    if (state) {
        if (state.ack) return;

        // The state was changed
        adapter.log.debug(`[stateChange] state ${id} changed: ${state.val} (ack = ${state.ack})`);

        // Ist der state bekannt?
        if (!Object.keys(subscribedStates).includes(id)) {
            adapter.log.warn(`State ${id} is not writable, will not be processed!`);
            return;
        }

        const connectionName = subscribedStates[id].connection;
        const group          = subscribedStates[id].group;
        const command        = subscribedStates[id].command;

        let connection;
        try {
            if (command === apiObjectsMap.paused.id) {
                connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});

                if (connection.paused !== state.val) {
                    connection.paused = state.val;

                    if (!connection.paused)
                        startInterval(1000, connectionName);
                    return;
                }
            }

            connection = await getConnection(connectionName, {checkConnected: true});
        } catch (e) {
            adapter.log.debug(`[stateChange] ${e.message}`);
            return;
        }

        const pollFilter = [];

        // LED Brightness
        if (!group && command === apiObjectsMap.ledBri.parent.id) {
            pollFilter.push(command);

            if (state.val === -1) {
                try {
                    await connection.twinkly.setBrightnessDisabled();
                } catch (e) {
                    adapter.log.error(`[${connectionName}.${command}] Could not disable! ${e}`);
                }
            } else {
                try {
                    await connection.twinkly.setBrightnessAbsolute(state.val);
                } catch (e) {
                    adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
                }
            }

            // LED Color (mode = color)
        } else if (group && group === apiObjectsMap.ledColor.parent.id) {
            pollFilter.push(group);
            let changeMode = false;

            try {
                if ([apiObjectsMap.ledColor.child.hue.id, apiObjectsMap.ledColor.child.saturation.id, apiObjectsMap.ledColor.child.value.id].includes(command)) {
                    /** @type {{hue: Number, saturation: Number, value: Number}} */
                    const json = {hue: 0, saturation: 0, value: 0};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.ledColor.child, {
                        id: command,
                        val: state.val
                    });

                    await connection.twinkly.setLEDColorHSV(json.hue, json.saturation, json.value);
                    changeMode = connection.twinkly.ledMode !== twinkly.lightModes.value.color;

                } else if ([apiObjectsMap.ledColor.child.red.id, apiObjectsMap.ledColor.child.green.id, apiObjectsMap.ledColor.child.blue.id, apiObjectsMap.ledColor.child.white.id, apiObjectsMap.ledColor.child.hex.id].includes(command)) {
                    /** @type {{red: Number, green: Number, blue: Number, white: Number}} */
                    const json = {red: 0, green: 0, blue: 0, white: -1};

                    if ([apiObjectsMap.ledColor.child.red.id, apiObjectsMap.ledColor.child.green.id, apiObjectsMap.ledColor.child.blue.id, apiObjectsMap.ledColor.child.white.id].includes(command)) {
                        await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.ledColor.child, {
                            id: command,
                            val: state.val
                        });

                    } else {
                        const hexRgb = tools.hexToRgb(state.val);
                        json.red   = hexRgb.r;
                        json.green = hexRgb.g;
                        json.blue  = hexRgb.b;
                    }

                    await connection.twinkly.setLEDColorRGBW(json.red, json.green, json.blue, json.white);
                    changeMode = connection.twinkly.ledMode !== twinkly.lightModes.value.color;
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e}`);
            }

            try {
                if (changeMode && adapter.config.switchMode) {
                    pollFilter.push(apiObjectsMap.ledMode.parent.id);
                    await connection.twinkly.setLEDMode(twinkly.lightModes.value.color);
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${group}.${command}] Could not change Mode! ${e}`);
            }

            // LED Config
        } else if (!group && command === apiObjectsMap.ledConfig.id) {
            pollFilter.push(command);

            try {
                await connection.twinkly.setLEDConfig(state.val);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            // LED Effect
        } else if (!group && command === apiObjectsMap.ledEffect.parent.id) {
            pollFilter.push(command);
            let changeMode = false;

            try {
                if (!Object.keys(connection.twinkly.ledEffects).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Effect ${state.val} does not exist!`);
                } else {
                    await connection.twinkly.setCurrentLEDEffect(state.val);
                    changeMode = connection.twinkly.ledMode !== twinkly.lightModes.value.effect;
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            try {
                if (changeMode && adapter.config.switchMode) {
                    pollFilter.push(apiObjectsMap.ledMode.parent.id);
                    await connection.twinkly.setLEDMode(twinkly.lightModes.value.effect);
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not change Mode! ${e}`);
            }

            // LED Layout
        } else if (group && group === apiObjectsMap.ledLayout.parent.id) {
            pollFilter.push(group);

            /** @type {{aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean}} */
            const json = {aspectXY: 0, aspectXZ: 0, coordinates: [], source: '', synthesized: false};
            await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.ledLayout.child, {id: command, val: state.val});

            try {
                await connection.twinkly.uploadLayout(json.aspectXY, json.aspectXZ, json.coordinates, json.source, json.synthesized);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e}`);
            }

            // LED Mode
        } else if (!group && command === apiObjectsMap.ledMode.child.mode.id) {
            pollFilter.push(apiObjectsMap.ledMode.parent.id);

            try {
                if (!Object.values(twinkly.lightModes.value).includes(state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Could not set ${state.val}! Mode does not exist!`);

                } else if (state.val === twinkly.lightModes.value.movie && Object.keys(connection.twinkly.ledMovies).length === 0) {
                    adapter.log.warn(`[${connectionName}.${command}] Could not set Mode ${twinkly.lightModes.text.movie}! No movie available! Is a Effect/Playlist selected?`);
                    pollFilter.push(apiObjectsMap.ledMovie.parent.id);

                } else if (state.val === twinkly.lightModes.value.playlist && Object.keys(connection.twinkly.playlist).length === 0) {
                    adapter.log.warn(`[${connectionName}.${command}] Could not set Mode ${twinkly.lightModes.text.playlist}! No movie available! Is a Playlist created?`);
                    pollFilter.push(apiObjectsMap.ledPlaylist.parent.id);

                } else {
                    await connection.twinkly.setLEDMode(state.val);
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            // LED Saturation
        } else if (!group && command === apiObjectsMap.ledSat.parent.id) {
            pollFilter.push(command);

            if (state.val === -1) {
                try {
                    await connection.twinkly.setSaturationDisabled();
                } catch (e) {
                    adapter.log.error(`[${connectionName}.${command}] Could not disable! ${e}`);
                }
            } else {
                try {
                    await connection.twinkly.setSaturationAbsolute(state.val);
                } catch (e) {
                    adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
                }
            }

            // LED Movie
        } else if (!group && command === apiObjectsMap.ledMovie.parent.id) {
            pollFilter.push(command);
            let changeMode = false;

            try {
                if (!Object.keys(connection.twinkly.ledMovies).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Movie ${state.val} does not exist!`);
                } else {
                    await connection.twinkly.setCurrentMovie(state.val);
                    changeMode = connection.twinkly.ledMode !== twinkly.lightModes.value.movie;
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            try {
                if (changeMode && adapter.config.switchMode) {
                    pollFilter.push(apiObjectsMap.ledMode.parent.id);
                    await connection.twinkly.setLEDMode(twinkly.lightModes.value.movie);
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not change Mode! ${e}`);
            }

            // LED Playlist
        } else if (!group && command === apiObjectsMap.ledPlaylist.parent.id) {
            pollFilter.push(command);
            let changeMode = false;

            try {
                if (!Object.keys(connection.twinkly.playlist).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Playlist ${state.val} does not exist!`);
                } else {
                    await connection.twinkly.setCurrentPlaylistEntry(state.val);
                    changeMode = connection.twinkly.ledMode !== twinkly.lightModes.value.playlist;
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            try {
                if (changeMode && adapter.config.switchMode) {
                    pollFilter.push(apiObjectsMap.ledMode.parent.id);
                    await connection.twinkly.setLEDMode(twinkly.lightModes.value.playlist);
                }
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not change Mode! ${e}`);
            }

            // MQTT anpassen
        } else if (group && group === apiObjectsMap.mqtt.parent.id) {
            pollFilter.push(group);

            /** @type {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean}} */
            const json = {broker_host: '', broker_port: 0, client_id: '', user: '', keep_alive_interval: 0, encryption_key_set: false};
            await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.mqtt.child, {id: command, val: state.val});

            try {
                await connection.twinkly.setMqttConfiguration(json);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e}`);
            }

            // Namen anpassen
        } else if (!group && command === apiObjectsMap.name.parent.id) {
            pollFilter.push(command, apiObjectsMap.details.parent.id);

            try {
                await connection.twinkly.setDeviceName(state.val);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            // NetworkStatus anpassen
        } else if (!group && command === apiObjectsMap.networkStatus.parent.id) {
            pollFilter.push('');
            // connection.twinkly.set_network_status(state.val)
            //     .catch(error => {
            //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
            //     });
        } else if (group && group === apiObjectsMap.networkStatus.parent.id) {
            pollFilter.push('');
            // const json = {};
            // await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.mqtt.child, {id: command, val: state.val});
            //
            // connection.twinkly.set_mqtt_str(JSON.stringify(json))
            //     .catch(error => {
            //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
            //     });

            // Gerät ein-/ausschalten
        } else if (!group && command === apiObjectsMap.on.id) {
            pollFilter.push(apiObjectsMap.ledMode.parent.id);

            try {
                let newMode;
                if (state.val) {
                    if (connection.modeOn === twinkly.STATE_ON_LASTMODE) {
                        newMode = connection.lastModeOn;
                    } else {
                        newMode = connection.modeOn;
                    }
                } else {
                    newMode = twinkly.lightModes.value.off;
                }

                await connection.twinkly.setLEDMode(newMode);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            // Reset
        } else if (!group && command === apiObjectsMap.reset.id) {
            try {
                await connection.twinkly.resetLED();
            } catch (e) {
                adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e}`);
            }

            // Timer anpassen
        } else if (group && group === apiObjectsMap.timer.parent.id) {
            pollFilter.push(group);

            /** @type {{time_now: Number, time_on: Number, time_off: Number, tz: String}} */
            const json = {time_now: -1, time_on: -1, time_off: -1, tz: ''};
            await getJSONStates(connectionName, connectionName + '.' + group, json, apiObjectsMap.timer.child, {id: command, val: state.val});

            try {
                // Prüfen ob Daten gesendet werden können
                if ((json.time_on > -1 && json.time_off > -1) || (json.time_on === -1 && json.time_off === -1)) {
                    await connection.twinkly.setTimer(json);
                } else
                    adapter.log.debug(`[stateChange] Timer kann noch nicht übermittelt werden: (${json.time_on} > -1 && ${json.time_off} > -1) || (${json.time_on} === -1 && ${json.time_off} === -1)`);
            } catch (e) {
                adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e.message}`);
            }
        }

        startInterval(1000, connectionName, pollFilter);
    } else {
        // The state was deleted
        adapter.log.debug(`[stateChange] state ${id} deleted`);
    }
}

/**
 * Polling auf alle Verbindungen ausführen
 * @param {string} specificConnection
 * @param {string[]} filter
 * @returns {Promise<void>}
 */
async function poll(specificConnection = '', filter = []) {
    clearInterval();

    /**
     * Check if Command can be executed
     * @param command
     * @return {boolean}
     */
    function canExecuteCommand(command) {
        return statesConfig.includes(command) && (filter.length === 0 || filter.includes(command));
    }

    let deviceConnected = false;

    adapter.log.debug(`[poll] Start polling...`);
    adapter.log.silly(`[poll] specificConnection: ${specificConnection}, filter: ${filter}`);
    try {
        for (const connectionName of Object.keys(connections)) {
            // Falls gefüllt nur bestimmte Connection abfragen...
            if (specificConnection !== '' && connectionName !== specificConnection) continue;

            let connection;
            try {
                connection = await getConnection(connectionName, {checkConnected: true});
            } catch (e) {
                adapter.log.debug(`[poll] ${e.message}`);
                continue;
            }

            deviceConnected = true;

            await connection.twinkly.interview();

            // Only load at startup
            if (initializing) {
                await updateEffects(connectionName);
            }

            if (canExecuteCommand(apiObjectsMap.details.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.details.parent.id}`);

                try {
                    const response = await connection.twinkly.getDeviceDetails();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.details);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.details);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.details.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.firmware.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.firmware.parent.id}`);

                try {
                    const response = await connection.twinkly.getFirmwareVersion();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.firmware);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.firmware);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.firmware.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledBri.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledBri.parent.id}`);

                try {
                    const response = await connection.twinkly.getBrightness();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledBri);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledBri.child.value.id,
                                response.mode !== 'disabled' ? response.value : -1, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledBri.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledColor.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledColor.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDColor();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledColor);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledColor);

                        try {
                            // Hex Version
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledColor.parent.id + '.' + apiObjectsMap.ledColor.child.hex.id,
                                tools.rgbToHex(response.red, response.green, response.blue, false), true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledColor.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledConfig.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledConfig.id}`);

                try {
                    const response = await connection.twinkly.getLEDConfig();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledConfig);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledConfig.id, JSON.stringify(response.strings), true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledConfig.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledEffect.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledEffect.parent.id}`);

                try {
                    const response = await connection.twinkly.getCurrentLEDEffect();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledEffect);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledEffect);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledEffect.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledLayout.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledLayout.parent.id}`);

                try {
                    const response = await connection.twinkly.getLayout();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledLayout);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledLayout);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledLayout.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledMode.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledMode.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDMode();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledMode);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledMode);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.on.id, response.mode !== twinkly.lightModes.value.off, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledMode.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledMovie.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledMovie.parent.id}`);

                try {
                    // First update existing Movies...
                    await updateMovies(connectionName);
                    // ... then get current Movie
                    const response = await connection.twinkly.getCurrentMovie();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledMovie);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledMovie);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledMovie.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledPlaylist.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledPlaylist.parent.id}`);

                try {
                    // First update existing Playlist...
                    await updatePlaylist(connectionName);
                    // ... then get current Playlist Entry
                    const response = await connection.twinkly.getCurrentPlaylistEntry();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledPlaylist);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.ledPlaylist);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledPlaylist.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.ledSat.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.ledSat.parent.id}`);

                try {
                    const response = await connection.twinkly.getSaturation();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.ledSat);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledSat.child.value.id,
                                response.mode !== 'disabled' ? response.value : -1, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.ledSat.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.mqtt.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.mqtt.parent.id}`);

                try {
                    const response = await connection.twinkly.getMqttConfiguration();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.mqtt);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.mqtt);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.mqtt.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.name.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.name.parent.id}`);

                try {
                    const response = await connection.twinkly.getDeviceName();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.name);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.name);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.name.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.networkStatus.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.networkStatus.parent.id}`);

                try {
                    const response = await connection.twinkly.getNetworkStatus();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.networkStatus);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.networkStatus);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.networkStatus.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.status.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.status.id}`);

                try {
                    const response = await connection.twinkly.getStatus();
                    await checkTwinklyResponse(connectionName, response.status, apiObjectsMap.status);
                    await saveJSONinState(connectionName, connectionName, response.status, apiObjectsMap.status);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.status.id} ${e}`);
                }
            }

            if (canExecuteCommand(apiObjectsMap.timer.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.timer.parent.id}`);

                try {
                    const response = await connection.twinkly.getTimer();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response, apiObjectsMap.timer);
                        await saveJSONinState(connectionName, connectionName, response, apiObjectsMap.timer);
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${apiObjectsMap.timer.parent.id} ${e}`);
                }
            }
        }
    } catch (e) {
        adapter.log.error(e);
    }

    adapter.log.debug(`[poll] Finished polling...`);

    // Set Connection Status, at least one connection is active
    if (specificConnection === '') {
        adapter.setState('info.connection', deviceConnected, true);
    }

    startInterval(adapter.config.interval * 1000);
}

async function main() {
    adapter.subscribeStates('*');

    adapter.getState('info.connection', (err, state) => {
        if (state) {
            adapter.setState('info.connection', false, true);
        }
    });

    // Set Config Default Values
    adapter.config.interval = adapter.config.interval < 15 ? 15 : adapter.config.interval;
    if (adapter.config.devices === undefined)
        adapter.config.devices = [];
    if (adapter.config.details === undefined)
        adapter.config.details = false;
    if (adapter.config.mqtt === undefined)
        adapter.config.mqtt = false;
    if (adapter.config.network === undefined)
        adapter.config.network = false;
    if (adapter.config.usePing === undefined)
        adapter.config.usePing = true;
    if (adapter.config.switchMode === undefined)
        adapter.config.switchMode = false;

    // States/Objekte anlegen...
    try {
        if (await syncConfig()) {
            await poll();
            initializing = false;
            adapter.log.info('Startup complete');
        } else {
            adapter.log.info('Polling was not started!');
        }
    } catch (e) {
        adapter.log.error(e);
        adapter.log.info('Polling was not started!');
    }
}

function onStop () {
    try {
        // Interval abbrechen
        clearInterval();

        // Alle Verbindungen abmelden...
        Object.keys(connections)
            .filter(connectionName => !connections[connectionName].paused)
            .forEach(async connectionName => {
                const connection = connections[connectionName];
                try {
                    await connection.twinkly.logout();
                } catch (e) {
                    adapter.log.error(`[onStop.${connection.twinkly.name}] ${e}`);
                }

                // Set connection status to false
                if (await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.connected.id)) {
                    await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.connected.id, false, true);
                }
            });

        // Set connection status to false
        adapter.setState('info.connection', false, true);

        adapter.log.info('cleaned everything up...');
    } catch (e) {
        adapter.log.error(`[onStop] ${e}`);
    }
}

/**
 *
 * @param {ioBroker.Message} obj
 */
async function processMessage(obj) {
    if (!obj || !obj.command) {
        return;
    }

    let returnMsg;

    /**
     * @param {{checkPaused?: Boolean, checkConnected?: Boolean, ignoreConnected?: Boolean}} options
     * @return {Promise<{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly}>}
     */
    async function getConnectionObj(options = {}) {
        if (obj.message && typeof obj.message === 'object') {
            try {
                return await getConnection(obj.message.connection, options);
            } catch (e) {
                returnMsg = e.message;
            }
        } else {
            returnMsg = 'Message has to be of type object!';
        }
    }

    adapter.log.info(`[processMessage.${obj.command}] ${JSON.stringify(obj.message).substring(0, 100)}`);
    try {
        switch (obj.command.toLowerCase()) {
            case 'uploadmovie': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object' && typeof obj.message.frames === 'object' && typeof obj.message.delay === 'number') {
                    returnMsg = await connection.twinkly.uploadMovie(obj.message.frames, obj.message.delay);
                }
                break;
            }
            case 'uploadtemplatemovie': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object' && typeof obj.message.template === 'number') {
                    returnMsg = await uploadTemplateMovie(obj.message.connection, obj.message.template);
                }
                break;
            }
            case 'uploadtwinklemovie': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object' && typeof obj.message.baseColor !== 'undefined' && typeof obj.message.secondColor !== 'undefined') {
                    returnMsg = await uploadTwinkleMovie(obj.message.connection, obj.message.baseColor, obj.message.secondColor);
                }
                break;
            }
            case 'sendrealtimeframe': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object' && typeof obj.message.frame === 'object') {
                    returnMsg = await connection.twinkly.sendRealtimeFrame(obj.message.frame);
                }
                break;
            }
            case 'generateframe': {
                const connection = await getConnectionObj({checkPaused: false, ignoreConnected: true});
                if (connection && typeof obj.message === 'object') {
                    if (obj.message.color) {
                        returnMsg = connection.twinkly.generateFrame(obj.message.color);
                    } else if (obj.message.colors) {
                        returnMsg = connection.twinkly.generateFrames(obj.message.colors);
                    }
                }
                break;
            }
            default: {
                returnMsg = `Unknown command ${obj.command}!`;
                break;
            }
        }
    } catch (e) {
        adapter.log.error(`[processMessage.${obj.command}] ${e}`);
    }

    if (returnMsg) {
        adapter.log.info(`[processMessage.${obj.command}] ${JSON.stringify(returnMsg).substring(0, 100)}`);
        if (obj.callback) {
            adapter.sendTo(obj.from, obj.command, returnMsg, obj.callback);
        }
    }
}

/**
 * Konfiguration auslesen und verarbeiten
 * @return Promise<Boolean>
 */
async function syncConfig() {
    let result = true;

    // Details hinzufügen, wenn gewünscht
    if (adapter.config.details)
        statesConfig.push(apiObjectsMap.details.parent.id);
    // MQTT hinzufügen, wenn gewünscht
    if (adapter.config.mqtt)
        statesConfig.push(apiObjectsMap.mqtt.parent.id);
    // Network hinzufügen, wenn gewünscht
    if (adapter.config.network)
        statesConfig.push(apiObjectsMap.networkStatus.parent.id);
    // Movies nur im Debugger anlegen
    // statesConfig.push(apiObjectsMap.ledMovies.id);
    // // statesConfig.push(apiObjectsMap.status.id);

    try {
        adapter.log.debug('[syncConfig] config devices: '  + JSON.stringify(adapter.config.devices));
        adapter.log.debug('[syncConfig] config interval: ' + adapter.config.interval);
        adapter.log.debug('[syncConfig] config details: '  + adapter.config.details);
        adapter.log.debug('[syncConfig] config mqtt: '     + adapter.config.mqtt);
        adapter.log.debug('[syncConfig] config network: '  + adapter.config.network);

        if (adapter.config.devices.length === 0) {
            adapter.log.info('no connections added...');
            result = false;
        }

        // Verbindungen auslesen und erstellen
        if (result)
            for (const device of adapter.config.devices) {
                const deviceName = stateTools.removeForbiddenChars(device.name.trim() !== '' ? device.name : device.host).replace(/[.\s]+/g, '_');

                // Verbindung aktiviert?
                if (!device.enabled) {
                    adapter.log.debug(`[syncConfig] ${deviceName} deaktiviert... ${JSON.stringify(device)}`);
                    continue;
                }

                // Host gefüllt
                if (device.host === '') {
                    adapter.log.warn(`${deviceName}: Host nicht gefüllt!`);
                    continue;
                }

                // Verbindung anlegen
                if (Object.keys(connections).includes(deviceName)) {
                    adapter.log.warn(`Objects with same id = ${deviceName} created for two connections ${JSON.stringify(device)}`);
                } else {
                    connections[deviceName] = {
                        enabled    : device.enabled,
                        paused     : false,
                        modeOn     : device.stateOn && (Object.keys(twinkly.lightModes.value).includes(device.stateOn) || twinkly.STATE_ON_LASTMODE === device.stateOn) ?
                            device.stateOn : twinkly.lightModes.value.movie,
                        lastModeOn : twinkly.lightModes.value.movie,
                        connected  : false,
                        twinkly    : new twinkly.Twinkly(adapter, deviceName, device.host, onDataChange)
                    };

                    await loadTwinklyDataFromObjects(deviceName);
                }
            }

        // Prüfung ob aktive Verbindungen verfügbar sind
        if (result && Object.keys(connections).length === 0) {
            adapter.log.info('no enabled connections added...');
            result = false;
        }

        if (result) {
            // Create Instance Objects
            await processObjectChanges('');
        }
    } catch (e) {
        throw Error(e);
    }

    return result;
}

async function processObjectChanges(specificConnection) {
    adapter.log.debug('[processObjectChanges] Get existing objects');
    const _objects = await adapter.getAdapterObjectsAsync();

    function removeConnectionObjects(connection) {
        const connectionId = `${adapter.namespace}.${connection}`;
        Object.keys(_objects).forEach(id => {
            if (id === connectionId || id.startsWith(connectionId + '.')) {
                delete _objects[id];
            }
        });
    }

    if (specificConnection === '') {
        adapter.log.debug('[processObjectChanges] Remove all connections listed in config ==> Deletes all old connections');
        Object.keys(connections).forEach(connection => {
            removeConnectionObjects(connection);
        });
    } else {
        adapter.log.debug('[processObjectChanges] Filter the objects for the specific connection');
        Object.keys(connections).filter(connection => connection !== specificConnection).forEach(connection => {
            removeConnectionObjects(connection);
        });
    }

    /** @type {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}[]} */
    const preparedObjects = [];

    adapter.log.debug('[processObjectChanges] Add instance objects');
    prepareInstanceObjects(preparedObjects);

    if (specificConnection !== '') {
        adapter.log.debug('[processObjectChanges] Prepare connection objects');
        await prepareObjectsByConfig(preparedObjects, specificConnection);
    }

    adapter.log.debug('[processObjectChanges] Prepare tasks of objects update');
    const tasks = prepareTasks(preparedObjects, _objects);

    if (tasks.length === 0) {
        adapter.log.debug('[processObjectChanges] No tasks to process!');
        return;
    }

    adapter.log.debug('[processObjectChanges] Start tasks of objects update');
    try {
        await processTasks(tasks);
        adapter.log.debug('[processObjectChanges] Finished tasks of objects update');
    } catch (e) {
        throw Error(e);
    }
}

/**
 * Konfiguration aufbereiten um die States/Objekte anzulegen
 * @param {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}[]} preparedObjects
 * @param {string} specificConnection
 */
async function prepareObjectsByConfig(preparedObjects, specificConnection) {
    /**
     * @param {{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly}} connection
     * @param {{id: string, type: string, common: {}, native: {}, exclude: string[]}} obj
     * @param {{id: string, name: string, write?: boolean, writeSlave?: boolean, type?: string, role?: string, unit?: string, min?: number, max?: number, def?: any, states?: Record<string, string> | string[], native?: {[key: string] : string}}} config
     * @param {Boolean} displayPrevName
     * @param {{id: string, type: string, common: {}, native: {}, exclude: string[]}} prevChannel
     */
    async function setCommonNative(connection, obj, config, displayPrevName, prevChannel) {
        // Set default values
        config.write = typeof config.write !== 'undefined' ? config.write : false;
        config.type  = typeof config.type  !== 'undefined' ? config.type  : 'string';
        config.role  = typeof config.role  !== 'undefined' ? config.role  : 'state';

        if (typeof config.def === 'undefined') {
            if (config.type === 'string') {
                config.def = '';
            } else if (config.type === 'number') {
                config.def = typeof config.min !== 'undefined' ? config.min : 0;
            } else if (config.type === 'boolean') {
                config.def = false;
            }
        }

        // Twinkly with group: Slave devices can only read
        let configWrite = config.write;
        if (configWrite && tools.versionGreaterEquals('2.8.3', connection.twinkly.firmware)) {
            if (await connection.twinkly.checkDetailInfo({name: 'group.mode', val: 'slave', type: 'eq'}) && !config.writeSlave) {
                configWrite = false;
            }
        }

        obj.common.name   = (displayPrevName && prevChannel.common ? prevChannel.common.name + ' ' : '') + (typeof config.name !== 'undefined' ? config.name : config.id);
        obj.common.read   = true;
        obj.common.write  = configWrite;
        obj.common.type   = config.type;
        obj.common.role   = config.role;
        obj.common.def    = config.def;

        if (config.type === 'number') {
            if (typeof config.min !== 'undefined') {
                obj.common.min = config.min;
            }
            if (typeof config.max !== 'undefined') {
                obj.common.max = config.max;
            }
        }

        if (typeof config.states !== 'undefined') {
            obj.common.states = config.states;
        }
        if (typeof config.unit !== 'undefined') {
            obj.common.unit = config.unit;
        }

        // Write default native values
        if (typeof config.native !== 'undefined') {
            Object.entries(config.native).forEach(([key, type]) => {
                let found = false;
                if (type === 'string') {
                    obj.native[key] = '';
                    found = true;
                } else if (type === 'number') {
                    obj.native[key] = 0;
                    found = true;
                } else if (type === 'boolean') {
                    obj.native[key] = false;
                    found = true;
                }

                if (found) {
                    obj.exclude.push(key);
                }
            });
        }
    }

    /**
     * @param {{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly}} connection
     * @param {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}} config
     * @param {{}} states
     * @param {Boolean} root
     * @param {Boolean} displayPrevName
     * @param {{id: string, type: string, common: {}, native: {}, exclude: string[]}} prevChannel
     */
    async function prepareConfig(connection, config, states, root, displayPrevName, prevChannel) {
        for (const state of Object.keys(states)) {
            try {
                if (root) {
                    if (states[state].parent !== undefined) {
                        if (!statesConfig.includes(states[state].parent.id)) continue;
                    } else {
                        if (!statesConfig.includes(states[state].id)) continue;
                    }
                }

                /** @type {{id: string, type: string, common: {}, native: {}, exclude: string[]}} */
                const stateObj = {
                    id          : stateTools.removeForbiddenChars(prevChannel.id),
                    type        : 'state',
                    common      : {},
                    native      : {},
                    exclude     : [],
                };

                await setCommonNative(connection, stateObj, states[state].parent !== undefined ? states[state].parent : states[state], displayPrevName, prevChannel);

                if (!states[state].hide) {
                    if (states[state].parent !== undefined) {
                        if (await allowState(config.connection, states[state].parent, {hide: false, ignoreCreate: true})) {
                            if (states[state].child !== undefined && states[state].expandJSON) {
                                // Soll der Parent angezeigt werden
                                if (!states[state].parent.hide) {
                                    stateObj.type = 'channel';
                                    stateObj.id += '.' + states[state].parent.id;
                                    config.objects.push(stateObj);

                                    await prepareConfig(connection, config, states[state].child, false, true, stateObj);
                                } else {
                                    // Sonst States auf Grandparent erstellen
                                    await prepareConfig(connection, config, states[state].child, false, false, prevChannel);
                                }
                            } else {
                                stateObj.id += '.' + states[state].parent.id;
                                config.objects.push(stateObj);
                            }
                        }
                    } else if (await allowState(config.connection, states[state], {ignoreCreate: true})) {
                        stateObj.id += '.' + states[state].id;
                        config.objects.push(stateObj);
                        if (typeof states[state].exclude === 'object') {
                            for (const exclude of states[state].exclude) {
                                stateObj.exclude.push(exclude);
                            }
                        }
                    }
                }
            } catch (e) {
                throw Error(`[prepareConfig] ${state}: ${e}`);
            }
        }
    }

    // Add Connections Objects
    for (const connectionName of Object.keys(connections)) {
        if (specificConnection !== '' && specificConnection !== connectionName) continue;

        let connection;
        try {
            connection = await getConnection(connectionName, {checkPaused: false, checkConnected: true});
        } catch (e) {
            adapter.log.debug(`[prepareObjectsByConfig] ${e.message}`);
            continue;
        }

        // Interview
        try {
            // Interview to load details
            await connection.twinkly.interview();
        } catch (error) {
            adapter.log.error(`[prepareObjectsByConfig] Could not interview ${connectionName} ${error}`);
        }

        /**
         * @type {{id: string, type: string, common: {}, native: {}, exclude: string[]}}
         */
        const device = {
            id     : `${adapter.namespace}.${connectionName}`,
            type   : 'device',
            common : {name : connection.twinkly.name, statusStates: {
                onlineId: `${adapter.namespace}.${connectionName}.${apiObjectsMap.connected.id}`
            }},
            native  : {host : connection.twinkly.host},
            exclude : [],
        };

        /**
         * @type {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}}
         */
        const config = {connection : connectionName, objects : [device]};

        await prepareConfig(connection, config, apiObjectsMap, true, false, device);

        preparedObjects.push(config);
    }
}

/**
 * Get Instance Objects
 * @param {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}[]} preparedObjects
 */
function prepareInstanceObjects(preparedObjects) {
    /** @type {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}} */
    const instanceConfig = {connection: '', objects: []};

    if (typeof adapter.ioPack.instanceObjects === 'object') {
        adapter.ioPack.instanceObjects.forEach(obj => {
            /** @type {{id: string, type: string, common: {}, native: {}, exclude: string[]}} */
            const instanceObject = {id: `${adapter.namespace}.${obj._id}`, type : obj.type, common : {}, native : {}, exclude : []};
            tools.cloneObject(obj.common, instanceObject.common);
            tools.cloneObject(obj.native, instanceObject.native);

            instanceConfig.objects.push(instanceObject);
        });
    }

    preparedObjects.push(instanceConfig);
}

/**
 * prepareTasks
 * @param {{connection: string, objects: {id: string, type: string, common: {}, native: {}, exclude: string[]}[]}[]} preparedObjects
 * @param {Record<string, AdapterScopedObject>} oldObjects
 * @returns {{id: string, type: string, data: {common: {}, native: {}}}[]}
 */
function prepareTasks(preparedObjects, oldObjects) {
    const toUpdate = [];

    try {
        for (const connection of preparedObjects) {
            for (const obj of connection.objects) {
                const oldObj = oldObjects[obj.id];

                if (oldObj && oldObj.type === obj.type) {
                    if (!tools.areStatesEqual(oldObj, obj, obj.exclude)) {
                        toUpdate.push({
                            type : `update_${obj.type}`,
                            id   : obj.id,
                            data : {
                                common: obj.common,
                                native: obj.native
                            }
                        });
                    }
                    delete oldObjects[obj.id];
                } else {
                    toUpdate.push({
                        type  : `create_${obj.type}`,
                        id    : obj.id,
                        data  : {
                            common: obj.common,
                            native: obj.native
                        }
                    });
                }

                // Nur wenn der State bearbeitet werden darf hinzufügen
                if (obj.type === 'state') {
                    if (obj.common.write) {
                        addSubscribeState(obj.id);
                    } else {
                        delete subscribedStates[obj.id];
                    }
                }
            }
        }
    } catch (e) {
        adapter.log.error(e.name + ': ' + e.message);
    }

    const toDelete = Object.entries(oldObjects).map(([id, obj]) => ({id: id, type: `delete_${obj.type}`, data: {common: {}, native: {}}}));

    return toDelete.concat(toUpdate);
}

function addSubscribeState(state) {
    if (!state.startsWith(adapter.namespace)) {
        state = adapter.namespace + '.' + state;
    }

    const stateId    = state.split('.').splice(2); // Remove AdapterNamespace
    const connection = stateId.shift();                         // First is connection
    const command    = stateId.pop();                           // Last is command
    const group      = stateId.join('.');                       // Rest is group

    subscribedStates[state] = {connection: connection, group: group, command: command};
}

/**
 * processTasks
 * @param {{id: string, type: String, data: {common: {}, native: {}}}[]} tasks
 */
async function processTasks(tasks) {
    while (tasks.length > 0) {
        const task = tasks.shift();

        try {
            adapter.log.debug('[processTasks] Task: ' + JSON.stringify(task));

            const taskType = task.type.split('_');
            if (taskType.length !== 2) {
                adapter.log.debug(`[processTasks] Task type is invalid: ${task.type}`);
                continue;
            }

            switch (taskType[0]) {
                case 'create': {
                    await adapter.setObjectNotExistsAsync(task.id, {type: taskType[1], common: task.data.common, native: task.data.native});

                    if (taskType[1] === 'state') {
                        if (task.data.common.def !== undefined) {
                            await adapter.setStateAsync(task.id, task.data.common.def, true);
                        } else {
                            await adapter.setStateAsync(task.id, null, true);
                        }
                    }
                    break;
                }
                case 'update': {
                    await adapter.extendObject(task.id, task.data);
                    break;
                }
                case 'delete': {
                    await adapter.delObject(task.id);
                    break;
                }
            }
        } catch (e) {
            adapter.log.error(`Cannot ${task.type}: ${task.id}, Error: ${e.message}`);
        }
    }
}

/**
 * Save States from JSON
 * @param {String} connectionName
 * @param {String} state
 * @param {{} | undefined} json
 * @param {{id: string, name: string, hide?: boolean} |
 *         {parent: {id: string, name: string, hide?: boolean},
 *          child: {}, expandJSON: boolean, logItem?: boolean, hide?: boolean}} mapping
 */
async function saveJSONinState(connectionName, state, json, mapping) {
    if (typeof json === 'undefined') return;

    mapping.logItem = mapping.logItem !== undefined && mapping.logItem === true;
    if (mapping.hide) return;

    /**
     *
     * @param {String} id
     * @param {{hide?: Boolean; filter?: {detail?: {name: String, val: any}, mode?: string}, role?: string, type?: string}} stateInfo
     * @param {any} value
     * @param {Boolean} stringify
     */
    async function writeState(id, stateInfo, value, stringify) {
        if (!await allowState(connectionName, stateInfo, {ignoreCreate: true})) return;

        if (!stringify) {
            // Unix * 1000
            if (stateInfo.role === 'value.time')
                value = value * 1000;
            // number -> boolean
            if (stateInfo.type === 'boolean' && typeof value === 'number')
                value = value === 1;
        }

        try {
            await adapter.setStateAsync(id === state ? state : state + '.' + id, stringify ? JSON.stringify(value) : value, true);
        } catch (e) {
            //
        }
    }

    if (mapping.expandJSON) {
        if (!mapping.parent.hide) {
            state += '.' + mapping.parent.id;
            await writeState(state, mapping.parent, json, true);
        }

        // Save states from json
        for (const key of Object.keys(json).filter(key => Object.keys(mapping.child).includes(key))) {
            if (typeof json[key] !== 'object' || Array.isArray(json[key])) {
                await writeState(mapping.child[key].id, mapping.child[key], json[key], Array.isArray(json[key]));
            } else {
                await saveJSONinState(connectionName, state, json[key], mapping.child[key]);
            }
        }

        // Set default states for missing items
        if (await allowState(connectionName, mapping.parent, {ignoreCreate: true})) {
            for (const key of Object.keys(mapping.child).filter(key => !Object.keys(json).includes(key))) {
                if (mapping.child[key].parent) {
                    await saveJSONinState(connectionName, state, {}, mapping.child[key]);
                } else if (mapping.child[key]) {
                    await writeState(mapping.child[key].id, mapping.child[key], mapping.child[key].def, false);
                }
            }
        }
    } else {
        await writeState(mapping.parent.id, mapping.parent, json, true);
    }

    if (mapping.logItem) {
        await handleSentryMessage(connectionName, 'saveJSONinState', 'logItem',
            `${connectionName}:${mapping.parent.id}`, `Log Response: ${connectionName}.${mapping.parent.id}`, 'info', json, 'query');
    }
}

/**
 * Check Twinkly response
 * @param {String} connectionName
 * @param {{} | undefined} response
 * @param {{id: string, name: string, hide?: boolean} |
 *         {parent: {id: string, name: string, hide?: boolean},
 *          child: {}, expandJSON: boolean, logItem?: boolean, hide?: boolean}} mapping
 */
async function checkTwinklyResponse(connectionName, response, mapping) {
    try {
        const name = mapping.parent ? mapping.parent.id : mapping.id;

        // check newSince
        await checkTwinklyResponseNewSince(connectionName, name, response, mapping, true);
        // check deprecated
        await checkTwinklyResponseDeprecated(connectionName, name, response, mapping);
    } catch (e) {
        adapter.log.error(`[checkTwinklyResponse.${connectionName}] ${e.message}`);
    }
}

/**
 * Check Twinkly response for changes newSince
 * @param {String} connectionName
 * @param {String} name
 * @param {{} | undefined} response
 * @param {{id: string, name: string, hide?: boolean} |
 *         {parent: {id: string, name: string, hide?: boolean},
 *          child: {}, expandJSON: boolean, logItem?: boolean, hide?: boolean}} mapping
 * @param {boolean} root
 */
async function checkTwinklyResponseNewSince(connectionName, name, response, mapping, root) {
    if (typeof response === 'undefined' || typeof response !== 'object') return;

    for (const key of Object.keys(response)) {
        if (mapping.child && Object.keys(mapping.child).includes(key)) {
            if (typeof response[key] !== 'object' || !Array.isArray(response[key])) {
                let continueCheck;
                if (mapping.child[key].parent !== undefined) {
                    continueCheck = await allowState(connectionName, mapping.child[key].parent, {hide: false, ignoreDeprecated: true, ignoreNewSince: true, filter: false, newSince: false});
                } else {
                    continueCheck = await allowState(connectionName, mapping.child[key], {hide: false, ignoreDeprecated: true, ignoreNewSince: true, filter: false, newSince: false});
                }

                if (continueCheck) {
                    await checkTwinklyResponseNewSince(connectionName, name + '.' + key, response[key], mapping.child[key], false);
                } else {
                    await handleSentryMessage(connectionName, 'checkTwinklyResponse', 'reintroduced', `${connectionName}:${name}:${key}`,
                        `Item reintroduced: ${connectionName}.${name}.${key}`, 'warning', {[typeof response[key]]: response[key]}, 'query');
                }
            }
            // Im Root der Response liegt die Property "code", die ignoriert werden kann
        } else if (!root || key !== 'code') {
            await handleSentryMessage(connectionName, 'checkTwinklyResponse', 'newSince', `${connectionName}:${name}:${key}`,
                `New Item detected: ${connectionName}.${name}.${key}`, 'warning', {[typeof response[key]]: response[key]}, 'query');
        }
    }
}

/**
 * Check Twinkly response for changes deprecated
 * @param {String} connectionName
 * @param {String} name
 * @param {{} | undefined} response
 * @param {{id: string, name: string, hide?: boolean} |
 *         {parent: {id: string, name: string, hide?: boolean},
 *          child: {}, expandJSON: boolean, logItem?: boolean, hide?: boolean}} mapping
 */
async function checkTwinklyResponseDeprecated(connectionName, name, response, mapping) {
    if (typeof response === 'undefined') return;
    if (typeof mapping.parent === 'undefined') return;

    for (const child of Object.keys(mapping.child)) {
        if (Object.keys(response).includes(child)) {
            await checkTwinklyResponseDeprecated(connectionName, name + '.' + child, response[child], mapping.child[child]);
        } else {
            let canHandle;
            if (mapping.child[child].parent) {
                canHandle = await allowState(connectionName, mapping.child[child].parent, {hide: false, ignoreDeprecated: true});
            } else {
                canHandle = await allowState(connectionName, mapping.child[child], {hide: false, ignoreDeprecated: true});
            }

            if (canHandle) {
                await handleSentryMessage(connectionName, 'checkTwinklyResponse', 'deprecated', `${connectionName}:${name}:${child}`,
                    `Item deprecated: ${connectionName}.${name}.${child}`, 'warning');
            }
        }
    }
}

/**
 * Get States in JSON
 * @param {String} connectionName
 * @param {String} stateId
 * @param {{}} json
 * @param {{id: String, val: any}} lastState
 * @param {{}} mapping
 */
async function getJSONStates(connectionName, stateId, json, mapping, lastState) {
    for (const key of Object.keys(mapping)) {
        if (Object.keys(json).includes((key))) {
            // Check LastState first
            if (lastState && mapping[key].id === lastState.id)
                json[key] = lastState.val;
            else {
                if (await allowState(connectionName, mapping[key], {ignoreCreate: true})) {
                    try {
                        const state = await adapter.getStateAsync(stateId + '.' + mapping[key].id);
                        json[key] = state ? state.val : '';
                    } catch (e) {
                        json[key] = '';
                    }
                }
            }
        }
    }
}

/**
 * @param {String} connectionName
 * @param {{hide: Boolean, filter?: {detail?: {name: String, val: any}, mode?: string, family?: String}, ignore?: {deprecated?: boolean, newSince?: boolean, create?: boolean}, deprecated?: String, newSince?: String, hint?: string}} stateInfo
 * @param {{hide?: boolean, filter?: boolean, deprecated?: boolean, newSince?: boolean, ignoreDeprecated?: boolean, ignoreNewSince?: boolean, ignoreCreate?: boolean}} checks
 */
async function allowState(connectionName, stateInfo, checks = {}) {
    let connection;
    try {
        connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});
    } catch (e) {
        adapter.log.debug(`[allowState.${connectionName}] ${e.message}`);
        return false;
    }

    checks.hide = typeof checks.hide !== 'undefined' ? checks.hide : true;
    checks.ignoreDeprecated = typeof checks.ignoreDeprecated !== 'undefined' ? checks.ignoreDeprecated : false;
    checks.ignoreNewSince = typeof checks.ignoreNewSince !== 'undefined' ? checks.ignoreNewSince : false;
    checks.ignoreCreate = typeof checks.ignoreCreate !== 'undefined' ? checks.ignoreCreate : false;
    checks.filter = typeof checks.filter !== 'undefined' ? checks.filter : true;
    checks.deprecated = typeof checks.deprecated !== 'undefined' ? checks.deprecated : true;
    checks.newSince = typeof checks.newSince !== 'undefined' ? checks.newSince : true;

    let result = !checks.hide || !stateInfo.hide;
    if (checks.filter && stateInfo.filter) {
        if (result && stateInfo.filter.detail)
            result = await connection.twinkly.checkDetailInfo(stateInfo.filter.detail);
        if (result && stateInfo.filter.mode)
            result = connection.twinkly.ledMode === stateInfo.filter.mode;
        if (result && stateInfo.filter.family)
            result = stateInfo.filter.family === connection.twinkly.details.fw_family;
    }
    if (stateInfo.ignore) {
        if (result && checks.ignoreDeprecated)
            result = !stateInfo.ignore.deprecated;
        if (result && checks.ignoreNewSince)
            result = !stateInfo.ignore.newSince;
        if (!result && checks.ignoreCreate && stateInfo.ignore.create)
            result = true;
    }
    if (result && checks.deprecated && stateInfo.deprecated)
        result = !connection.twinkly.isFirmwareEmpty() && tools.versionGreater(connection.twinkly.firmware, stateInfo.deprecated);
    if (result && checks.newSince && stateInfo.newSince)
        result = !connection.twinkly.isFirmwareEmpty() && tools.versionLowerEquals(connection.twinkly.firmware, stateInfo.newSince);

    return result;
}

/**
 * Update DP States from effects
 * @param connectionName
 * @return {Promise<void>}
 */
async function updateEffects(connectionName) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[updateEffects.${connectionName}] ${e.message}`);
        return;
    }

    try {
        await connection.twinkly.getListOfLEDEffects();
    } catch (e) {
        adapter.log.error(`[updateEffects.${connectionName}] Could not get effects! ${e.message}`);
        return;
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + apiObjectsMap.ledEffect.child.preset_id.id, connection.twinkly.ledEffects);
    } catch (e) {
        adapter.log.error(`[updateEffects.${connectionName}] Cannot update effects! ${e.message}`);
    }
}

/**
 * Update DP States from movies
 * @param connectionName
 * @return {Promise<void>}
 */
async function updateMovies(connectionName) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[updateMovies.${connectionName}] ${e.message}`);
        return;
    }

    try {
        const response = await connection.twinkly.getListOfMovies();
        if (statesConfig.includes(apiObjectsMap.ledMovies.id)) {
            try {
                await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledMovies.id, JSON.stringify(response.movies), true);
            } catch (e) {
                //
            }
        }
    } catch (e) {
        adapter.log.error(`[updateMovies.${connectionName}] Could not get movies ${e}`);
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + apiObjectsMap.ledMovie.child.id.id, connection.twinkly.ledMovies);
    } catch (e) {
        adapter.log.error(`[updateMovies.${connectionName}] Cannot update movies! ${e.message}`);
    }
}

/**
 * Update DP States from playlist
 * @param connectionName
 * @return {Promise<void>}
 */
async function updatePlaylist(connectionName) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[updatePlaylist.${connectionName}] ${e.message}`);
        return;
    }

    try {
        await connection.twinkly.getPlaylist();
    } catch (e) {
        adapter.log.error(`[updatePlaylist.${connectionName}] Could not get playlist ${e}`);
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + apiObjectsMap.ledPlaylist.child.id.id, connection.twinkly.playlist);
    } catch (e) {
        adapter.log.error(`[updatePlaylist.${connectionName}] Cannot update playlist! ${e.message}`);
    }
}

/**
 * @param {String} connectionName
 * @param {Number} template
 * @return {Promise<{code: Number}>}
 */
async function uploadTemplateMovie(connectionName, template) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[uploadRandomFrames.${connectionName}] ${e.message}`);
        return {code: twinkly.HTTPCodes.values.invalid};
    }

    let frames;
    switch (template) {
        case 0:
            frames = twinklyMovies.generateTwinkleBlueWhite(connection.twinkly);
            break;
        case 1:
            frames = twinklyMovies.generateTwinkleChristmasGreenRed(connection.twinkly);
            break;
        default:
            frames = [];
    }

    return await connection.twinkly.uploadMovie(frames, 250);
}

/**
 * @param {String} connectionName
 * @param {{r: number, g: number, b: number} | string} baseColor
 * @param {{r: number, g: number, b: number} | string} secondColor
 * @return {Promise<{code: Number}>}
 */
async function uploadTwinkleMovie(connectionName, baseColor, secondColor) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[uploadTwinkleMovie.${connectionName}] ${e.message}`);
        return {code: twinkly.HTTPCodes.values.invalid};
    }

    const frames = twinklyMovies.generateTwinkle(connection.twinkly, baseColor, secondColor);
    return await connection.twinkly.uploadMovie(frames, 250);
}

async function loadTwinklyDataFromObjects(connectionName) {
    let connection;
    try {
        connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});
    } catch (e) {
        adapter.log.debug(`[loadTwinklyDataFromObjects.${connectionName}] ${e.message}`);
        return;
    }

    try {
        // Does Connection exist?
        if (!await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.connected.id)) return;

        // paused
        const paused = await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.paused.id);
        if (paused) {
            connection.paused = paused.val;
            // Add State manually, otherwise it won't be added without first connect at startup, as state would be paused
            addSubscribeState(connectionName + '.' + apiObjectsMap.paused.id);
        }

        // lastModeOn
        const obj = await adapter.getObjectAsync(connectionName + '.' + apiObjectsMap.ledMode.child.mode.id);
        if (obj) {
            const lastModeOn = obj.native['lastModeOn'];
            if (typeof lastModeOn === 'string')
                connection.lastModeOn = lastModeOn;
        }
    } catch (e) {
        adapter.log.error(`[loadTwinklyDataFromObjects.${connectionName}] Cannot load data! ${e.message}`);
    }
}

/**
 * Data Change
 * @param {string} connectionName
 * @param {string} type
 * @param {any} val
 * @param {any} oldVal
 * @return {Promise<void>}
 */
async function onDataChange(connectionName, type, val, oldVal) {
    try {
        adapter.log.debug(`[onDataChange.${connectionName}] ${type} changed from ${oldVal} to ${val}`);

        switch (type) {
            case 'ledMode'   : await onModeChange(connectionName, val); break;
            case 'firmware'  : await processObjectChanges(connectionName); break;
            case 'groupMode' : await processObjectChanges(connectionName); break;
        }
    } catch (e) {
        adapter.log.error(`[onDataChange.${connectionName}] ${e.message}`);
    }
}

/**
 * Mode Change
 * @param {string} connectionName
 * @param {string} newMode
 * @return {Promise<void>}
 */
async function onModeChange(connectionName, newMode) {
    try {
        const connection = await getConnection(connectionName);

        if (newMode !== twinkly.lightModes.value.off) {
            connection.lastModeOn = newMode;

            try {
                await stateTools.updateObjectNative(adapter, connectionName + '.' + apiObjectsMap.ledMode.child.mode.id, {lastModeOn: newMode});
            } catch (e) {
                adapter.log.error(`[onModeChange.${connectionName}] Cannot update lastModeOn! ${e.message}`);
            }
        }

        // Check if it is a new ledMode
        if (!Object.values(twinkly.lightModes.value).includes(newMode)) {
            await handleSentryMessage(connectionName, 'onModeChange', 'ledMode', `${connectionName}:${newMode}`,
                'New ledMode found', 'warning', {'ledMode': newMode});
        }
    } catch (e) {
        adapter.log.error(`[onModeChange.${connectionName}] ${e.message}`);
    }
}

/**
 * Get Connection and check if it is connected
 * @param {String} connectionName
 * @param {{checkPaused?: Boolean, checkConnected?: Boolean, ignoreConnected?: Boolean}} options
 * @return {Promise<{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly}>}
 */
async function getConnection(connectionName, options = {}) {
    if (!Object.keys(connections).includes(connectionName))
        throw new Error(`${connectionName} not found!`);

    const connection = connections[connectionName];

    options.checkPaused = typeof options.checkPaused !== 'undefined' ? options.checkPaused : true;
    options.checkConnected = typeof options.checkConnected !== 'undefined' ? options.checkConnected : false;
    options.ignoreConnected = typeof options.ignoreConnected !== 'undefined' ? options.ignoreConnected : false;

    if ((typeof options.checkPaused === 'undefined' || options.checkPaused) && connection.paused) {
        throw new Error(`${connectionName} is paused!`);
    }
    if (options.checkConnected) {
        await checkConnection(connectionName);
    }
    if (!options.ignoreConnected && !connection.connected) {
        throw new Error(`${connectionName} not connected!`);
    }

    return connection;
}

/**
 * Check reachability of connection
 * @param {String} connectionName
 * @return {Promise<void>}
 */
async function checkConnection(connectionName) {
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    // Ping-Check
    connection.connected = await connection.twinkly.checkConnection(adapter.config.usePing);

    try {
        if (await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.connected.id)) {
            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.connected.id, connection.connected, true);
        }
    } catch (e) {
        //
    }

    if (!connection.connected) {
        adapter.log.debug(`[checkConnection] ${connectionName} is not available!`);
    }
}

/**
 * Handle Sentry Messages and check if already sent
 * @param {String} connectionName
 * @param {String} functionName
 * @param {string} category
 * @param {String} key
 * @param {String} message
 * @param {'fatal'|'error'|'warning'|'log'|'info'|'debug'} level
 * @param {{[key: string]: any}} data
 * @param {'default'|'debug'|'error'|'navigation'|'http'|'info'|'query'|'transaction'|'ui'|'user'} breadcrumbType
 */
async function handleSentryMessage(connectionName, functionName, category, key, message, level, data = {}, breadcrumbType = 'info') {
    // Don't handle Sentry Messages during startup
    if (initializing) return;

    // Anonymize Connection-Name
    key = key.replace(connectionName, '####');
    message = message.replace(connectionName, '');

    const tags = {};
    const details = {};
    try {
        const connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});
        // Sentry Tags
        tags['twFw']          = connection.twinkly.firmware;
        tags['twFwFamily']    = connection.twinkly.details.fw_family;
        tags['twProductCode'] = connection.twinkly.details.product_code;
        // Sentry Details
        details['LED Mode']    = connection.twinkly.ledMode;
        details['LED Profile'] = connection.twinkly.details.led_profile;

        // Export more information if unsure of the reason for deprecated/newSince
        if (category === 'deprecated') {
            // Add if needed...
            if (key.includes('details:group')) {
                details['Group'] = connection.twinkly.details.group;
            }
        }
    } catch (e) {
        //
    }

    const sentryKey = `${functionName}:${category}:${key}`;
    if (!sentryMessages.includes(sentryKey)) {
        sentryMessages.push(sentryKey);

        const functionMessage = `[${functionName}] ${message}`;

        const sentryObject = getSentryObject();
        if (typeof sentryObject !== 'undefined') {
            sentryObject.withScope(scope => {
                scope.setTags(tags);
                scope.setContext('details', details);

                if (typeof data === 'object' && Object.keys(data).length > 0) {
                    scope.addBreadcrumb({
                        type: breadcrumbType,
                        category: category,
                        level: level,
                        message: functionMessage,
                        data: data
                    });
                }

                if (level === 'fatal' || level === 'error') {
                    sentryObject.captureException(new Error(message));
                } else {
                    sentryObject.captureMessage(message, level);
                }
            });
        } else {
            adapter.log.info(`${functionMessage} --> Please notify the developer!`);
        }
    }

    adapter.log.debug(`[${sentryKey}] ${message}`);
}

/**
 * Restart Interval
 * @param {Number} interval Interval (ms)
 * @param {String} specificConnection
 * @param {String[]} filter
 */
function startInterval(interval, specificConnection = '', filter = []) {
    clearInterval();
    pollingInterval = setTimeout(async () => {
        await poll(specificConnection, filter);
    }, interval);
}

/**
 * Cancel active Interval
 */
function clearInterval() {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * Get Sentry Object
 * @returns {{captureMessage  : function(message: string, level?: 'fatal'|'error'|'warning'|'log'|'info'|'debug'),
 *            captureException: function(exception: string|Error),
 *            configureScope  : function(callback: (scope: {setUser: function(user: {id?: string, ip_address?: string, email?: string, username?: string} || null),
 *                                                          setTag : function(key: string, value: string),
 *                                                          setTags: function({[key: string]: string})
 *                                                  }) => void),
 *            withScope       : function(callback: (scope: {setUser      : function(user: {id?: string, ip_address?: string, email?: string, username?: string} || null),
 *                                                          setTag       : function(key: string, value: string),
 *                                                          setTags      : function({[key: string]: string}),
 *                                                          setContext   : function(key: string, context: {[key: string]: string}),
 *                                                          setLevel     : function(level: 'fatal'|'error'|'warning'|'log'|'info'|'debug'),
 *                                                          addBreadcrumb: function(breadcrumb: {type?: 'default'|'debug'|'error'|'navigation'|'http'|'info'|'query'|'transaction'|'ui'|'user',
 *                                                                                               level?: 'fatal'|'error'|'warning'|'log'|'info'|'debug',
 *                                                                                               event_id?: string, category?: string, message?: string, data?: {[key: string]: any}, timestamp?: number},
 *                                                                                  maxBreadcrumbs?: number)
 *                                                  }) => void)}
 *            | undefined}
 */
function getSentryObject() {
    if (adapter.supportsFeature && adapter.supportsFeature('PLUGINS')) {
        const sentryInstance = adapter.getPluginInstance('sentry');
        if (sentryInstance && sentryInstance.getSentryObject()) {
            return sentryInstance.getSentryObject();
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}