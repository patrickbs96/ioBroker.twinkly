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
 * @type {{[x: string]: {enabled: Boolean, paused: Boolean, name: String, host: String, connected: Boolean, twinkly: Connection}}}
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
    bri : {id: 'bri', name: 'Brightness', write: true, type: 'number', role: 'level.dimmer', min: 0, max: 100},
    color : {
        parent : {id: 'color', name: 'Color Config'},
        subIDs : {
            hue        : {id: 'hue',   name: 'Hue',   type: 'number', role: 'level.color.hue',        write: true, min: 0, max: 359},
            saturation : {id: 'sat',   name: 'Sat',   type: 'number', role: 'level.color.saturation', write: true, min: 0, max: 255},
            value      : {id: 'value', name: 'Value', type: 'number', role: 'level.color.value',      write: true, min: 0, max: 255},
            red        : {id: 'r',     name: 'Red',   type: 'number', role: 'level.color.red',        write: true, min: 0, max: 255},
            green      : {id: 'g',     name: 'Green', type: 'number', role: 'level.color.green',      write: true, min: 0, max: 255},
            blue       : {id: 'b',     name: 'Blue',  type: 'number', role: 'level.color.blue',       write: true, min: 0, max: 255},
            hex        : {id: 'hex',   name: 'Hex',   type: 'string', role: 'level.color.hex',        write: true}
        },

        expandJSON : true
    },
    details : {
        parent : {id: 'details', name: 'Details', write: true, type: 'string', role: 'json'},
        subIDs : {
            base_leds_number    : {id: 'base_leds_number',    name: 'Base LEDs Number',    type: 'number'},
            bytes_per_led       : {id: 'bytes_per_led',       name: 'Bytes per LED',       type: 'number'},
            copyright           : {id: 'copyright',           name: 'Copyright'},
            device_name         : {id: 'device_name',         name: 'Device Name'},
            flash_size          : {id: 'flash_size',          name: 'Flash Size',          type: 'number'},
            frame_rate          : {id: 'frame_rate',          name: 'Frame Rate',          type: 'number'},
            fw_family           : {id: 'fw_family',           name: 'Firmware Family'},
            hardware_version    : {id: 'hardware_version',    name: 'Hardware Version'},
            hw_id               : {id: 'hw_id',               name: 'Hardware ID'},
            led_profile         : {id: 'led_profile',         name: 'LED Profile'},
            led_type            : {id: 'led_type',            name: 'LED Type',            type: 'number'},
            led_version         : {id: 'led_version',         name: 'LED Version',         type: 'number'},
            mac                 : {id: 'mac',                 name: 'MAC'},
            max_supported_led   : {id: 'max_supported_led',   name: 'Max Supported LED',   type: 'number'},
            measured_frame_rate : {id: 'measured_frame_rate', name: 'Measured Frame Rate', type: 'number'},
            movie_capacity      : {id: 'movie_capacity',      name: 'Movie Capacity',      type: 'number'},
            number_of_led       : {id: 'number_of_led',       name: 'Number of LED',       type: 'number'},
            product_name        : {id: 'product_name',        name: 'Product Name'},
            product_version     : {id: 'product_version',     name: 'Product Version'},
            product_code        : {id: 'product_code',        name: 'Product Code'},
            rssi                : {id: 'rssi',                name: 'RSSI',                type: 'number'},
            uptime              : {id: 'uptime',              name: 'Uptime'},
            uuid                : {id: 'uuid',                name: 'UUID'},
            wire_type           : {id: 'wire_type',           name: 'Wire Type',           type: 'number'}
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
            shop_mode    : {id: 'shop_mode', name: 'Shop',       type: 'number', hide: true},
            unique_id    : {id: 'unique_id', name: 'Unique Id',                  hide: true},

            // Active Movie in Mode "playlist"
            movie : {
                parent: {id: 'movie', name: 'Movie', hide: true},
                subIDs: {
                    name      : {id: 'activePlaylistMovie',          name: 'Active Playlist Movie'},
                    id        : {id: 'activePlaylistMovieId',        name: 'Active Playlist Movie Id',        type: 'number', hide: true},
                    duration  : {id: 'activePlaylistMovieDuration',  name: 'Active Playlist Movie Duration',  type: 'number'},
                    unique_id : {id: 'activePlaylistMovieUnique_id', name: 'Active Playlist Movie Unique Id',                 hide: true},
                },
                expandJSON: true
            },

            // Color configuration
            color_config : {
                parent: {id: 'colorConfig', name: 'Color Config'},
                subIDs: {
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
    sat : {id: 'sat', name: 'Saturation', write: true, type: 'number', role: 'level.dimmer', min: 0, max: 100},

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
                    .forEach(connection => connection.twinkly.logout()
                        .catch(error => {
                            adapter.log.error(`[onStop.${connection.twinkly.name}] ${error}`);
                        }));

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
                    connection.twinkly.setLEDMode(state.val ? twinkly.lightModes.value.on : twinkly.lightModes.value.off)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.mode.parent.id]);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });

                // Mode anpassen
                } else if (!group && command === stateNames.mode.subIDs.mode.id) {
                    connection.twinkly.setLEDMode(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.mode.parent.id]);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });

                // Movie anpassen
                } else if (!group && command === stateNames.movie.id) {
                    connection.twinkly.setCurrentMovie(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${group}.${command} ${error}`);
                        });

                // Update Movies
                } else if (!group && command === stateNames.reloadMovies.id) {
                    await updateMovies(connectionName);

                // Helligkeit anpassen
                } else if (group && group === stateNames.color.parent.id) {

                    if ([stateNames.color.subIDs.hue.id, stateNames.color.subIDs.saturation.id, stateNames.color.subIDs.value.id].includes(command)) {
                        /** @type {{hue: Number, saturation: Number, value: Number}} */
                        const json = {hue: 0, saturation: 0, value: 0};
                        await getJSONStates(connectionName + '.' + group, json, stateNames.color.subIDs, {id: command, val: state.val});

                        connection.twinkly.setLEDColorHSV(json.hue, json.saturation, json.value)
                            .then(({code}) => {
                                if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.color.parent.id]);
                            })
                            .catch(error => {adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);});

                    } else if ([stateNames.color.subIDs.red.id, stateNames.color.subIDs.green.id, stateNames.color.subIDs.blue.id, stateNames.color.subIDs.hex.id].includes(command)) {
                        /** @type {{red: Number, green: Number, blue: Number}} */
                        const json = {red: 0, green: 0, blue: 0};

                        if ([stateNames.color.subIDs.red.id, stateNames.color.subIDs.green.id, stateNames.color.subIDs.blue.id].includes(command)) {
                            await getJSONStates(connectionName + '.' + group, json, stateNames.color.subIDs, {id: command, val: state.val});

                        } else {
                            const hexRgb = tools.hexToRgb(state.val);
                            json.red   = hexRgb.r;
                            json.green = hexRgb.g;
                            json.blue  = hexRgb.b;
                        }

                        connection.twinkly.setLEDColorRGB(json.red, json.green, json.blue)
                            .then(({code}) => {
                                if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.color.parent.id]);
                            })
                            .catch(error => {adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);});
                    }

                // Helligkeit anpassen
                } else if (!group && command === stateNames.bri.id) {
                    connection.twinkly.setBrightnessAbsolute(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.bri.id]);
                        })
                        .catch(error => {adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);});

                // Saturation anpassen
                } else if (!group && command === stateNames.sat.id) {
                    connection.twinkly.setSaturationAbsolute(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.sat.id]);
                        })
                        .catch(error => {adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);});

                // Namen anpassen
                } else if (!group && command === stateNames.name.id) {
                    connection.twinkly.setDeviceName(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.details.parent.id, stateNames.name.id]);
                        })
                        .catch(
                            error => {adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                            });

                // MQTT anpassen
                } else if (!group && command === stateNames.mqtt.parent.id) {
                    connection.twinkly.setMqtt(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.mqtt.parent.id]);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });
                } else if (group && group === stateNames.mqtt.parent.id) {
                    /** @type {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean}} */
                    const json = {broker_host: '', broker_port: 0, client_id: '', user: '', keep_alive_interval: 0, encryption_key_set: false};
                    await getJSONStates(connection + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});

                    connection.twinkly.setMqtt(json)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.mqtt.parent.id]);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });

                // NetworkStatus anpassen
                } else if (!group && command === stateNames.networkStatus.parent.id) {
                    // connection.twinkly.set_network_status(state.val)
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                    //     });
                } else if (group && group === stateNames.networkStatus.parent.id) {
                    // const json = {};
                    // await getJSONStates(connection + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});
                    //
                    // connection.twinkly.set_mqtt_str(JSON.stringify(json))
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                    //     });

                // Timer anpassen
                } else if (!group && command === stateNames.timer.parent.id) {
                    connection.twinkly.setTimer(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.timer.parent.id]);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });
                } else if (group && group === stateNames.timer.parent.id) {
                    /** @type {{time_now: Number, time_on: Number, time_off: Number}} */
                    const json = {time_now: -1, time_on: -1, time_off: -1};
                    await getJSONStates(connectionName + '.' + group, json, stateNames.timer.subIDs, {id: command, val: state.val});

                    // Prüfen ob Daten gesendet werden können
                    if ((json.time_on > -1 && json.time_off > -1) || (json.time_on === -1 && json.time_off === -1)) {
                        connection.twinkly.setTimer(json)
                            .then(({code}) => {
                                if (code === twinkly.HTTPCodes.values.ok) poll(connectionName, [stateNames.timer.parent.id]);
                            })
                            .catch(error => {
                                adapter.log.error(`Could not set ${connectionName}.${group}.${command} ${error}`);
                            });
                    } else
                        adapter.log.debug(`[stateChange] Timer kann noch nicht übermittelt werden: (${json.time_on} > -1 && ${json.time_off} > -1) || (${json.time_on} === -1 && ${json.time_off} === -1)`);

                // Reset
                } else if (!group && command === stateNames.reset.id) {
                    await adapter.setState(id, false, true);
                    connection.twinkly.reset()
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll(connectionName);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connectionName}.${command} ${error}`);
                        });
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
                await adapter.getStateAsync(connectionName + '.' + stateNames.paused.id)
                    .then(state => {
                        if (state)
                            connection.paused = state.val;
                        else
                            connection.paused = false;
                    });
            }

            // Nicht pollen, wenn pausiert!
            if (connection.paused) continue;

            // Ping-Check
            await connection.twinkly.ping()
                .then(connected => {
                    connection.connected = connected;
                    adapter.setStateAsync(connectionName + '.' + stateNames.connected.id, connection.connected, true);
                }).catch(error => {
                    adapter.log.error(`Could not ping ${connectionName} ${error}`);
                });

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

                await connection.twinkly.getBrightness()
                    .then(async ({bri}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.bri.id, bri.value, true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.bri.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.color.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.color.parent.id}`);

                await connection.twinkly.getLEDColor()
                    .then(async ({color}) => {
                        saveJSONinState(connectionName, connectionName, color, stateNames.color);

                        // Hex Version
                        await adapter.setStateAsync(connectionName + '.' + stateNames.color.parent.id + '.' + stateNames.color.subIDs.hex.id,
                            tools.rgbToHex(color.red, color.green, color.blue), true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.color.parent.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.details.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.details.parent.id}`);

                await connection.twinkly.getDetails()
                    .then(async ({details}) => {
                        saveJSONinState(connectionName, connectionName, details, stateNames.details);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.details.parent.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.firmware.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.firmware.id}`);

                await connection.twinkly.getFirmwareVersion()
                    .then(async ({version}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.firmware.id, version.version, true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.firmware.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.mode.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.mode.parent.id}`);

                await connection.twinkly.getLEDMode()
                    .then(async ({mode}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.on.id, mode.mode !== twinkly.lightModes.value.off, true);
                        saveJSONinState(connectionName, connectionName, mode, stateNames.mode);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.mode.parent.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.movie.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.movie.id}`);

                await connection.twinkly.getCurrentMovie()
                    .then(async ({movie}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.movie.id, movie.id, true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.movie.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.mqtt.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.mqtt.parent.id}`);

                await connection.twinkly.getMqtt()
                    .then(async ({mqtt}) => {
                        saveJSONinState(connectionName, connectionName, mqtt, stateNames.mqtt);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.mqtt.parent.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.name.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.name.id}`);

                await connection.twinkly.getDeviceName()
                    .then(async ({name}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.name.id, name.name, true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.name.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.networkStatus.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.networkStatus.parent.id}`);

                await connection.twinkly.getNetworkStatus()
                    .then(async ({status}) => {
                        saveJSONinState(connectionName, connectionName, status, stateNames.networkStatus);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.networkStatus.parent.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.sat.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.sat.id}`);

                await connection.twinkly.getSaturation()
                    .then(async ({sat}) => {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.sat.id, sat.value, true);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.sat.id} ${error}`);
                    });
            }

            if (canExecuteCommand(stateNames.timer.parent.id)) {
                adapter.log.debug(`[poll] Polling ${connectionName}.${stateNames.timer.parent.id}`);

                await connection.twinkly.getTimer()
                    .then(async ({timer}) => {
                        saveJSONinState(connectionName, connectionName, timer, stateNames.timer);
                    })
                    .catch(error => {
                        adapter.log.error(`Could not get ${connectionName}.${stateNames.timer.parent.id} ${error}`);
                    });
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
                        twinkly   : new twinkly.Connection(adapter, device.name, device.host, handleSentryMessage)
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
        const preparedObjects = prepareObjectsByConfig();

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
 * @returns {{}}
 */
function prepareObjectsByConfig() {
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

        return result;
    }

    /**
     * TODO: Automatische Erstellung aller States
     * @param {{device: {}, states: [], channels: []}} config
     * @param {{}} states
     * @param {Boolean} root
     * @param {{id: {}, common: {}, native: {}}} prevChannel
     */
    function prepareConfig(config, states, root, prevChannel) {
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

                            prepareConfig(config, states[state].subIDs, false, stateObj);
                        // Sonst States auf Grandparent erstellen
                        } else {
                            prepareConfig(config, states[state].subIDs, false, prevChannel);
                        }
                    } else {
                        stateObj.id.state = states[state].parent.id;
                        config.states.push(stateObj);
                    }
                } else {
                    stateObj.id.state = states[state].id;
                    config.states.push(stateObj);
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

        prepareConfig(config, stateNames, true, config.device);

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
 * @param json <{}>
 * @param mapping <{parent: {id: string, name: string}, subIDs: {[x: string]: {id: string, name: string}}, expandJSON: boolean, logItem?: boolean, hide: boolean}>
 */
function saveJSONinState(connection, state, json, mapping) {
    if (typeof mapping === undefined) {
        adapter.log.info(`[saveJSONinState] json is undefined!`);
        return;
    }

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
                    if (!mapping.subIDs[key].hide)
                        adapter.setStateAsync(state + '.' + mapping.subIDs[key].id, json[key], true).then(() => {});
                } else if (!mapping.hide) {
                    saveJSONinState(connection, state, json[key], mapping.subIDs[key]);
                }
            } else {
                handleSentryMessage('saveJSONinState',
                    `${state.replace(connection, '####')}:${key}`, `Unhandled Item detected! ` +
                    `(${state.replace(connection, '')}.${key}, ${JSON.stringify(json[key])}, ${typeof json[key]})`);
            }
        }
    } else
        adapter.setStateAsync(state + '.' + mapping.parent.id, JSON.stringify(json), true).then(() => {});

    if (mapping.logItem) {
        handleSentryMessage('saveJSONinState',
            `LogItem:${state.replace(connection, '####')}:${mapping.parent.id}`,
            `LogItem (${state.replace(connection, '')}.${mapping.parent.id}, ${JSON.stringify(json)})`);
    }
}

/**
 * Get States in JSON
 * @param state <String>
 * @param json <{}>
 * @param lastState <{id: String, val: any}>
 * @param mapping <{}>
 */
async function getJSONStates(state, json, mapping, lastState) {
    for (const key of Object.keys(mapping)) {
        if (Object.keys(json).includes((key))) {
            // Check LastState first
            if (lastState && mapping[key].id === lastState.id)
                json[key] = lastState.val;
            else
                await adapter.getStateAsync(state + '.' + mapping[key].id)
                    .then(state => {
                        if (state)
                            json[key] = state.val;
                        else
                            json[key] = '';
                    });
        }
    }
}

async function updateMovies(connectionName) {
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    const data = {common: {states: {}}};

    await connection.twinkly.getMovies()
        .then(async ({movies}) => {

            if (statesConfig.includes(stateNames.movies.id)) {
                await adapter.setStateAsync(connectionName + '.' + stateNames.movies.id, JSON.stringify(movies.movies), true);
            }

            for (const movie of movies.movies) {
                data.common.states[movie.id] = movie.name;
            }
        })
        .catch(error => {
            adapter.log.error(`[updateMovies.${connectionName}] Could not get movies ${error}`);
        });

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