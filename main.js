'use strict';

const utils      = require('@iobroker/adapter-core');
const twinkly    = require('./lib/twinkly');
const stateTools = require('./lib/stateTools');
const tools      = require('./lib/tools');
const inspector  = require('inspector');

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
 * @type {{[x: string]: {enabled: Boolean, paused: Boolean, name: String, host: String, connected: Boolean, twinkly: Twinkly}}}
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
 * Namen der einzelnen States, Mapping für das Speichern nach dem Polling
 * @type {{[x: string]: {id: string, name: string, hide?: boolean} |
 *                      {parent: {id: string, name: string, hide?: boolean}, subIDs: {[x: string]: {id: string, name: string, hide?: boolean} |
 *                                                                                                 {parent: {id: string, name: string, hide?: boolean}, subIDs: {[x: string]: {id: string, name: string}}, expandJSON: boolean, logItem?: boolean, hide?: boolean}},
 *                       expandJSON: boolean, logItem?: boolean, hide?: boolean}}}
 */
const stateNames = {
    bri : {id: 'bri', name: 'Brightness', write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},
    color : {
        parent : {id: 'color', name: 'Color Config'},
        subIDs : {
            hue        : {id: 'hue',   name: 'Hue',   type: 'number', role: 'level.color.hue',        write: true, min: 0, max: 359, unit: '°'},
            saturation : {id: 'sat',   name: 'Sat',   type: 'number', role: 'level.color.saturation', write: true, min: 0, max: 255},
            value      : {id: 'value', name: 'Value', type: 'number', role: 'level.color.value',      write: true, min: 0, max: 255},
            red        : {id: 'r',     name: 'Red',   type: 'number', role: 'level.color.red',        write: true, min: 0, max: 255},
            green      : {id: 'g',     name: 'Green', type: 'number', role: 'level.color.green',      write: true, min: 0, max: 255},
            blue       : {id: 'b',     name: 'Blue',  type: 'number', role: 'level.color.blue',       write: true, min: 0, max: 255},
            white      : {id: 'w',     name: 'White', type: 'number', role: 'level.color.white',      write: true, min: 0, max: 255, filter: {name: 'led_profile', val: 'RGBW'}},
            hex        : {id: 'hex',   name: 'Hex',   type: 'string', role: 'level.color.hex',        write: true}
        },

        expandJSON : true
    },
    details : {
        parent : {id: 'details', name: 'Details', write: true, type: 'string', role: 'json'},
        subIDs : {
            base_leds_number    : {id: 'baseLedsNumber',    name: 'Base LEDs Number',    type: 'number'},
            bytes_per_led       : {id: 'bytesPerLed',       name: 'Bytes per LED',       type: 'number'},
            copyright           : {id: 'copyright',         name: 'Copyright'},
            device_name         : {id: 'deviceName',        name: 'Device Name'},
            flash_size          : {id: 'flashSize',         name: 'Flash Size',          type: 'number'},
            frame_rate          : {id: 'frameRate',         name: 'Frame Rate',          type: 'number'},
            fw_family           : {id: 'fwFamily',          name: 'Firmware Family'},
            hardware_version    : {id: 'hardwareVersion',   name: 'Hardware Version'},
            hw_id               : {id: 'hwId',              name: 'Hardware ID'},
            led_profile         : {id: 'ledProfile',        name: 'LED Profile'},
            led_type            : {id: 'ledType',           name: 'LED Type',            type: 'number'},
            led_version         : {id: 'ledVersion',        name: 'LED Version',         type: 'number'},
            mac                 : {id: 'mac',               name: 'MAC'},
            max_supported_led   : {id: 'maxSupportedLed',   name: 'Max Supported LED',   type: 'number'},
            measured_frame_rate : {id: 'measuredFrameRate', name: 'Measured Frame Rate', type: 'number'},
            movie_capacity      : {id: 'movieCapacity',     name: 'Movie Capacity',      type: 'number'},
            number_of_led       : {id: 'numberOfLed',       name: 'Number of LED',       type: 'number'},
            product_name        : {id: 'productName',       name: 'Product Name'},
            product_version     : {id: 'productVersion',    name: 'Product Version'},
            product_code        : {id: 'productCode',       name: 'Product Code'},
            rssi                : {id: 'rssi',              name: 'RSSI',                type: 'number'},
            uptime              : {id: 'uptime',            name: 'Uptime'},
            uuid                : {id: 'uuid',              name: 'UUID'},
            wire_type           : {id: 'wireType',          name: 'Wire Type',           type: 'number'}
        },
        expandJSON: true
    },
    firmware : {id: 'firmware', name: 'Firmware'},
    mode : {
        parent : {id: 'mode', name: 'Mode', write: true, type: 'string', role: 'json', hide: true},
        subIDs : {
            mode : {id: 'mode', name: 'Mode', write: true, role: 'state', def: twinkly.lightModes.value.off, states: twinkly.lightModes.text},

            // Active Movie in Mode "movie"
            id           : {id: 'id',        name: 'Id',         type: 'number', hide: true},
            name         : {id: 'name',      name: 'Name',                       hide: true},
            shop_mode    : {id: 'shopMode', name: 'Shop',       type: 'number', hide: true},
            unique_id    : {id: 'uniqueId', name: 'Unique Id',                  hide: true},

            // Active Movie in Mode "playlist"
            movie : {
                parent: {id: 'movie', name: 'Movie', hide: true},
                subIDs: {
                    name      : {id: 'activePlaylistMovie',         name: 'Active Playlist Movie'},
                    id        : {id: 'activePlaylistMovieId',       name: 'Active Playlist Movie Id',        type: 'number', hide: true},
                    duration  : {id: 'activePlaylistMovieDuration', name: 'Active Playlist Movie Duration',  type: 'number'},
                    unique_id : {id: 'activePlaylistMovieUniqueId', name: 'Active Playlist Movie Unique Id',                 hide: true},
                },
                expandJSON: true
            },

            // Color configuration
            color_config : {
                parent : {id: 'colorConfig', name: 'Color Config'},
                subIDs : {
                    hue        : {id: 'hue', name: 'Hue',   type: 'number'},
                    saturation : {id: 'sat', name: 'Sat',   type: 'number'},
                    value      : {id: 'val', name: 'Value', type: 'number'},
                    white      : {id: 'w',   name: 'White', type: 'number'},
                    red        : {id: 'r',   name: 'Red',   type: 'number'},
                    green      : {id: 'g',   name: 'Green', type: 'number'},
                    blue       : {id: 'b',   name: 'Blue',  type: 'number'}
                },
                hide      : true,
                expandJSON: false
            },

            musicreactive_config : {
                parent: {id: 'musicreactiveConfig', name: 'Musicreactive Config'},
                subIDs : {
                    handle    : {id: 'handle',   name: 'handle',   type: 'number'},
                    unique_id : {id: 'uniqueId', name: 'Unique Id'}
                },
                hide       : true,
                expandJSON : false
            }
        },
        expandJSON: true
    },

    movie        : {id: 'movie',        name: 'Movie',                    write: true, type: 'number'},
    movies       : {id: 'movies',       name: 'Movies',                                                 role: 'json'},
    reloadMovies : {id: 'reloadMovies', name: 'Reload Movies (Playlist)', write: true, type: 'boolean', role: 'button'},

    mqtt : {
        parent : {id: 'mqtt', name: 'MQTT', write: true, type: 'string', role: 'json'},
        subIDs : {
            broker_host         : {id: 'brokerHost',        name: 'Broker Host',         write: true},
            broker_port         : {id: 'brokerPort',        name: 'Broker Port',         write: true, type: 'number'},
            client_id           : {id: 'clientId',          name: 'Client ID',           write: true},
            keep_alive_interval : {id: 'keepAliveInterval', name: 'Keep Alive Interval', write: true, type: 'number', def: 60},
            user                : {id: 'user',              name: 'User',                write: true},
            encryption_key_set  : {id: 'encryptionKeySet',  name: 'Encryption-Key set',               type: 'boolean'}
        },
        expandJSON: true
    },
    name : {id: 'name', name: 'Name', write: true, type: 'string', role: 'info.name'},
    networkStatus : {
        parent : {id: 'network', name: 'Network', type: 'string', role: 'json'},
        subIDs : {
            mode    : {id: 'mode', name: 'Mode', type: 'number'},
            station : {
                parent : {id: 'station', name: 'Station', type: 'string', role: 'json'},
                subIDs : {
                    ip     : {id: 'ip',         name: 'IP'},
                    gw     : {id: 'gateway',    name: 'Gateway'},
                    mask   : {id: 'subnetmask', name: 'Subnetmask'},
                    rssi   : {id: 'rssi',       name: 'RSSI',        type: 'number'},
                    ssid   : {id: 'ssid',       name: 'SSID'},
                    status : {id: 'status',     name: 'Status'},
                },
                expandJSON: true
            },
            ap : {
                parent : {id: 'accesspoint', name: 'AccessPoint', write: false, type: 'string', role: 'json'},
                subIDs : {
                    enc              : {id: 'encrypted',       name: 'Encrypted',        type: 'number'},
                    ip               : {id: 'ip',              name: 'IP'},
                    channel          : {id: 'channel',         name: 'Channel',          type: 'number'},
                    max_connections  : {id: 'maxConnections',  name: 'Max Connections',  type: 'number'},
                    password_changed : {id: 'passwordChanged', name: 'Password Changed', type: 'number'},
                    ssid             : {id: 'ssid',            name: 'SSID'},
                    ssid_hidden      : {id: 'ssidHidden',      name: 'SSID Hidden',      type: 'number'}
                },
                expandJSON: true
            }
        },
        expandJSON: true
    },
    on     : {id: 'on',     name: 'On',               write: true, type: 'boolean', role: 'switch', def: false},
    paused : {id: 'paused', name: 'Pause Connection', write: true, type: 'boolean', role: 'switch', def: false},
    reset  : {id: 'reset',  name: 'Reset',            write: true, type: 'boolean', role: 'button'},
    timer  : {
        parent : {id: 'timer', name: 'Timer', write: true, type: 'string', role: 'json'},
        subIDs : {
            time_now : {id: 'timeNow',  name: 'Now',      write: true, type: 'number'},
            time_on  : {id: 'timeOn',   name: 'On',       write: true, type: 'number'},
            time_off : {id: 'timeOff',  name: 'Off',      write: true, type: 'number'},
            tz       : {id: 'timeZone', name: 'Timezone', write: true}
        },
        expandJSON: false
    },
    sat : {id: 'sat', name: 'Saturation', write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},

    connected : {id: 'connected', name: 'Connected', type: 'boolean', role: 'indicator.connected'}
};

/**
 * Anzulegende States
 * @type {[]}
 */
const statesConfig = [
    stateNames.paused.id,
    stateNames.connected.id,
    stateNames.on.id,
    stateNames.color.parent.id,
    stateNames.mode.parent.id,
    stateNames.movie.id,
    stateNames.reloadMovies.id,
    stateNames.bri.id,
    stateNames.sat.id,
    stateNames.name.id,
    stateNames.timer.parent.id,
    stateNames.firmware.id
];

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: 'twinkly',

        ready: main,
        unload: (callback) => {
            try {
                // Interval abbrechen
                if (pollingInterval) {
                    clearTimeout(pollingInterval);
                    pollingInterval = null;
                }

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

                callback();
            } catch (e) {
                callback();
            }
        },

        stateChange: async (id, state) => {
            if (state) {
                if (state.ack) return;

                // The state was changed
                adapter.log.debug(`[stateChange] state ${id} changed: ${state.val} (ack = ${state.ack})`);

                // Ist der state bekannt?
                if (!Object.keys(subscribedStates).includes(id)) {
                    adapter.log.warn(`${id} wird nicht verarbeitet!`);
                    return;
                }

                const
                    connectionName = subscribedStates[id].connection,
                    group          = subscribedStates[id].group,
                    command        = subscribedStates[id].command;

                if (!Object.keys(connections).includes(connectionName)) {
                    adapter.log.debug(`[stateChange] ${connectionName} does not exist!`);
                    return;
                }

                const connection = connections[connectionName];

                if (command === stateNames.paused.id) {
                    if (connection.paused !== state.val) {
                        connection.paused = state.val;

                        if (connection.paused) {
                            return;
                        } else {
                            await poll(connectionName);
                            return;
                        }
                    }

                // Nur ausführen, wenn Gerät nicht pausiert ist!
                } else if (connection.paused) {
                    adapter.log.debug(`[stateChange] ${connection.name} is paused!`);
                    return;
                }

                // Nur ausführen, wenn Gerät verbunden ist!
                if (!connection.connected) {
                    adapter.log.debug(`[stateChange] ${connection.name} is not available!`);
                    return;
                }

                // Gerät ein-/ausschalten
                if (!group && command === stateNames.on.id) {
                    try {
                        const response = await connection.twinkly.setLEDMode(state.val ? twinkly.lightModes.value.on : twinkly.lightModes.value.off);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.mode.parent.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }

                // Mode anpassen
                } else if (!group && command === stateNames.mode.subIDs.mode.id) {
                    try {
                        const response = await connection.twinkly.setLEDMode(state.val);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.mode.parent.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }

                // Movie anpassen
                } else if (!group && command === stateNames.movie.id) {
                    try {
                        const response = await connection.twinkly.setCurrentMovie(state.val);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${group}.${command} ${e}`);
                    }

                // Update Movies
                } else if (!group && command === stateNames.reloadMovies.id) {
                    await updateMovies(connectionName);

                // Farbe anpassen (mode = color)
                } else if (group && group === stateNames.color.parent.id) {
                    try {
                        if ([stateNames.color.subIDs.hue.id, stateNames.color.subIDs.saturation.id, stateNames.color.subIDs.value.id].includes(command)) {
                            /** @type {{hue: Number, saturation: Number, value: Number}} */
                            const json = {hue: 0, saturation: 0, value: 0};
                            await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.color.subIDs, {
                                id: command,
                                val: state.val
                            });

                            const response = await connection.twinkly.setLEDColorHSV(json.hue, json.saturation, json.value);
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.color.parent.id]);

                        } else if ([stateNames.color.subIDs.red.id, stateNames.color.subIDs.green.id, stateNames.color.subIDs.blue.id, stateNames.color.subIDs.white.id, stateNames.color.subIDs.hex.id].includes(command)) {
                            /** @type {{red: Number, green: Number, blue: Number, white: Number}} */
                            const json = {red: 0, green: 0, blue: 0, white: -1};

                            if ([stateNames.color.subIDs.red.id, stateNames.color.subIDs.green.id, stateNames.color.subIDs.blue.id, stateNames.color.subIDs.white.id].includes(command)) {
                                await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.color.subIDs, {
                                    id: command,
                                    val: state.val
                                });

                            } else {
                                const hexRgb = tools.hexToRgb(state.val);
                                json.red = hexRgb.r;
                                json.green = hexRgb.g;
                                json.blue = hexRgb.b;
                            }

                            const response = await connection.twinkly.setLEDColorRGBW(json.red, json.green, json.blue, json.white);
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.color.parent.id]);
                        }
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }

                // Helligkeit anpassen
                } else if (!group && command === stateNames.bri.id) {
                    if (state.val === -1) {
                        try {
                            const response = await connection.twinkly.setBrightnessDisabled();
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.bri.id]);
                        } catch (e) {
                            adapter.log.error(`Could not disable ${connectionName}.${command} ${e}`);
                        }
                    } else {
                        try {
                            const response = await connection.twinkly.setBrightnessAbsolute(state.val);
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.bri.id]);
                        } catch (e) {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                        }
                    }

                // Saturation anpassen
                } else if (!group && command === stateNames.sat.id) {
                    if (state.val === -1) {
                        try {
                            const response = await connection.twinkly.setSaturationDisabled();
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.sat.id]);
                        } catch (e) {
                            adapter.log.error(`Could not disable ${connectionName}.${command} ${e}`);
                        }
                    } else {
                        try {
                            const response = await connection.twinkly.setSaturationAbsolute(state.val);
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.sat.id]);
                        } catch (e) {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                        }
                    }

                // Namen anpassen
                } else if (!group && command === stateNames.name.id) {
                    try {
                        const response = await connection.twinkly.setDeviceName(state.val);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.details.parent.id, stateNames.name.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }

                // MQTT anpassen
                } else if (!group && command === stateNames.mqtt.parent.id) {
                    try {
                        const response = await connection.twinkly.setMqttConfiguration(state.val);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.mqtt.parent.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }
                } else if (group && group === stateNames.mqtt.parent.id) {
                    /** @type {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean}} */
                    const json = {broker_host: '', broker_port: 0, client_id: '', user: '', keep_alive_interval: 0, encryption_key_set: false};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});

                    try {
                        const response = await connection.twinkly.setMqttConfiguration(json);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.mqtt.parent.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }

                // NetworkStatus anpassen
                } else if (!group && command === stateNames.networkStatus.parent.id) {
                    // connection.twinkly.set_network_status(state.val)
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                    //     });
                } else if (group && group === stateNames.networkStatus.parent.id) {
                    // const json = {};
                    // await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});
                    //
                    // connection.twinkly.set_mqtt_str(JSON.stringify(json))
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                    //     });

                // Timer anpassen
                } else if (!group && command === stateNames.timer.parent.id) {
                    try {
                        const response = await connection.twinkly.setTimer(state.val);
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName, [stateNames.timer.parent.id]);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }
                } else if (group && group === stateNames.timer.parent.id) {
                    /** @type {{time_now: Number, time_on: Number, time_off: Number}} */
                    const json = {time_now: -1, time_on: -1, time_off: -1};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.timer.subIDs, {id: command, val: state.val});

                    // Prüfen ob Daten gesendet werden können
                    if ((json.time_on > -1 && json.time_off > -1) || (json.time_on === -1 && json.time_off === -1)) {
                        try {
                            const response = await connection.twinkly.setTimer(json);
                            if (response.code === twinkly.HTTPCodes.values.ok)
                                await poll(connectionName, [stateNames.timer.parent.id]);
                        } catch (e) {
                            adapter.log.error(`Could not set ${connectionName}.${group}.${command} ${e}`);
                        }
                    } else
                        adapter.log.debug(`[stateChange] Timer kann noch nicht übermittelt werden: (${json.time_on} > -1 && ${json.time_off} > -1) || (${json.time_on} === -1 && ${json.time_off} === -1)`);

                // Reset
                } else if (!group && command === stateNames.reset.id) {
                    try {
                        const response = await connection.twinkly.resetLED();
                        if (response.code === twinkly.HTTPCodes.values.ok)
                            await poll(connectionName);
                    } catch (e) {
                        adapter.log.error(`Could not set ${connectionName}.${command} ${e}`);
                    }
                }
            } else {
                // The state was deleted
                adapter.log.debug(`[stateChange] state ${id} deleted`);
            }
        }
    }));
}

/**
 * Polling auf alle Verbindungen ausführen
 * @param {string} specificConnection
 * @param {string[]} filter
 * @returns {Promise<void>}
 */
async function poll(specificConnection = '', filter = []) {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
        pollingInterval = null;
    }

    /**
     * Check if Command can be executed
     * @param command
     * @return {boolean}
     */
    function canExecuteCommand(command) {
        return statesConfig.includes(command) && (filter.length === 0 || filter.includes(command));
    }

    adapter.log.debug(`[poll] Start polling...`);
    try {
        for (const connectionName of Object.keys(connections)) {
            // Falls gefüllt nur bestimmte Connection abfragen...
            if (specificConnection !== '' && connectionName !== specificConnection) continue;

            const connection = connections[connectionName];

            // Only load at startup
            if (initializing) {
                const state = await adapter.getStateAsync(connectionName + '.' + stateNames.paused.id);
                if (state)
                    connection.paused = state.val;
                else
                    connection.paused = false;
            }

            // Nicht pollen, wenn pausiert!
            if (connection.paused) continue;

            // Ping-Check
            try {
                connection.connected = await connection.twinkly.ping();
            } catch (error) {
                connection.connected = false;
                adapter.log.error(`Could not ping ${connectionName} ${error}`);
            }

            await adapter.setStateAsync(connectionName + '.' + stateNames.connected.id, connection.connected, true);

            // Nur ausführen, wenn Gerät verbunden ist!
            if (!connection.connected) {
                adapter.log.debug(`[poll] ${connectionName} ist nicht verfügbar!`);
                continue;
            }

            // Only load at startup
            if (initializing) {
                await updateMovies(connectionName);
            }

            if (canExecuteCommand(stateNames.bri.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.bri.id}`);

                try {
                    const response = await connection.twinkly.getBrightness();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.bri.id, response.bri.value, true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.bri.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.color.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.color.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDColor();
                    await saveJSONinState(connectionName, connectionName, response.color, stateNames.color);

                    // Hex Version
                    await adapter.setStateAsync(connectionName + '.' + stateNames.color.parent.id + '.' + stateNames.color.subIDs.hex.id,
                        tools.rgbToHex(response.color.red, response.color.green, response.color.blue), true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.color.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.details.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.details.parent.id}`);

                try {
                    const response = await connection.twinkly.getDeviceDetails();
                    await saveJSONinState(connectionName, connectionName, response.details, stateNames.details);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.details.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.firmware.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.firmware.id}`);

                try {
                    const response = await connection.twinkly.getFirmwareVersion();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.firmware.id, response.version.version, true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.firmware.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.mode.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.mode.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDMode();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.on.id, response.mode.mode !== twinkly.lightModes.value.off, true);
                    await saveJSONinState(connectionName, connectionName, response.mode, stateNames.mode);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.mode.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.movie.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.movie.id}`);

                try {
                    const response = await connection.twinkly.getCurrentMovie();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.movie.id, response.movie.id, true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.movie.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.mqtt.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.mqtt.parent.id}`);

                try {
                    const response = await connection.twinkly.getMqttConfiguration();
                    await saveJSONinState(connectionName, connectionName, response.mqtt, stateNames.mqtt);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.mqtt.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.name.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.name.id}`);

                try {
                    const response = await connection.twinkly.getDeviceName();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.name.id, response.name.name, true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.name.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.networkStatus.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.networkStatus.parent.id}`);

                try {
                    const response = await connection.twinkly.getNetworkStatus();
                    await saveJSONinState(connectionName, connectionName, response.status, stateNames.networkStatus);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.networkStatus.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.sat.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.sat.id}`);

                try {
                    const response = await connection.twinkly.getSaturation();
                    await adapter.setStateAsync(connectionName + '.' + stateNames.sat.id, response.sat.value, true);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.sat.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.timer.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.timer.parent.id}`);

                try {
                    const response = await connection.twinkly.getTimer();
                    await saveJSONinState(connectionName, connectionName, response.timer, stateNames.timer);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.timer.parent.id} ${e}`);
                }
            }
        }
    } catch (e) {
        adapter.log.error(e);
    }

    adapter.log.debug(`[poll] Finished polling...`);

    pollingInterval = setTimeout(async () => {await poll();}, adapter.config.interval * 1000);
}

async function main() {
    adapter.subscribeStates('*');

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

    // States/Objekte anlegen...
    try {
        if (await syncConfig()) {
            await poll();
            initializing = false;
        } else {
            adapter.log.info('Polling wird nicht gestartet!');
        }
    } catch (e) {
        adapter.log.error(e);
        adapter.log.info('Polling wird nicht gestartet!');
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
        statesConfig.push(stateNames.details.parent.id);
    // MQTT hinzufügen, wenn gewünscht
    if (adapter.config.mqtt)
        statesConfig.push(stateNames.mqtt.parent.id);
    // Network hinzufügen, wenn gewünscht
    if (adapter.config.network)
        statesConfig.push(stateNames.networkStatus.parent.id);
    // Movies nur im Debugger anlegen
    if (inspector.url() !== undefined)
        statesConfig.push(stateNames.movies.id);

    try {
        adapter.log.debug('[syncConfig] config devices: '    + JSON.stringify(adapter.config.devices));
        adapter.log.debug('[syncConfig] config interval: '   + adapter.config.interval);
        adapter.log.debug('[syncConfig] config details: '    + adapter.config.details);
        adapter.log.debug('[syncConfig] config mqtt: '       + adapter.config.mqtt);
        adapter.log.debug('[syncConfig] config network: '    + adapter.config.network);

        if (adapter.config.devices.length === 0) {
            adapter.log.info('no connections added...');
            result = false;
        }

        // Verbindungen auslesen und erstellen
        if (result)
            for (const device of adapter.config.devices) {
                // Verbindung aktiviert?
                if (!device.enabled) {
                    adapter.log.debug(`[syncConfig] ${device.name} deaktiviert... ${JSON.stringify(device)}`);
                    continue;
                }

                // Host gefüllt
                if (device.host === '') {
                    adapter.log.warn(`${device.name}: Host nicht gefüllt!`);
                    continue;
                }

                // Verbindung anlegen
                const deviceName = device.name.replace(stateTools.FORBIDDEN_CHARS, '_').replace(/[.\s]+/g, '_');
                if (Object.keys(connections).includes(deviceName))
                    adapter.log.warn(`Objects with same id = ${stateTools.buildId({device: deviceName, channel: null, state: null}, adapter)} created for two connections ${JSON.stringify(device)}`);
                else
                    connections[deviceName] = {
                        enabled   : device.enabled,
                        paused    : false,
                        name      : device.name,
                        host      : device.host,
                        connected : false,
                        twinkly   : new twinkly.Twinkly(adapter, device.name, device.host, handleSentryMessage)
                    };
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
 * prepareObjectsByConfig
 * @returns {Promise<{}>}
 */
async function prepareObjectsByConfig() {
    /**
     *
     * @param {{}} config
     * @param {{id: {}, common: {}, native: {}}} prevChannel
     * @returns {{}}
     */
    function getCommon(config, prevChannel) {
        const result = {};

        result.name  = (prevChannel.common ? prevChannel.common.name + ' ' : '') + (config.name !== undefined ? config.name : config.id);
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
     * TODO: Automatische Erstellung aller States
     * @param {{device: {}, states: [], channels: []}} config
     * @param {{}} states
     * @param {Boolean} root
     * @param {{id: {}, common: {}, native: {}}} prevChannel
     */
    async function prepareConfig(config, states, root, prevChannel) {
        for (const state of Object.keys(states)) {
            if (root) {
                let bContinue = false;
                if (states[state].parent !== undefined)
                    bContinue = !statesConfig.includes(states[state].parent.id);
                else
                    bContinue = states[state].id === undefined || !statesConfig.includes(states[state].id);

                if (bContinue) continue;
            }

            const stateObj = {
                id: {
                    device: config.device.id.device,
                    channel: prevChannel.id.channel ? prevChannel.id.channel : ''
                },
                common: getCommon(states[state].parent !== undefined ? states[state].parent : states[state], prevChannel),
                native: {}
            };

            if (states[state].hide === undefined || !states[state].hide) {

                if (states[state].parent !== undefined) {
                    if (states[state].subIDs !== undefined && states[state].expandJSON) {
                        // Soll der Parent angezeigt werden
                        if (!states[state].parent.hide) {
                            stateObj.id.channel += (stateObj.id.channel !== '' ? '.' : '') + states[state].parent.id;
                            config.channels.push(stateObj);

                            await prepareConfig(config, states[state].subIDs, false, stateObj);
                        // Sonst States auf Grandparent erstellen
                        } else {
                            await prepareConfig(config, states[state].subIDs, false, prevChannel);
                        }
                    } else {
                        stateObj.id.state = states[state].parent.id;
                        config.states.push(stateObj);
                    }
                } else {
                    let canAddState = true;
                    if (states[state].filter !== undefined)
                        canAddState = await connections[config.device.id.device].twinkly.checkDetailInfo(states[state].filter);

                    if (canAddState) {
                        stateObj.id.state = states[state].id;
                        config.states.push(stateObj);
                    }
                }
            }
        }
    }

    const result = [];
    for (const connection of Object.keys(connections)) {
        const config = {
            device: {
                id     : {device : connection},
                common : {name   : connections[connection].name},
                native : {host   : connections[connection].twinkly.host}
            },
            states   : [],
            channels : []
        };

        await prepareConfig(config, stateNames, true, config.device);

        result.push(config);
    }

    return result;
}

/**
 * prepareTasks
 * @param preparedObjects
 * @param old_objects
 * @returns {{id: string, type: string}[]}
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
                    if (!areStatesEqual(oldObj, group.device)) {
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
                        if (!areStatesEqual(oldObj, channel)) {
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
                        if (!areStatesEqual(oldObj, state)) {
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
    const devicesToDelete  = oldEntries.filter(([id, object]) => object.type === 'device') .map(([id]) => ({ type: 'delete_device', id: id }));
    // eslint-disable-next-line no-unused-vars
    const channelsToDelete = oldEntries.filter(([id, object]) => object.type === 'channel').map(([id]) => ({ type: 'delete_channel', id: id }));
    // eslint-disable-next-line no-unused-vars
    const stateToDelete    = oldEntries.filter(([id, object]) => object.type === 'state')  .map(([id]) => ({ type: 'delete_state',  id: id }));

    return stateToDelete.concat(devicesToUpdate, devicesToDelete, channelsToUpdate, channelsToDelete, statesToUpdate);
}

/**
 * areStatesEqual
 * @param rhs
 * @param lhs
 * @returns {boolean}
 */
function areStatesEqual(rhs, lhs) {
    return areObjectsEqual(rhs.common, lhs.common) &&
           areObjectsEqual(rhs.native, lhs.native);
}

/**
 * Check if two Objects are identical
 * @param aObj
 * @param bObj
 * @returns {boolean}
 */
function areObjectsEqual(aObj, bObj) {
    function doCheck(aObj, bObj) {
        let result = typeof aObj !== 'undefined' && typeof bObj !== 'undefined';

        if (result)
            for (const key of Object.keys(aObj)) {
                let equal = Object.keys(bObj).includes(key);
                if (equal) {
                    if (typeof aObj[key] === 'object' && typeof bObj[key] === 'object')
                        equal = areObjectsEqual(aObj[key], bObj[key]);
                    else
                        equal = aObj[key] === bObj[key];
                }

                if (!equal) {
                    result = false;
                    break;
                }
            }

        return result;
    }

    return doCheck(aObj, bObj) && doCheck(bObj, aObj);
}

/**
 * processTasks
 * @param tasks
 */
async function processTasks(tasks) {
    if (!tasks || !tasks.length || tasks.length === 0) {
        adapter.log.debug('[processTasks] No tasks to process!');
        return;
    }

    while (tasks.length > 0) {
        const
            task = tasks.shift(),
            id   = stateTools.buildId(task.id, adapter);

        adapter.log.debug('[processTasks] Task: ' + JSON.stringify(task) + ', ID: ' + id);

        if (task.type === 'create_device') {
            adapter.log.debug('[processTasks] Create device id=' + id);
            await stateTools.createDevice(adapter, task.id, task.data.common, task.data.native)
                .catch(error => {
                    adapter.log.error('Cannot create device: ' + id + ' Error: ' + error);
                });
        } else if (task.type === 'update_device') {
            adapter.log.debug('[processTasks] Update device id=' + id);
            await adapter.extendObject(id, task.data, err => {
                if (err) adapter.log.error('Cannot update device: ' + id + ' Error: ' + err);
            });
        } else if (task.type === 'delete_device') {
            adapter.log.debug('[processTasks] Delete device id=' + id);

            await adapter.delObject(id, err => {
                if (err) adapter.log.error('Cannot delete device : ' + id + ' Error: ' + err);
            });

        } else if (task.type === 'create_channel') {
            adapter.log.debug('[processTasks] Create channel id=' + id);
            await stateTools.createChannel(adapter, task.id, task.data.common, task.data.native)
                .catch(error => {
                    adapter.log.error('Cannot create channel: ' + id + ' Error: ' + error);
                });
        } else if (task.type === 'update_channel') {
            adapter.log.debug('[processTasks] Update channel id=' + id);

            await adapter.extendObject(id, task.data, err => {
                err && adapter.log.error('Cannot update channel : ' + id + ' Error: ' + err);
            });
        } else if (task.type === 'delete_channel') {
            adapter.log.debug('[processTasks] Delete channel id=' + id);

            await adapter.delObject(id, err => {
                err && adapter.log.error('Cannot delete channel : ' + id + ' Error: ' + err);
            });

        } else if (task.type === 'create_state') {
            adapter.log.debug('[processTasks] Create state id=' + id);
            await stateTools.createState(adapter, task.id, task.data.common, task.data.native)
                .catch(error => {
                    adapter.log.error('Cannot create state: ' + id + ' Error: ' + error);
                });
        } else if (task.type === 'update_state') {
            adapter.log.debug('[processTasks] Update state id=' + id);

            await adapter.extendObject(id, task.data, err => {
                if (err) adapter.log.error('Cannot update state : ' + id + ' Error: ' + err);
            });
        } else if (task.type === 'delete_state') {
            adapter.log.debug('[processTasks] Delete state id=' + id);

            await adapter.delObject(id, err => {
                if (err) adapter.log.error('Cannot delete state : ' + id + ' Error: ' + err);
            });
        } else
            adapter.log.error('Unknown task type: ' + JSON.stringify(task));
    }
}

/**
 * Save States from JSON
 * @param connection <String>
 * @param state <String>
 * @param json <{} | undefined>
 * @param mapping <{parent: {id: string, name: string}, subIDs: {[x: string]: {id: string, name: string}}, expandJSON: boolean, logItem?: boolean, hide: boolean}>
 */
async function saveJSONinState(connection, state, json, mapping) {
    if (typeof json === undefined) return;

    mapping.logItem = mapping.logItem !== undefined && mapping.logItem === true;
    if (mapping.hide) return;

    if (mapping.expandJSON) {
        if (!mapping.parent.hide) {
            state += '.' + mapping.parent.id;
            adapter.setStateAsync(state, JSON.stringify(json), true).then(() => {});
        }

        for (const key of Object.keys(json)) {
            if (Object.keys(mapping.subIDs).includes((key))) {
                if (typeof json[key] !== 'object') {
                    let canSetState = !mapping.subIDs[key].hide;
                    if (canSetState && mapping.subIDs[key].filter !== undefined)
                        canSetState = await connections[connection].twinkly.checkDetailInfo(mapping.subIDs[key].filter);
                    if (canSetState)
                        adapter.setStateAsync(state + '.' + mapping.subIDs[key].id, json[key], true).then(() => {});
                } else {
                    await saveJSONinState(connection, state, json[key], mapping.subIDs[key]);
                }
            } else {
                handleSentryMessage('saveJSONinState',
                    `${state.replace(connection, '####')}:${key}`, `Unhandled Item detected! ` +
                    `(${state.replace(connection, '')}.${key}, ${JSON.stringify(json[key])}, ${typeof json[key]})`);
            }
        }
    } else {
        let canSetState = true;
        if (mapping.filter !== undefined)
            canSetState = await connections[connection].twinkly.checkDetailInfo(mapping.filter);
        if (canSetState)
            adapter.setStateAsync(state + '.' + mapping.parent.id, JSON.stringify(json), true).then(() => {});
    }

    if (mapping.logItem) {
        handleSentryMessage('saveJSONinState',
            `LogItem:${state.replace(connection, '####')}:${mapping.parent.id}`,
            `LogItem (${state.replace(connection, '')}.${mapping.parent.id}, ${JSON.stringify(json)})`);
    }
}

/**
 * Get States in JSON
 * @param connection <String>
 * @param stateId <String>
 * @param json <{}>
 * @param lastState <{id: String, val: any}>
 * @param mapping <{}>
 */
async function getJSONStates(connection, stateId, json, mapping, lastState) {
    for (const key of Object.keys(mapping)) {
        if (Object.keys(json).includes((key))) {
            // Check LastState first
            if (lastState && mapping[key].id === lastState.id)
                json[key] = lastState.val;
            else {
                let canGetState = !mapping[key].hide;
                if (canGetState && mapping[key].filter !== undefined)
                    canGetState = await connections[connection].twinkly.checkDetailInfo(mapping[key].filter);
                if (canGetState) {
                    const state = await adapter.getStateAsync(stateId + '.' + mapping[key].id);
                    if (state)
                        json[key] = state.val;
                    else
                        json[key] = '';
                }
            }
        }
    }
}

async function updateMovies(connectionName) {
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    const data = {common: {states: {}}};

    try {
        const response = await connection.twinkly.getListOfMovies();
        if (statesConfig.includes(stateNames.movies.id)) {
            await adapter.setStateAsync(connectionName + '.' + stateNames.movies.id, JSON.stringify(response.movies.movies), true);
        }

        for (const movie of response.movies.movies) {
            data.common.states[movie.id] = movie.name;
        }
    } catch (e) {
        adapter.log.error(`[updateMovies.${connectionName}] Could not get movies ${e}`);
    }

    await adapter.extendObject(connectionName + '.' + stateNames.movie.id, data, err => {
        if (err) adapter.log.error(`[updateMovies.${connectionName}] Cannot update movies Error: ${err}`);
    });
}

/**
 * Handle Sentry Messages and check if already sent
 * @param functionName <String>
 * @param key <String>
 * @param message <String>
 */
function handleSentryMessage(functionName, key, message) {
    adapter.log.debug(`[${functionName}] ${key} - ${message}`);

    const sentryKey = `${functionName}:${key}`;

    if (!Object.keys(sentryMessages).includes(sentryKey)) {
        sentryMessages[sentryKey] = message;

        let canSendSentry = false;
        if (adapter.supportsFeature && adapter.supportsFeature('PLUGINS')) {
            const sentryInstance = adapter.getPluginInstance('sentry');
            if (sentryInstance && sentryInstance.getSentryObject()) {
                canSendSentry = true;
                sentryInstance.getSentryObject().captureException(`[${functionName}] ${message}`);
            }
        }

        if (!canSendSentry)
            adapter.log.info(`[${functionName}] ${message} Please notify the developer!`);
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