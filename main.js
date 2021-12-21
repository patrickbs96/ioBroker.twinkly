'use strict';

const utils      = require('@iobroker/adapter-core');
const twinkly    = require('./lib/twinkly');
const stateTools = require('./lib/stateTools');
const tools      = require('./lib/tools');
const inspector  = require('inspector');

// TODO: uploadMovie, LEDMovieConfig, sendRealtimeFrame, Summary, Mic, Music
// TODO: Handle deprecated

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
    details : {
        parent : {id: 'details', name: 'Details', role: 'json'},
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
            production_site     : {id: 'productionSite',    name: 'Production site',     type: 'number',                     newSince: '2.8.3'},
            production_date     : {id: 'productionDate',    name: 'Production Date',     type: 'number', role: 'value.time', newSince: '2.8.3'},
            product_name        : {id: 'productName',       name: 'Product Name'},
            product_version     : {id: 'productVersion',    name: 'Product Version'},
            product_code        : {id: 'productCode',       name: 'Product Code'},
            rssi                : {id: 'rssi',              name: 'RSSI',                type: 'number'},
            serial              : {id: 'serial',            name: 'Serial',                                                  newSince: '2.8.3'},
            uptime              : {id: 'uptime',            name: 'Uptime'},
            uuid                : {id: 'uuid',              name: 'UUID'},
            wire_type           : {id: 'wireType',          name: 'Wire Type',           type: 'number'},

            group : {
                parent : {id: 'group', name: 'Group', newSince: '2.8.3'},
                subIDs : {
                    mode       : {id: 'mode',       name: 'Name'},
                    compat_mode: {id: 'compatMode', name: 'Compat Mode', type: 'number'}
                },
                expandJSON: false
            }
        },
        expandJSON: true
    },
    firmware : {id: 'firmware',  name: 'Firmware'},

    ledBri   : {id: 'ledBri', name: 'LED Brightness', write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},
    ledColor : {
        parent : {id: 'ledColor', name: 'LED Color', role: 'json'},
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
    ledConfig : {id: 'ledConfig', name: 'LED Config', write: true, role: 'json'},
    ledEffect : {id: 'ledEffect', name: 'LED Effect', write: true, type: 'number', exclude: ['states']},
    ledLayout : {
        parent : {id: 'ledLayout', name: 'LED Layout', write: true, role: 'json'},
        subIDs : {
            aspectXY    : {id: 'aspectXY',    name: 'Aspect XY',   write: true, type: 'number', deprecated: '2.8.3'},
            aspectXZ    : {id: 'aspectXZ',    name: 'Aspect XZ',   write: true, type: 'number', deprecated: '2.8.3'},
            coordinates : {id: 'coordinates', name: 'Coordinates', write: true, type: 'string',  role: 'json'},
            source      : {id: 'source',      name: 'Source',      write: true,                                 states: {linear: 'linear', '2d': '2d', '3d': '3d'}},
            synthesized : {id: 'synthesized', name: 'Synthesized', write: true, type: 'boolean', role: 'switch'},
            uuid        : {id: 'uuid',        name: 'UUID',        hide : true},
        },
        expandJSON: true
    },
    ledMode : {
        parent : {id: 'mode', name: 'LED Mode', role: 'json', hide: true},
        subIDs : {
            mode : {id: 'ledMode', name: 'LED Mode', write: true, role: 'state', def: twinkly.lightModes.value.off, states: twinkly.lightModes.text},

            // Active Movie in Mode "movie"
            id           : {id: 'id',       name: 'Id',         type: 'number', hide: true},
            name         : {id: 'name',     name: 'Name',                       hide: true},
            shop_mode    : {id: 'shopMode', name: 'Shop',       type: 'number', hide: true},
            unique_id    : {id: 'uniqueId', name: 'Unique Id',                  hide: true},

            // Active Movie in Mode "playlist"
            movie : {
                parent: {id: 'movie', name: 'Movie', hide: true},
                subIDs: {
                    name      : {id: 'activePlaylistMovie',         name: 'Active Playlist Movie',                           hide: true},
                    id        : {id: 'activePlaylistMovieId',       name: 'Active Playlist Movie Id',        type: 'number', hide: true},
                    duration  : {id: 'activePlaylistMovieDuration', name: 'Active Playlist Movie Duration',  type: 'number', hide: true},
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

    ledMovie    : {id: 'ledMovie',    name: 'LED Movie',      write: true, type: 'number', exclude: ['states']},
    ledMovies   : {id: 'ledMovies',   name: 'LED Movies',     role: 'json'},
    ledPlaylist : {id: 'ledPlaylist', name: 'LED Playlist',   write: true, type: 'number'},
    ledSat      : {id: 'ledSat',      name: 'LED Saturation', write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},

    mqtt : {
        parent : {id: 'mqtt', name: 'MQTT', write: true, role: 'json'},
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
    name : {id: 'name', name: 'Name', write: true, role: 'info.name'},
    networkStatus : {
        parent : {id: 'network', name: 'Network', role: 'json'},
        subIDs : {
            mode    : {id: 'mode', name: 'Mode', type: 'number', states: {1: 'Station', 2: 'AccessPoint'}},
            station : {
                parent : {id: 'station', name: 'Station', role: 'json'},
                subIDs : {
                    ip     : {id: 'ip',         name: 'IP'},
                    gw     : {id: 'gateway',    name: 'Gateway'},
                    mask   : {id: 'subnetmask', name: 'Subnetmask'},
                    rssi   : {id: 'rssi',       name: 'RSSI',        type: 'number'},
                    ssid   : {id: 'ssid',       name: 'SSID'},
                    status : {id: 'status',     name: 'Status', deprecated: '2.8.3'},
                },
                expandJSON: true
            },
            ap : {
                parent : {id: 'accesspoint', name: 'AccessPoint', write: false, role: 'json'},
                subIDs : {
                    enc              : {id: 'encrypted',       name: 'Encrypted',        type: 'number', states: {0: 'No encryption', 2: 'WPA1', 3: 'WPA2', 4: 'WPA1+WPA2'}},
                    ip               : {id: 'ip',              name: 'IP'},
                    channel          : {id: 'channel',         name: 'Channel',          type: 'number'},
                    max_connections  : {id: 'maxConnections',  name: 'Max Connections',  type: 'number'},
                    password_changed : {id: 'passwordChanged', name: 'Password Changed', type: 'number', states: {0: 'False', 1: 'True'}},
                    ssid             : {id: 'ssid',            name: 'SSID'},
                    ssid_hidden      : {id: 'ssidHidden',      name: 'SSID Hidden',      type: 'number', states: {0: 'False', 1: 'True'}}
                },
                expandJSON: true
            }
        },
        expandJSON: true
    },
    on     : {id: 'on',       name: 'On',               write: true, type: 'boolean', role: 'switch', def: false},
    paused : {id: 'paused',   name: 'Pause Connection', write: true, type: 'boolean', role: 'switch', def: false},
    reset  : {id: 'reset',    name: 'Reset',            write: true, type: 'boolean', role: 'button'},
    status : {id: 'status',   name: 'Status', role: 'json'},
    timer  : {
        parent : {id: 'timer', name: 'Timer', write: true, role: 'json'},
        subIDs : {
            time_now : {id: 'timeNow',  name: 'Now',      write: true, type: 'number'},
            time_on  : {id: 'timeOn',   name: 'On',       write: true, type: 'number'},
            time_off : {id: 'timeOff',  name: 'Off',      write: true, type: 'number'},
            tz       : {id: 'timeZone', name: 'Timezone', write: true}
        },
        expandJSON: true
    },

    connected : {id: 'connected', name: 'Connected', type: 'boolean', role: 'indicator.connected'}
};

/**
 * Anzulegende States
 * @type {[]}
 */
const statesConfig = [
    stateNames.connected.id,
    stateNames.firmware.id,
    stateNames.ledBri.id,
    stateNames.ledColor.parent.id,
    // stateNames.ledConfig.id,
    stateNames.ledEffect.id,
    // stateNames.ledLayout.parent.id, Prüfen, weshalb es nicht klappt
    stateNames.ledMode.parent.id,
    stateNames.ledMovie.id,
    stateNames.ledSat.id,
    stateNames.name.id,
    stateNames.on.id,
    stateNames.paused.id,
    stateNames.ledPlaylist.id,
    stateNames.timer.parent.id
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
                    adapter.log.warn(`State ${id} unknown, will not be processed!`);
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
                            startInterval(1000, connectionName);
                            return;
                        }
                    }

                // Nur ausführen, wenn Gerät nicht pausiert ist!
                } else if (connection.paused) {
                    adapter.log.debug(`[stateChange] ${connection.name} is paused!`);
                    return;
                }

                // Ping-Check
                await checkConnection(connectionName);

                // Nur ausführen, wenn Gerät verbunden ist!
                if (!connection.connected) {
                    adapter.log.debug(`[stateChange] ${connection.name} is not available!`);
                    return;
                }

                // LED Brightness
                if (!group && command === stateNames.ledBri.id) {
                    if (state.val === -1) {
                        try {
                            await connection.twinkly.setBrightnessDisabled();
                            startInterval(1000, connectionName, [stateNames.ledBri.id]);
                        } catch (e) {
                            adapter.log.error(`[${connectionName}.${command}] Could not disable! ${e.message}`);
                        }
                    } else {
                        try {
                            await connection.twinkly.setBrightnessAbsolute(state.val);
                            startInterval(1000, connectionName, [stateNames.ledBri.id]);
                        } catch (e) {
                            adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                        }
                    }

                // LED Color (mode = color)
                } else if (group && group === stateNames.ledColor.parent.id) {
                    try {
                        if ([stateNames.ledColor.subIDs.hue.id, stateNames.ledColor.subIDs.saturation.id, stateNames.ledColor.subIDs.value.id].includes(command)) {
                            /** @type {{hue: Number, saturation: Number, value: Number}} */
                            const json = {hue: 0, saturation: 0, value: 0};
                            await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.ledColor.subIDs, {
                                id: command,
                                val: state.val
                            });

                            await connection.twinkly.setLEDColorHSV(json.hue, json.saturation, json.value);
                            startInterval(1000, connectionName, [stateNames.ledColor.parent.id]);

                        } else if ([stateNames.ledColor.subIDs.red.id, stateNames.ledColor.subIDs.green.id, stateNames.ledColor.subIDs.blue.id, stateNames.ledColor.subIDs.white.id, stateNames.ledColor.subIDs.hex.id].includes(command)) {
                            /** @type {{red: Number, green: Number, blue: Number, white: Number}} */
                            const json = {red: 0, green: 0, blue: 0, white: -1};

                            if ([stateNames.ledColor.subIDs.red.id, stateNames.ledColor.subIDs.green.id, stateNames.ledColor.subIDs.blue.id, stateNames.ledColor.subIDs.white.id].includes(command)) {
                                await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.ledColor.subIDs, {
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
                            startInterval(1000, connectionName, [stateNames.ledColor.parent.id]);
                        }
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Config
                } else if (!group && command === stateNames.ledConfig.id) {
                    try {
                        await connection.twinkly.setLEDConfig(state.val);
                        startInterval(1000, connectionName, [stateNames.ledConfig.id]);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Effect
                } else if (!group && command === stateNames.ledEffect.id) {
                    try {
                        if (!Object.keys(connection.twinkly.ledEffects).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                            adapter.log.warn(`[${connectionName}.${command}] Effect ${state.val} does not exist!`);
                            startInterval(1000, connectionName, [stateNames.ledEffect.id]);

                        } else {
                            await connection.twinkly.setCurrentLEDEffect(state.val);
                            startInterval(1000, connectionName, [stateNames.ledEffect.id]);
                        }
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Layout
                } else if (group && group === stateNames.ledLayout.parent.id) {
                    /** @type {{aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean}} */
                    const json = {aspectXY: 0, aspectXZ: 0, coordinates: [], source: '', synthesized: false};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.ledLayout.subIDs, {id: command, val: state.val});

                    try {
                        await connection.twinkly.uploadLayout(json.aspectXY, json.aspectXZ, json.coordinates, json.source, json.synthesized);
                        startInterval(1000, connectionName, [stateNames.ledLayout.parent.id]);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Mode
                } else if (!group && command === stateNames.ledMode.subIDs.mode.id) {
                    try {
                        if (!Object.values(twinkly.lightModes.value).includes(state.val)) {
                            adapter.log.warn(`[${connectionName}.${command}] Could not set ${state.val}! Mode does not exist!`);
                            startInterval(1000, connectionName, [stateNames.ledMode.parent.id]);

                        } else if (state.val === twinkly.lightModes.value.movie && Object.keys(connection.twinkly.ledMovies).length === 0) {
                            adapter.log.warn(`[${connectionName}.${command}] Could not set Mode ${twinkly.lightModes.text.movie}! No movie available! Is a Effect/Playlist selected?`);
                            startInterval(1000, connectionName, [stateNames.ledMode.parent.id, stateNames.ledMovie.id]);

                        } else if (state.val === twinkly.lightModes.value.playlist && Object.keys(connection.twinkly.playlist).length === 0) {
                            adapter.log.warn(`[${connectionName}.${command}] Could not set Mode ${twinkly.lightModes.text.playlist}! No movie available! Is a Playlist created?`);
                            startInterval(1000, connectionName, [stateNames.ledMode.parent.id, stateNames.ledPlaylist.id]);

                        } else {
                            await connection.twinkly.setLEDMode(state.val);
                            startInterval(1000, connectionName, [stateNames.ledMode.parent.id]);
                        }
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Saturation
                } else if (!group && command === stateNames.ledSat.id) {
                    if (state.val === -1) {
                        try {
                            await connection.twinkly.setSaturationDisabled();
                            startInterval(1000, connectionName, [stateNames.ledSat.id]);
                        } catch (e) {
                            adapter.log.error(`[${connectionName}.${command}] Could not disable! ${e.message}`);
                        }
                    } else {
                        try {
                            await connection.twinkly.setSaturationAbsolute(state.val);
                            startInterval(1000, connectionName, [stateNames.ledSat.id]);
                        } catch (e) {
                            adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                        }
                    }

                // LED Movie
                } else if (!group && command === stateNames.ledMovie.id) {
                    try {
                        if (!Object.keys(connection.twinkly.ledMovies).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                            adapter.log.warn(`[${connectionName}.${command}] Movie ${state.val} does not exist!`);
                            startInterval(1000, connectionName, [stateNames.ledMovie.id]);

                        } else {
                            await connection.twinkly.setCurrentMovie(state.val);
                            startInterval(1000, connectionName);
                        }
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // LED Playlist
                } else if (!group && command === stateNames.ledPlaylist.id) {
                    try {
                        if (!Object.keys(connection.twinkly.playlist).includes(typeof state.val === 'number' ? String(state.val) : state.val)) {
                            adapter.log.warn(`[${connectionName}.${command}] Playlist ${state.val} does not exist!`);
                            startInterval(1000, connectionName, [stateNames.ledPlaylist.id]);

                        } else {
                            await connection.twinkly.setCurrentPlaylistEntry(state.val);
                            startInterval(1000, connectionName);
                        }
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // MQTT anpassen
                } else if (group && group === stateNames.mqtt.parent.id) {
                    /** @type {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean}} */
                    const json = {broker_host: '', broker_port: 0, client_id: '', user: '', keep_alive_interval: 0, encryption_key_set: false};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});

                    try {
                        await connection.twinkly.setMqttConfiguration(json);
                        startInterval(1000, connectionName, [stateNames.mqtt.parent.id]);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // Namen anpassen
                } else if (!group && command === stateNames.name.id) {
                    try {
                        await connection.twinkly.setDeviceName(state.val);
                        startInterval(1000, connectionName, [stateNames.details.parent.id, stateNames.name.id]);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
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

                // Gerät ein-/ausschalten
                } else if (!group && command === stateNames.on.id) {
                    try {
                        await connection.twinkly.setLEDMode(state.val ? twinkly.lightModes.value.movie : twinkly.lightModes.value.off);
                        startInterval(1000, connectionName, [stateNames.ledMode.parent.id]);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // Reset
                } else if (!group && command === stateNames.reset.id) {
                    try {
                        await connection.twinkly.resetLED();
                        startInterval(1000, connectionName);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${command}] Could not set ${state.val}! ${e.message}`);
                    }

                // Timer anpassen
                } else if (group && group === stateNames.timer.parent.id) {
                    /** @type {{time_now: Number, time_on: Number, time_off: Number, tz: String}} */
                    const json = {time_now: -1, time_on: -1, time_off: -1, tz: ''};
                    await getJSONStates(connectionName, connectionName + '.' + group, json, stateNames.timer.subIDs, {id: command, val: state.val});

                    try {
                        // Prüfen ob Daten gesendet werden können
                        if ((json.time_on > -1 && json.time_off > -1) || (json.time_on === -1 && json.time_off === -1)) {
                            await connection.twinkly.setTimer(json);
                            startInterval(1000, connectionName, [stateNames.timer.parent.id]);
                        } else
                            adapter.log.debug(`[stateChange] Timer kann noch nicht übermittelt werden: (${json.time_on} > -1 && ${json.time_off} > -1) || (${json.time_on} === -1 && ${json.time_off} === -1)`);
                    } catch (e) {
                        adapter.log.error(`[${connectionName}.${group}.${command}] Could not set ${state.val}! ${e.message}`);
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
    clearInterval();

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
                try {
                    const state = await adapter.getStateAsync(connectionName + '.' + stateNames.paused.id);
                    connection.paused = state ? state.val : false;
                } catch (e) {
                    connection.paused = false;
                }
            }

            // Nicht pollen, wenn pausiert!
            if (connection.paused) {
                adapter.log.debug(`[poll] ${connectionName} is paused!`);
                continue;
            }

            // Ping-Check
            await checkConnection(connectionName);

            // Nur ausführen, wenn Gerät verbunden ist!
            if (!connection.connected) {
                adapter.log.debug(`[poll] ${connectionName} is not available!`);
                continue;
            }

            // Only load at startup
            if (initializing) {
                await updateEffects(connectionName);
            }

            if (canExecuteCommand(stateNames.details.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.details.parent.id}`);

                try {
                    const response = await connection.twinkly.getDeviceDetails();
                    if (response.code === twinkly.HTTPCodes.values.ok)
                        await saveJSONinState(connectionName, connectionName, response.details, stateNames.details);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.details.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.firmware.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.firmware.id}`);

                try {
                    const response = await connection.twinkly.getFirmwareVersion();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.firmware.id, response.version.version, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.firmware.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledBri.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledBri.id}`);

                try {
                    const response = await connection.twinkly.getBrightness();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledBri.id,
                                response.bri.mode !== 'disabled' ? response.bri.value : -1, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledBri.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledColor.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledColor.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDColor();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await saveJSONinState(connectionName, connectionName, response.color, stateNames.ledColor);

                        try {
                            // Hex Version
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledColor.parent.id + '.' + stateNames.ledColor.subIDs.hex.id,
                                tools.rgbToHex(response.color.red, response.color.green, response.color.blue, false), true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledColor.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledConfig.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledConfig.id}`);

                try {
                    const response = await connection.twinkly.getLEDConfig();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledConfig.id, JSON.stringify(response.config.strings), true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledConfig.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledEffect.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledEffect.id}`);

                try {
                    const response = await connection.twinkly.getCurrentLEDEffect();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        const effectId = response.effect.effect_id !== undefined ? response.effect.effect_id : response.effect.preset_id;

                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledEffect.id, effectId, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledEffect.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledLayout.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledLayout.parent.id}`);

                try {
                    const response = await connection.twinkly.getLayout();
                    if (response.code === twinkly.HTTPCodes.values.ok)
                        await saveJSONinState(connectionName, connectionName, response.layout, stateNames.ledLayout);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledLayout.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledMode.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledMode.parent.id}`);

                try {
                    const response = await connection.twinkly.getLEDMode();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        await saveJSONinState(connectionName, connectionName, response.mode, stateNames.ledMode);
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.on.id, response.mode.mode !== twinkly.lightModes.value.off, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledMode.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledMovie.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledMovie.id}`);

                try {
                    // First update existing Movies...
                    await updateMovies(connectionName);
                    // ... then get current Movie
                    const response = await connection.twinkly.getCurrentMovie();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledMovie.id, response.movie.id, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledMovie.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledPlaylist.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledPlaylist.id}`);

                try {
                    // First update existing Playlist...
                    await updatePlaylist(connectionName);
                    // ... then get current Playlist Entry
                    const response = await connection.twinkly.getCurrentPlaylistEntry();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledPlaylist.id, response.playlist.id, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledPlaylist.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.ledSat.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.ledSat.id}`);

                try {
                    const response = await connection.twinkly.getSaturation();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.ledSat.id,
                                response.sat.mode !== 'disabled' ? response.sat.value : -1, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.ledSat.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.mqtt.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.mqtt.parent.id}`);

                try {
                    const response = await connection.twinkly.getMqttConfiguration();
                    if (response.code === twinkly.HTTPCodes.values.ok)
                        await saveJSONinState(connectionName, connectionName, response.mqtt, stateNames.mqtt);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.mqtt.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.name.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.name.id}`);

                try {
                    const response = await connection.twinkly.getDeviceName();
                    if (response.code === twinkly.HTTPCodes.values.ok) {
                        try {
                            await adapter.setStateAsync(connectionName + '.' + stateNames.name.id, response.name.name, true);
                        } catch (e) {
                            //
                        }
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.name.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.networkStatus.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.networkStatus.parent.id}`);

                try {
                    const response = await connection.twinkly.getNetworkStatus();
                    if (response.code === twinkly.HTTPCodes.values.ok)
                        await saveJSONinState(connectionName, connectionName, response.status, stateNames.networkStatus);
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.networkStatus.parent.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.status.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.status.id}`);

                try {
                    const response = await connection.twinkly.getStatus();
                    try {
                        await adapter.setStateAsync(connectionName + '.' + stateNames.status.id, response.code, true);
                    } catch (e) {
                        //
                    }
                } catch (e) {
                    adapter.log.error(`Could not get ${connectionName}.${stateNames.status.id} ${e}`);
                }
            }

            if (canExecuteCommand(stateNames.timer.parent.id)) {
                adapter.log.debug(`[poll.${connectionName}] Polling ${stateNames.timer.parent.id}`);

                try {
                    const response = await connection.twinkly.getTimer();
                    if (response.code === twinkly.HTTPCodes.values.ok)
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

    startInterval(adapter.config.interval * 1000);
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
    if (adapter.config.usePing === undefined)
        adapter.config.usePing = true;

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
    if (inspector.url() !== undefined) {
        statesConfig.push(stateNames.ledMovies.id);
        // statesConfig.push(stateNames.status.id);
    }

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
                else
                    connections[deviceName] = {
                        enabled   : device.enabled,
                        paused    : false,
                        name      : deviceName,
                        host      : device.host,
                        connected : false,
                        twinkly   : new twinkly.Twinkly(adapter, deviceName, device.host, handleSentryMessage)
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
 * Konfiguration aufbereiten um die States/Objekte anzulegen
 * @returns {Promise<{}>}
 */
async function prepareObjectsByConfig() {
    /**
     *
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
                common  : getCommon(states[state].parent !== undefined ? states[state].parent : states[state], displayPrevName, prevChannel),
                native  : {},
                exclude : []
            };

            if (!states[state].hide) {
                if (states[state].parent !== undefined) {
                    if (states[state].subIDs !== undefined && states[state].expandJSON) {
                        // Soll der Parent angezeigt werden
                        if (!states[state].parent.hide) {
                            stateObj.id.channel += (stateObj.id.channel !== '' ? '.' : '') + states[state].parent.id;
                            config.channels.push(stateObj);

                            await prepareConfig(config, states[state].subIDs, false, true, stateObj);
                        } else {
                            // Sonst States auf Grandparent erstellen
                            await prepareConfig(config, states[state].subIDs, false, false, prevChannel);
                        }
                    } else {
                        stateObj.id.state = states[state].parent.id;
                        if (states[state].parent.exclude)
                            stateObj.exclude = states[state].parent.exclude;

                        config.states.push(stateObj);
                    }
                } else {
                    let canAddState = true;
                    if (connections[config.device.id.device].connected) {
                        if (canAddState && states[state].filter !== undefined)
                            canAddState = await connections[config.device.id.device].twinkly.checkDetailInfo(states[state].filter);
                        if (canAddState && states[state].newSince !== undefined)
                            canAddState = tools.versionGreaterEqual(states[state].newSince, connections[config.device.id.device].twinkly.firmware);
                    }

                    if (canAddState) {
                        stateObj.id.state = states[state].id;
                        if (states[state].exclude)
                            stateObj.exclude = states[state].exclude;

                        config.states.push(stateObj);
                    }
                }
            }
        }
    }

    const result = [];
    for (const connection of Object.keys(connections)) {
        // Ping-Check
        await checkConnection(connection);

        // Interview
        try {
            if (connections[connection].connected)
                await connections[connection].twinkly.interview();
        } catch (error) {
            adapter.log.error(`Could not interview ${connection} ${error}`);
        }

        const config = {
            device: {
                id     : {device : connection},
                common : {name   : connections[connection].name},
                native : {host   : connections[connection].twinkly.host}
            },
            states   : [],
            channels : []
        };

        await prepareConfig(config, stateNames, true, false, config.device);

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
 * @param connection <String>
 * @param state <String>
 * @param json <{} | undefined>
 * @param mapping <{parent: {id: string, name: string}, subIDs: {[x: string]: {id: string, name: string}}, expandJSON: boolean, logItem?: boolean, hide: boolean}>
 */
async function saveJSONinState(connection, state, json, mapping) {
    if (typeof json === undefined) return;

    mapping.logItem = mapping.logItem !== undefined && mapping.logItem === true;
    if (mapping.hide) return;

    /**
     *
     * @param {String} id
     * @param {{hide?: Boolean; filter?: {name: String, val: any}; role?: String}} stateInfo
     * @param {any} value
     * @param {Boolean} stringify
     */
    async function writeState(id, stateInfo, value, stringify) {
        let canSetState = !stateInfo.hide;
        if (canSetState && stateInfo.filter !== undefined)
            canSetState = await connections[connection].twinkly.checkDetailInfo(stateInfo.filter);
        if (canSetState) {
            // Unix * 1000
            if (!stringify && stateInfo.role === 'value.time')
                value = value * 1000;

            try {
                await adapter.setStateAsync(id === state ? state : state + '.' + id, stringify ? JSON.stringify(value) : value, true);
            } catch (e) {
                //
            }
        }
    }

    if (mapping.expandJSON) {
        if (!mapping.parent.hide) {
            state += '.' + mapping.parent.id;
            await writeState(state, mapping.parent, json, true);
        }

        for (const key of Object.keys(json)) {
            if (Object.keys(mapping.subIDs).includes((key))) {
                if (typeof json[key] !== 'object' || Array.isArray(json[key])) {
                    await writeState(mapping.subIDs[key].id, mapping.subIDs[key], json[key], Array.isArray(json[key]));
                } else {
                    await saveJSONinState(connection, state, json[key], mapping.subIDs[key]);
                }
            } else {
                handleSentryMessage(connection, 'saveJSONinState',
                    `${state.replace(connection, '####')}:${key}`, `Unhandled Item detected! ` +
                    `(${state.replace(connection, '')}.${key}, ${JSON.stringify(json[key])}, ${typeof json[key]})`);
            }
        }
    } else {
        await writeState(mapping.parent.id, mapping, json, true);
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
 * Update DP States from effects
 * @param connectionName
 * @return {Promise<void>}
 */
async function updateEffects(connectionName) {
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    try {
        await connection.twinkly.getListOfLEDEffects();
    } catch (e) {
        adapter.log.error(`[updateEffects.${connectionName}] Could not get effects! ${e.message}`);
        return;
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + stateNames.ledEffect.id, connection.twinkly.ledEffects);
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
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    try {
        const response = await connection.twinkly.getListOfMovies();
        if (statesConfig.includes(stateNames.ledMovies.id)) {
            try {
                await adapter.setStateAsync(connectionName + '.' + stateNames.ledMovies.id, JSON.stringify(response.movies.movies), true);
            } catch (e) {
                //
            }
        }
    } catch (e) {
        adapter.log.error(`[updateMovies.${connectionName}] Could not get movies ${e}`);
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + stateNames.ledMovie.id, connection.twinkly.ledMovies);
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
    if (!Object.keys(connections).includes(connectionName)) return;

    const connection = connections[connectionName];

    try {
        await connection.twinkly.getPlaylist();
    } catch (e) {
        adapter.log.error(`[updatePlaylist.${connectionName}] Could not get playlist ${e}`);
    }

    try {
        await stateTools.addStates2Object(adapter, connectionName + '.' + stateNames.ledPlaylist.id, connection.twinkly.playlist);
    } catch (e) {
        adapter.log.error(`[updatePlaylist.${connectionName}] Cannot update playlist! ${e.message}`);
    }
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
    try {
        if (adapter.config.usePing) {
            connection.connected = await connection.twinkly.ping();
        } else {
            const response = await connection.twinkly.getDeviceDetails();
            connection.connected = response.code === twinkly.HTTPCodes.values.ok;
        }
    } catch (e) {
        connection.connected = false;
        adapter.log.info(`[checkConnection] Could not ping ${connectionName}: ${e.message}`);
    }

    try {
        await adapter.setStateAsync(connectionName + '.' + stateNames.connected.id, connection.connected, true);
    } catch (e) {
        //
    }
}

/**
 * Handle Sentry Messages and check if already sent
 * @param connectionName <String>
 * @param functionName <String>
 * @param key <String>
 * @param message <String>
 */
function handleSentryMessage(connectionName, functionName, key, message) {
    adapter.log.debug(`[${functionName}] ${key} - ${message}`);

    const sentryKey = `${functionName}:${key}`;

    if (Object.keys(connections).includes(connectionName)) {
        const connection = connections[connectionName];

        message += `, fw=${connection.twinkly.firmware}, fwFamily=${connection.twinkly.details.fw_family}`;
    }

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

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}