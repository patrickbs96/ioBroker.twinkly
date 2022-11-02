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
 * @type {{[x: string]: {enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly, dataLoadedOnInit: Boolean}}}
 */
const connections = {};

/**
 * Sentry
 * @type {{[x: string]: string}}
 */
const sentryMessages = {};

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
 * @type {[]}
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
            adapter.log.warn(`State ${id} unknown, will not be processed!`);
            return;
        }

        const connectionName = subscribedStates[id].connection;
        const group          = subscribedStates[id].group;
        const command        = subscribedStates[id].command;

        let connection;
        try {
            if (command === apiObjectsMap.paused.id) {
                connection = await getConnection(connectionName, {checkPaused: false});

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
                    changeMode = true;

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
                    changeMode = true;
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
                    changeMode = true;
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
            pollFilter.push('');
            let changeMode = false;

            try {
                if (!Object.keys(connection.twinkly.ledMovies).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Movie ${state.val} does not exist!`);
                    pollFilter.push(apiObjectsMap.ledMovie.parent.id);

                } else {
                    await connection.twinkly.setCurrentMovie(state.val);
                    changeMode = true;
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
            pollFilter.push('');
            let changeMode = false;

            try {
                if (!Object.keys(connection.twinkly.playlist).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                    adapter.log.warn(`[${connectionName}.${command}] Playlist ${state.val} does not exist!`);
                    pollFilter.push(apiObjectsMap.ledPlaylist.parent.id);
                } else {
                    await connection.twinkly.setCurrentPlaylistEntry(state.val);
                    changeMode = true;
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

            // Only load at startup
            if (initializing) {
                await updateEffects(connectionName);
            }

            if (canExecuteCommand(apiObjectsMap.details.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${apiObjectsMap.details.parent.id}`);

                try {
                    const response = await connection.twinkly.getDeviceDetails();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await checkTwinklyResponse(connectionName, response.details, apiObjectsMap.details);
                        await saveJSONinState(connectionName, connectionName, response.details, apiObjectsMap.details);
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
                        await checkTwinklyResponse(connectionName, response.firmware, apiObjectsMap.firmware);
                        await saveJSONinState(connectionName, connectionName, response.firmware, apiObjectsMap.firmware);
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
                        await checkTwinklyResponse(connectionName, response.bri, apiObjectsMap.ledBri);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledBri.child.value.id,
                                response.bri.mode !== 'disabled' ? response.bri.value : -1, true);
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
                        await checkTwinklyResponse(connectionName, response.color, apiObjectsMap.ledColor);
                        await saveJSONinState(connectionName, connectionName, response.color, apiObjectsMap.ledColor);

                        try {
                            // Hex Version
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledColor.parent.id + '.' + apiObjectsMap.ledColor.child.hex.id,
                                tools.rgbToHex(response.color.red, response.color.green, response.color.blue, false), true);
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
                        await checkTwinklyResponse(connectionName, response.config, apiObjectsMap.ledConfig);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledConfig.id, JSON.stringify(response.config.strings), true);
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
                        await checkTwinklyResponse(connectionName, response.effect, apiObjectsMap.ledEffect);
                        await saveJSONinState(connectionName, connectionName, response.effect, apiObjectsMap.ledEffect);
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
                        await checkTwinklyResponse(connectionName, response.layout, apiObjectsMap.ledLayout);
                        await saveJSONinState(connectionName, connectionName, response.layout, apiObjectsMap.ledLayout);
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
                        await checkTwinklyResponse(connectionName, response.mode, apiObjectsMap.ledMode);
                        await saveJSONinState(connectionName, connectionName, response.mode, apiObjectsMap.ledMode);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.on.id, response.mode.mode !== twinkly.lightModes.value.off, true);
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
                        await checkTwinklyResponse(connectionName, response.movie, apiObjectsMap.ledMovie);
                        await saveJSONinState(connectionName, connectionName, response.movie, apiObjectsMap.ledMovie);
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
                        await checkTwinklyResponse(connectionName, response.playlist, apiObjectsMap.ledPlaylist);
                        await saveJSONinState(connectionName, connectionName, response.playlist, apiObjectsMap.ledPlaylist);
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
                        await checkTwinklyResponse(connectionName, response.sat, apiObjectsMap.ledSat);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledSat.child.value.id,
                                response.sat.mode !== 'disabled' ? response.sat.value : -1, true);
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
                        await checkTwinklyResponse(connectionName, response.mqtt, apiObjectsMap.mqtt);
                        await saveJSONinState(connectionName, connectionName, response.mqtt, apiObjectsMap.mqtt);
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
                        await checkTwinklyResponse(connectionName, response.name, apiObjectsMap.name);
                        await saveJSONinState(connectionName, connectionName, response.name, apiObjectsMap.name);
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
                        await checkTwinklyResponse(connectionName, response.status, apiObjectsMap.networkStatus);
                        await saveJSONinState(connectionName, connectionName, response.status, apiObjectsMap.networkStatus);
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
                        await checkTwinklyResponse(connectionName, response.timer, apiObjectsMap.timer);
                        await saveJSONinState(connectionName, connectionName, response.timer, apiObjectsMap.timer);
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
    if (specificConnection !== '') {
        adapter.setState('info.connection', deviceConnected, true);
    }

    startInterval(adapter.config.interval * 1000);
}

async function main() {
    adapter.subscribeStates('*');

    adapter.setState('info.connection', false, true);

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
        Object.values(connections)
            .filter(connection => !connection.paused)
            .forEach(async connection => {
                try {
                    await connection.twinkly.logout();
                } catch (e) {
                    adapter.log.error(`[onStop.${connection.twinkly.name}] ${e}`);
                }
            });
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
     * @param {{checkPaused?: Boolean, checkConnected?: Boolean, ignoreConnected?: Boolean, writeConnectedState?: Boolean}} options
     * @return {Promise<{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly, dataLoadedOnInit: Boolean}>}
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
                if (connection && typeof obj.message === 'object') {
                    returnMsg = await connection.twinkly.uploadMovie(obj.message.movie.frames, obj.message.movie.delay);
                }
                break;
            }
            case 'uploadtemplatemovie': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object' && typeof obj.message.index === 'number') {
                    returnMsg = await uploadTemplateMovie(obj.message.connection, obj.message.index);
                }
                break;
            }
            case 'sendrealtimeframe': {
                const connection = await getConnectionObj();
                if (connection && typeof obj.message === 'object') {
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
                const deviceName = (device.name.trim() !== '' ? device.name : device.host).replace(stateTools.FORBIDDEN_CHARS, '_').replace(/[.\s]+/g, '_');

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
                if (Object.keys(connections).includes(deviceName))
                    adapter.log.warn(`Objects with same id = ${stateTools.buildId({device: deviceName, channel: null, state: null}, adapter)} created for two connections ${JSON.stringify(device)}`);
                else {
                    connections[deviceName] = {
                        enabled    : device.enabled,
                        paused     : false,
                        modeOn     : device.stateOn && (Object.keys(twinkly.lightModes.value).includes(device.stateOn) || twinkly.STATE_ON_LASTMODE === device.stateOn) ?
                            device.stateOn : twinkly.lightModes.value.movie,
                        lastModeOn : twinkly.lightModes.value.movie,
                        connected  : false,
                        twinkly    : new twinkly.Twinkly(adapter, deviceName, device.host, onModeChange),
                        dataLoadedOnInit : false
                    };

                    await loadTwinklyDataFromObjects(deviceName);
                }
            }

        // Prüfung ob aktive Verbindungen verfügbar sind
        if (result && Object.keys(connections).length === 0) {
            adapter.log.info('no enabled connections added...');
            result = false;
        }
    } catch (e) {
        throw Error(e);
    }

    if (result) {
        adapter.log.debug('[syncConfig] Prepare objects');
        const preparedObjects = await prepareObjectsByConfig();

        adapter.log.debug('[syncConfig] Get existing objects');
        const _objects = await adapter.getAdapterObjectsAsync();

        adapter.log.debug('[syncConfig] Prepare tasks of objects update');
        const tasks = prepareTasks(preparedObjects, _objects);

        adapter.log.debug('[syncConfig] Start tasks of objects update');
        try {
            await processTasks(tasks);
            adapter.log.debug('[syncConfig] Finished tasks of objects update');
        } catch (e) {
            throw Error(e);
        }
    }

    return result;
}

/**
 * Konfiguration aufbereiten um die States/Objekte anzulegen
 * @returns {Promise<{}>}
 */
async function prepareObjectsByConfig() {
    /**
     * @param {{}} config
     * @param {Boolean} displayPrevName
     * @param {{id: {}, common: {}, native: {}}} prevChannel
     * @returns {{}}
     */
    function getCommon(config, displayPrevName, prevChannel) {
        const result = {};

        result.name  = (displayPrevName && prevChannel.common ? prevChannel.common.name + ' ' : '') + (config.name !== undefined ? config.name : config.id);
        result.read  = true;
        result.write = config.write !== undefined ? config.write : false;
        result.type  = config.type  !== undefined ? config.type  : 'string';
        result.role  = config.role  !== undefined ? config.role  : 'state';

        if (result.type === 'number') {
            if (config.min !== undefined)
                result.min = config.min;
            if (config.max !== undefined)
                result.max = config.max;
        }

        if (result.def === undefined) {
            if (result.type === 'string')
                result.def = '';
            else if (result.type === 'number')
                result.def = result.min !== undefined ? result.min : 0;
            else if (result.type === 'boolean')
                result.def = false;
        } else
            result.def = config.def;

        if (config.states !== undefined)
            result.states = config.states;

        if (config.unit !== undefined)
            result.unit = config.unit;


        return result;
    }

    /**
     * @param {{device: {}, states: [], channels: []}} config
     * @param {{}} states
     * @param {Boolean} root
     * @param {Boolean} displayPrevName
     * @param {{id: {}, common: {}, native: {}}} prevChannel
     */
    async function prepareConfig(config, states, root, displayPrevName, prevChannel) {
        /**
         * @param {{id: {state: String}, exclude: []}} stateObj
         * @param {{id: String, exclude?: []}} stateInfo
         */
        function addState(stateObj, stateInfo) {
            stateObj.id.state = stateInfo.id;
            if (stateInfo.exclude)
                stateObj.exclude = stateInfo.exclude;

            config.states.push(stateObj);
        }

        for (const state of Object.keys(states)) {
            try {
                if (root) {
                    let bContinue = false;
                    if (states[state].parent !== undefined)
                        bContinue = !statesConfig.includes(states[state].parent.id);
                    else
                        bContinue = states[state].id === undefined || !statesConfig.includes(states[state].id);

                    if (bContinue) continue;
                }

                /** @type {{id: {device: String, channel: String, state?: String}, common: {}, native: {}, exclude: []}} */
                const stateObj = {
                    id: {
                        device: config.device.id.device,
                        channel: prevChannel.id.channel ? prevChannel.id.channel : ''
                    },
                    common: getCommon(states[state].parent !== undefined ? states[state].parent : states[state], displayPrevName, prevChannel),
                    native: {},
                    exclude: []
                };

                if (!states[state].hide) {
                    if (states[state].parent !== undefined) {
                        if (states[state].child !== undefined && states[state].expandJSON) {
                            // Soll der Parent angezeigt werden
                            if (!states[state].parent.hide) {
                                stateObj.id.channel += (stateObj.id.channel !== '' ? '.' : '') + states[state].parent.id;
                                config.channels.push(stateObj);

                                await prepareConfig(config, states[state].child, false, true, stateObj);
                            } else {
                                // Sonst States auf Grandparent erstellen
                                await prepareConfig(config, states[state].child, false, false, prevChannel);
                            }
                        } else if (await allowState(config.device.id.device, states[state].parent)) {
                            addState(stateObj, states[state].parent);
                        }
                    } else if (await allowState(config.device.id.device, states[state])) {
                        addState(stateObj, states[state]);
                    }
                }
            } catch (e) {
                throw Error(`[prepareConfig] ${state}: ${e}`);
            }
        }
    }

    const result = [];
    for (const connectionName of Object.keys(connections)) {
        let connection;
        try {
            connection = await getConnection(connectionName, {checkPaused: false, checkConnected: true, ignoreConnected: true, writeConnectedState: false});
        } catch (e) {
            adapter.log.debug(`[prepareObjectsByConfig] ${e.message}`);
            continue;
        }

        // Interview
        try {
            if (connection.connected) {
                // clear data, interview needs to load actual data
                if (connection.dataLoadedOnInit) {
                    connection.twinkly.firmware = '';
                    tools.clearObject(connection.twinkly.details);
                }

                await connection.twinkly.interview();
            }
        } catch (error) {
            adapter.log.error(`[prepareObjectsByConfig] Could not interview ${connectionName} ${error}`);
        }

        const config = {
            device: {
                id     : {device : connectionName},
                common : {name   : connection.twinkly.name, statusStates: {
                    onlineId: `${adapter.namespace}.${connectionName}.${apiObjectsMap.connected.id}`
                }},
                native : {host   : connection.twinkly.host}
            },
            states   : [],
            channels : []
        };

        await prepareConfig(config, apiObjectsMap, true, false, config.device);

        result.push(config);
    }

    return result;
}

/**
 * prepareTasks
 * @param preparedObjects
 * @param old_objects
 * @returns {{id: string, type: string, data?: {common: {}, native: {}}}[]}
 */
function prepareTasks(preparedObjects, old_objects) {
    const devicesToUpdate  = [];
    const channelsToUpdate = [];
    const statesToUpdate   = [];

    try {
        for (const group of preparedObjects) {
            // Device prüfen
            if (group.device) {
                const fullID = stateTools.buildId(group.device.id, adapter);
                const oldObj = old_objects[fullID];

                // Native ergänzen falls nicht vorhanden
                if (!group.device.native) group.device.native = {};

                if (oldObj && oldObj.type === 'device') {
                    if (!tools.areStatesEqual(oldObj, group.device, [])) {
                        devicesToUpdate.push({
                            type : 'update_device',
                            id   : group.device.id,
                            data : {
                                common : group.device.common,
                                native : group.device.native
                            }
                        });
                    }
                    old_objects[fullID] = undefined;
                } else {
                    devicesToUpdate.push({
                        type : 'create_device',
                        id   : group.device.id,
                        data : {
                            common : group.device.common,
                            native : group.device.native
                        }
                    });
                }
            }

            // Channels prüfen
            if (group.channels) {
                for (const channel of group.channels) {
                    const fullID = stateTools.buildId(channel.id, adapter);
                    const oldObj = old_objects[fullID];

                    // Native ergänzen falls nicht vorhanden
                    if (!channel.native) channel.native = {};

                    if (oldObj && oldObj.type === 'channel') {
                        if (!tools.areStatesEqual(oldObj, channel, [])) {
                            channelsToUpdate.push({
                                type : 'update_channel',
                                id   : channel.id,
                                data : {
                                    common : channel.common,
                                    native : channel.native
                                }
                            });
                        }
                        old_objects[fullID] = undefined;
                    } else {
                        channelsToUpdate.push({
                            type : 'create_channel',
                            id   : channel.id,
                            data : {
                                common : channel.common,
                                native : channel.native
                            }
                        });
                    }
                }
            }

            // States prüfen
            if (group.states) {
                for (const state of group.states) {
                    const fullID = stateTools.buildId(state.id, adapter);
                    const oldObj = old_objects[fullID];

                    // Native ergänzen falls nicht vorhanden
                    if (!state.native) state.native = {};

                    // Nur wenn der State bearbeitet werden darf hinzufügen
                    if (state.common.write)
                        subscribedStates[fullID] = {connection: state.id.device, group: state.id.channel, command: state.id.state};

                    if (oldObj && oldObj.type === 'state') {
                        if (!tools.areStatesEqual(oldObj, state, state.exclude)) {
                            statesToUpdate.push({
                                type : 'update_state',
                                id   : state.id,
                                data : {
                                    common : state.common,
                                    native : state.native
                                }
                            });
                        }
                        old_objects[fullID] = undefined;
                    } else {
                        statesToUpdate.push({
                            type : 'create_state',
                            id   : state.id,
                            data : {
                                common : state.common,
                                native : state.native
                            }
                        });
                    }
                }
            }
        }
    } catch (e) {
        adapter.log.error(e.name + ': ' + e.message);
    }

    // eslint-disable-next-line no-unused-vars
    const oldEntries       = Object.keys(old_objects).map(id => ([id, old_objects[id]])).filter(([id, object]) => object);
    // eslint-disable-next-line no-unused-vars
    const devicesToDelete  = oldEntries.filter(([id, object]) => object.type === 'device') .map(([id]) => ({type: 'delete_device', id: id}));
    // eslint-disable-next-line no-unused-vars
    const channelsToDelete = oldEntries.filter(([id, object]) => object.type === 'channel').map(([id]) => ({type: 'delete_channel', id: id}));
    // eslint-disable-next-line no-unused-vars
    const stateToDelete    = oldEntries.filter(([id, object]) => object.type === 'state')  .map(([id]) => ({type: 'delete_state', id: id}));

    return stateToDelete.concat(devicesToUpdate, devicesToDelete, channelsToUpdate, channelsToDelete, statesToUpdate);
}

/**
 * processTasks
 * @param {{id: string|{device: String, channel: String, state: String}, type: String, data?: {common: {}, native: {}}}[]} tasks
 */
async function processTasks(tasks) {
    if (!tasks || tasks.length === 0) {
        adapter.log.debug('[processTasks] No tasks to process!');
        return;
    }

    while (tasks.length > 0) {
        const
            task = tasks.shift(),
            id   = stateTools.buildId(task.id, adapter);

        adapter.log.debug('[processTasks] Task: ' + JSON.stringify(task) + ', ID: ' + id);

        if (task.type === 'create_device' && typeof task.id !== 'string') {
            adapter.log.debug('[processTasks] Create device id=' + id);
            try {
                await stateTools.createDevice(adapter, task.id, task.data.common, task.data.native);
            } catch (e) {
                adapter.log.error('Cannot create device: ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'update_device') {
            adapter.log.debug('[processTasks] Update device id=' + id);
            try {
                await adapter.extendObject(id, task.data);
            } catch (e) {
                adapter.log.error('Cannot update device: ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'delete_device') {
            adapter.log.debug('[processTasks] Delete device id=' + id);
            try {
                await adapter.delObject(id);
            } catch (e) {
                adapter.log.error('Cannot delete device : ' + id + ' Error: ' + e.message);
            }

        } else if (task.type === 'create_channel' && typeof task.id !== 'string') {
            adapter.log.debug('[processTasks] Create channel id=' + id);
            try {
                await stateTools.createChannel(adapter, task.id, task.data.common, task.data.native);
            } catch (e) {
                adapter.log.error('Cannot create channel: ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'update_channel') {
            adapter.log.debug('[processTasks] Update channel id=' + id);
            try {
                await adapter.extendObject(id, task.data);
            } catch (e) {
                adapter.log.error('Cannot update channel : ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'delete_channel') {
            adapter.log.debug('[processTasks] Delete channel id=' + id);
            try {
                await adapter.delObject(id);
            } catch (e) {
                adapter.log.error('Cannot delete channel : ' + id + ' Error: ' + e.message);
            }

        } else if (task.type === 'create_state' && typeof task.id !== 'string') {
            adapter.log.debug('[processTasks] Create state id=' + id);
            try {
                await stateTools.createState(adapter, task.id, task.data.common, task.data.native);
            } catch (e) {
                adapter.log.error('Cannot create state: ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'update_state') {
            adapter.log.debug('[processTasks] Update state id=' + id);
            try {
                await adapter.extendObject(id, task.data);
            } catch (e) {
                adapter.log.error('Cannot update state : ' + id + ' Error: ' + e.message);
            }
        } else if (task.type === 'delete_state') {
            adapter.log.debug('[processTasks] Delete state id=' + id);
            try {
                await adapter.delObject(id);
            } catch (e) {
                adapter.log.error('Cannot delete state : ' + id + ' Error: ' + e.message);
            }
        } else
            adapter.log.error('Unknown task type: ' + JSON.stringify(task));
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
     * @param {{hide?: Boolean; filter?: {name: String, val: any}; role?: String; type?: String}} stateInfo
     * @param {any} value
     * @param {Boolean} stringify
     */
    async function writeState(id, stateInfo, value, stringify) {
        if (!await allowState(connectionName, stateInfo)) return;

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

        for (const key of Object.keys(json)) {
            if (Object.keys(mapping.child).includes((key))) {
                if (typeof json[key] !== 'object' || Array.isArray(json[key])) {
                    await writeState(mapping.child[key].id, mapping.child[key], json[key], Array.isArray(json[key]));
                } else {
                    await saveJSONinState(connectionName, state, json[key], mapping.child[key]);
                }
            }
        }
    } else {
        await writeState(mapping.parent.id, mapping, json, true);
    }

    if (mapping.logItem && !initializing) { // Don't handle Sentry Messages during startup) {
        await handleSentryMessage(connectionName, 'saveJSONinState',
            `LogItem:${connectionName}:${mapping.parent.id}`,
            `LogItem (${connectionName}.${mapping.parent.id}, ${JSON.stringify(json)})`,
            'info');
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
        await checkTwinklyResponseNewSince(connectionName, name, response, mapping);
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
 */
async function checkTwinklyResponseNewSince(connectionName, name, response, mapping) {
    if (typeof response === 'undefined') return;

    for (const key of Object.keys(response)) {
        if (mapping.child && Object.keys(mapping.child).includes(key)) {
            if (typeof response[key] === 'object' && !Array.isArray(response[key])) {
                let continueCheck;
                if (typeof mapping.child[key].parent !== 'undefined') {
                    continueCheck = typeof mapping.child[key].parent.deprecated === 'undefined';
                } else {
                    continueCheck = typeof mapping.child[key].deprecated === 'undefined';
                }

                if (continueCheck) {
                    await checkTwinklyResponseNewSince(connectionName, name + '.' + key, response[key], mapping.child[key]);
                } else if (!initializing) { // Don't handle Sentry Messages during startup
                    await handleSentryMessage(connectionName, 'checkTwinklyResponse',
                        `reintroduced:${connectionName}:${name}:${key}`,
                        `Item reintroduced! (${connectionName}.${name}.${key}, ${JSON.stringify(response[key])}, ${typeof response[key]})`,
                        'warning');
                }
            }
        } else if (!initializing) { // Don't handle Sentry Messages during startup{
            await handleSentryMessage(connectionName, 'checkTwinklyResponse',
                `newSince:${connectionName}:${name}:${key}`,
                `New Item detected! (${connectionName}.${name}.${key}, ${JSON.stringify(response[key])}, ${typeof response[key]})`,
                'warning');
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
            if (mapping.child[child].parent !== undefined) {
                canHandle = await allowState(connectionName, mapping.child[child].parent, true, true);
            } else {
                canHandle = await allowState(connectionName, mapping.child[child], true, true);
            }

            if (canHandle && !initializing) { // Don't handle Sentry Messages during startup
                await handleSentryMessage(connectionName, 'checkTwinklyResponse',
                    `deprecated:${connectionName}:${name}:${child}`,
                    `Item deprecated: ${connectionName}.${name}.${child}`,
                    'warning');
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
                if (await allowState(connectionName, mapping[key])) {
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
 * @param {{hide: Boolean, ignore?: Boolean, filter?: {name: String, val: any}, deprecated?: String, newSince?: String, family?: String}} stateInfo
 * @param {Boolean} ignoreHide
 * @param {Boolean} checkIgnore
 */
async function allowState(connectionName, stateInfo, ignoreHide = false, checkIgnore = false) {
    let connection;
    try {
        connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});
    } catch (e) {
        adapter.log.debug(`[allowState.${connectionName}] ${e.message}`);
        return false;
    }

    let result = ignoreHide || !stateInfo.hide;
    if (result && checkIgnore)
        result = !stateInfo.ignore;
    if (result && stateInfo.filter !== undefined)
        result = await connection.twinkly.checkDetailInfo(stateInfo.filter);
    if (result && stateInfo.deprecated !== undefined)
        result = !tools.versionGreaterEqual(stateInfo.deprecated, connection.twinkly.firmware);
    if (result && stateInfo.newSince !== undefined)
        result = tools.versionGreaterEqual(stateInfo.newSince, connection.twinkly.firmware);
    if (result && stateInfo.family !== undefined)
        result = stateInfo.family === connection.twinkly.details.fw_family;

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
                await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.ledMovies.id, JSON.stringify(response.movies.movies), true);
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
 * @param {Number} index
 * @return {Promise<{code: Number}>}
 */
async function uploadTemplateMovie(connectionName, index) {
    let connection;
    try {
        connection = await getConnection(connectionName);
    } catch (e) {
        adapter.log.debug(`[uploadRandomFrames.${connectionName}] ${e.message}`);
        return {code: twinkly.HTTPCodes.values.invalid};
    }

    let frames;
    switch (index) {
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
        if (paused)
            connection.paused = paused.val;

        // lastModeOn
        const obj = await adapter.getObjectAsync(connectionName + '.' + apiObjectsMap.ledMode.child.mode.id);
        if (obj) {
            const lastModeOn = obj.native['lastModeOn'];
            if (typeof lastModeOn === 'string')
                connection.lastModeOn = lastModeOn;
        }

        // firmware
        const firmware = await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.firmware.child.version.id);
        if (firmware) {
            connection.twinkly.firmware = firmware.val;
        }

        // details
        const details = await adapter.getStateAsync(connectionName + '.' + apiObjectsMap.details.parent.id);
        if (details) {
            const detailsJson = JSON.parse(details.val);
            if (detailsJson)
                tools.cloneObject(detailsJson, connection.twinkly.details);
        }

        connection.dataLoadedOnInit = true;
    } catch (e) {
        adapter.log.error(`[loadTwinklyDataFromObjects.${connectionName}] Cannot load data! ${e.message}`);
    }
}

/**
 * Mode Change
 * @param connectionName
 * @param oldMode
 * @param newMode
 * @return {Promise<void>}
 */
async function onModeChange(connectionName, oldMode, newMode) {
    try {
        const connection = await getConnection(connectionName);

        if (oldMode !== '' && newMode !== twinkly.lightModes.value.off) {
            connection.lastModeOn = newMode;

            try {
                await stateTools.updateObjectNative(adapter, connectionName + '.' + apiObjectsMap.ledMode.child.mode.id, {lastModeOn: newMode});
            } catch (e) {
                adapter.log.error(`[updatePlaylist.${connectionName}] Cannot update playlist! ${e.message}`);
            }
        }
    } catch (e) {
        adapter.log.error(`[onModeChange.${connectionName}] ${e.message}`);
    }
}

/**
 * Get Connection and check if it is connected
 * @param {String} connectionName
 * @param {{checkPaused?: Boolean, checkConnected?: Boolean, ignoreConnected?: Boolean, writeConnectedState?: Boolean}} options
 * @return {Promise<{enabled: Boolean, paused: Boolean, modeOn: String, lastModeOn: String, connected: Boolean, twinkly: Twinkly, dataLoadedOnInit: Boolean}>}
 */
async function getConnection(connectionName, options = {}) {
    if (!Object.keys(connections).includes(connectionName))
        throw new Error(`${connectionName} not found!`);

    const connection = connections[connectionName];

    options.checkPaused = typeof options.checkPaused === 'undefined' ? true : options.checkPaused;
    options.checkConnected = typeof options.checkConnected === 'undefined' ? false : options.checkConnected;
    options.ignoreConnected = typeof options.ignoreConnected === 'undefined' ? false : options.ignoreConnected;
    options.writeConnectedState = typeof options.writeConnectedState === 'undefined' ? true : options.writeConnectedState;

    if ((typeof options.checkPaused === 'undefined' || options.checkPaused) && connection.paused) {
        throw new Error(`${connectionName} is paused!`);
    }
    if (options.checkConnected) {
        await checkConnection(connectionName, options.writeConnectedState);
    }
    if (!options.ignoreConnected && !connection.connected) {
        throw new Error(`${connectionName} not connected!`);
    }

    return connection;
}

/**
 * Check reachability of connection
 * @param {String} connectionName
 * @param {boolean} writeState
 * @return {Promise<void>}
 */
async function checkConnection(connectionName, writeState = true) {
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    // Ping-Check
    connection.connected = await connection.twinkly.checkConnection(adapter.config.usePing);

    try {
        if (writeState)
            await adapter.setStateAsync(connectionName + '.' + apiObjectsMap.connected.id, connection.connected, true);
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
 * @param {String} key
 * @param {String} message
 * @param {'fatal'|'error'|'warning'|'log'|'info'|'debug'} level?
 */
async function handleSentryMessage(connectionName, functionName, key, message, level) {
    // Anonymize Connection-Name
    key = key.replace(connectionName, '####');
    message = message.replace(connectionName, '');

    try {
        const connection = await getConnection(connectionName, {checkPaused: false, ignoreConnected: true});
        message += `, fw=${connection.twinkly.firmware}, fwFamily=${connection.twinkly.details.fw_family}`;

        // Export more information if unsure of the reason for deprecated/newSince
        if (key.includes('deprecated:')) {
            if (key.includes(':mode:movie')) {
                message += `, installedMovies=${Object.keys(connection.twinkly.ledMovies).length}`;
            }
            if (key.includes(':mode:color_config')) {
                message += `, ledProfile=${JSON.stringify(connection.twinkly.details.led_profile)}`;
            }
        }
    } catch (e) {
        //
    }

    const sentryKey = `${functionName}:${key}`;
    if (!Object.keys(sentryMessages).includes(sentryKey)) {
        sentryMessages[sentryKey] = message;

        const sentryObject = getSentryObject();
        if (typeof sentryObject !== 'undefined') {
            sentryObject.captureMessage(`[${functionName}] ${message}`, level);
        } else {
            adapter.log.info(`[${functionName}] ${message} --> Please notify the developer!`);
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
 *            captureException: function(exception: string|Error)} | undefined}
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