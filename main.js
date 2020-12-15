'use strict';

const utils      = require('@iobroker/adapter-core');
const ping       = require('./lib/ping');
const twinkly    = require('./lib/twinkly');
const stateTools = require('./lib/stateTools');

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
 * @type {{{enabled: Boolean, name: String, host: String, connected: Boolean, twinkly: Twinkly}}}
 */
const connections = {};

/**
 * Liste aller States
 * @type {{connection: String, group: String, command: String}}
 */
const subscribedStates = {};

/**
 * Namen der einzelnen States, Mapping für das Speichern nach dem Polling
 * @type {{{name: string, id: string | {}}}}
 */
const stateNames = {
    on   : {id: 'on',   name: 'On',         write: true, type: 'boolean', role: 'switch', def: false},
    mode : {id: 'mode', name: 'Mode',       write: true, type: 'string',  role: 'state', def: twinkly.lightModes.value.off, states: twinkly.lightModes.text},
    bri  : {id: 'bri',  name: 'Brightness', write: true, type: 'number',  role: 'level.dimmer', min: 0, max: 100},
    name : {id: 'name', name: 'Name',       write: true, type: 'string',  role: 'info.name'},
    mqtt : {
        parent : {id: 'mqtt', name: 'MQTT', write: true, type: 'string', role: 'json'},
        subIDs : {
            broker_host         : {id: 'broker_host', name: 'Broker Host', write: true},
            broker_port         : {id: 'broker_port', name: 'Broker Port', write: true, type: 'number'},
            client_id           : {id: 'client_id', name: 'Client ID', write: true},
            user                : {id: 'user', name: 'User', write: true},
            keep_alive_interval : {id: 'keep_alive_interval', name: 'Keep Alive Interval', write: true, type: 'number', def: 60}
        }
    },
    timer : {
        parent : {id: 'timer', name: 'Timer', write: true, type: 'string', role: 'json'},
        subIDs : {
            time_now : {id: 'time_now', name: 'Now', write: true, type: 'number'},
            time_on  : {id: 'time_on',  name: 'On',  write: true, type: 'number'},
            time_off : {id: 'time_off', name: 'Off', write: true, type: 'number'}
        }
    },
    reset   : {id: 'reset', name: 'Name', write: true, type: 'boolean', role: 'button'},
    details : {
        parent : {id: 'details', name: 'Details', write: true, type: 'string', role: 'json'},
        subIDs : {
            product_name        : {id: 'product_name',        name: 'Product Name'},
            hardware_version    : {id: 'hardware_version',    name: 'Hardware Version'},
            bytes_per_led       : {id: 'bytes_per_led',       name: 'Bytes per LED',       type: 'number'},
            hw_id               : {id: 'hw_id',               name: 'Hardware ID'},
            flash_size          : {id: 'flash_size',          name: 'Flash Size',          type: 'number'},
            led_type            : {id: 'led_type',            name: 'LED Type',            type: 'number'},
            product_code        : {id: 'product_code',        name: 'Product Code'},
            fw_family           : {id: 'fw_family',           name: 'Firmware Family'},
            device_name         : {id: 'device_name',         name: 'Device Name'},
            uptime              : {id: 'uptime',              name: 'Uptime',              type: 'number'},
            mac                 : {id: 'mac',                 name: 'MAC'},
            uuid                : {id: 'uuid',                name: 'UUID'},
            max_supported_led   : {id: 'max_supported_led',   name: 'Max Supported LED',   type: 'number'},
            number_of_led       : {id: 'number_of_led',       name: 'Number of LED',       type: 'number'},
            led_profile         : {id: 'led_profile',         name: 'LED Profile'},
            frame_rate          : {id: 'frame_rate',          name: 'Frame Rate',          type: 'number'},
            measured_frame_rate : {id: 'measured_frame_rate', name: 'Measured Frame Rate', type: 'number'},
            movie_capacity      : {id: 'movie_capacity',      name: 'Movie Capacity',      type: 'number'},
            wire_type           : {id: 'wire_type',           name: 'Wired Type',          type: 'number'},
            copyright           : {id: 'copyright',           name: 'Copyright'},
            base_leds_number    : {id: 'base_leds_number',    name: 'Base LEDs Number'}
        }
    },
    firmware      : {id: 'firmware', name: 'Firmware'},
    networkStatus : {
        parent : {id: 'network', name: 'Network', write: false, type: 'string', role: 'json'},
        subIDs : {
            mode    : {id: 'mode', name: 'Mode', write: false, type: 'number'},
            station : {
                parent : {id: 'station', name: 'Station', write: false, type: 'string', role: 'json'},
                subIDs : {
                    ssid : {id: 'ssid',       name: 'SSID',       write: false},
                    ip   : {id: 'ip',         name: 'IP',         write: false},
                    gw   : {id: 'gateway',    name: 'Gateway',    write: false},
                    mask : {id: 'subnetmask', name: 'Subnetmask', write: false}
                }
            },
            ap : {
                parent : {id: 'accesspoint', name: 'AccessPoint', write: false, type: 'string', role: 'json'},
                subIDs : {
                    ssid            : {id: 'ssid',            name: 'SSID',            write: false},
                    channel         : {id: 'channel',         name: 'Channel',         write: false},
                    ip              : {id: 'ip',              name: 'IP',              write: false},
                    enc             : {id: 'encrypted',       name: 'Encrypted',       write: false, type: 'number'},
                    ssid_hidden     : {id: 'ssid_hidden',     name: 'SSID Hidden',     write: false, type: 'number'},
                    max_connections : {id: 'max_connections', name: 'Max Connections', write: false, type: 'number'}
                }
            }
        }
    }

    // movieConfig   : 'movieConfig'
};

/**
 * Anzulegende States
 * @type {[]}
 */
const statesConfig = [
    stateNames.on.id,
    stateNames.mode.id,
    stateNames.bri.id,
    stateNames.name.id,
    stateNames.timer.parent.id,
    stateNames.firmware.id,
    stateNames.reset.id
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
                for (const connection of Object.keys(connections))
                    connections[connection].twinkly.logout().catch(error => {
                        adapter.log.error(`[onStop.${connections[connection].twinkly.name}] ${error}`);
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
                    connection = subscribedStates[id].connection,
                    group      = subscribedStates[id].group,
                    command    = subscribedStates[id].command;

                // Nur ausführen, wenn Gerät verbunden ist!
                if (!connections[connection].connected) {
                    adapter.log.debug(`[stateChange] ${connections[connection].name} ist nicht verfügbar!`);
                    return;
                }

                // Gerät ein-/ausschalten
                if (!group && command === stateNames.on.id) {
                    connections[connection].twinkly.set_mode(state.val ? twinkly.lightModes.value.on : twinkly.lightModes.value.off)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });

                // Mode anpassen
                } else if (!group && command === stateNames.mode.id) {
                    connections[connection].twinkly.set_mode(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });

                // Helligkeit anpassen
                } else if (!group && command === stateNames.bri.id) {
                    connections[connection].twinkly.set_brightness(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {adapter.log.error(`Could not set ${connection}.${command} ${error}`);});

                // Namen anpassen
                } else if (!group && command === stateNames.name) {
                    connections[connection].twinkly.set_name(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(
                            error => {adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                            });

                // MQTT anpassen
                } else if (!group && command === stateNames.mqtt.parent.id) {
                    connections[connection].twinkly.set_mqtt(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });
                } else if (group && group === stateNames.mqtt.parent.id) {
                    const json = {};
                    await getJSONStates(connection + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});

                    connections[connection].twinkly.set_mqtt(json)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });

                // NetoworkStatus anpassen
                } else if (!group && command === stateNames.networkStatus.parent.id) {
                    // connections[connection].twinkly.set_network_status(state.val)
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                    //     });
                } else if (group && group === stateNames.networkStatus.parent.id) {
                    // const json = {};
                    // await getJSONStates(connection + '.' + group, json, stateNames.mqtt.subIDs, {id: command, val: state.val});
                    //
                    // connections[connection].twinkly.set_mqtt_str(JSON.stringify(json))
                    //     .catch(error => {
                    //         adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                    //     });

                // Timer anpassen
                } else if (!group && command === stateNames.timer.parent.id) {
                    connections[connection].twinkly.set_timer(state.val)
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });
                } else if (group && group === stateNames.timer.parent.id) {
                    const json = {};
                    await getJSONStates(connection + '.' + group, json, stateNames.timer.subIDs, {id: command, val: state.val});

                    // Prüfen ob Daten gesendet werden können
                    if ((json.time_on > -1 && json.time_off > -1) || (json.time_on === -1 && json.time_off === -1)) {
                        connections[connection].twinkly.set_timer(json)
                            .then(({code}) => {
                                if (code === twinkly.HTTPCodes.values.ok) poll();
                            })
                            .catch(error => {
                                adapter.log.error(`Could not set ${connection}.${group}.${command} ${error}`);
                            });
                    } else
                        adapter.log.debug(`[stateChange] Timer kann noch nicht übermittelt werden: (${json.time_on} > -1 && ${json.time_off} > -1) || (${json.time_on} === -1 && ${json.time_off} === -1)`);

                // Reset
                } else if (!group && command === stateNames.reset.id) {
                    await adapter.setState(id, false, true);
                    connections[connection].twinkly.reset()
                        .then(({code}) => {
                            if (code === twinkly.HTTPCodes.values.ok) poll();
                        })
                        .catch(error => {
                            adapter.log.error(`Could not set ${connection}.${command} ${error}`);
                        });
                }
            } else {
                // The state was deleted
                adapter.log.debug(`[stateChange] state ${id} deleted`);
            }
        }
    }));
}

async function poll() {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
        pollingInterval = null;
    }

    adapter.log.debug(`[poll] Start polling...`);
    try {
        for (const connection of Object.keys(connections)) {
            // Ping-Check
            await ping.probe(connections[connection].host, {log: adapter.log.debug})
                .then(({host, alive, ms}) => {
                    adapter.log.debug('[poll] Ping result for ' + host + ': ' + alive + ' in ' + (ms === null ? '-' : ms) + 'ms');

                    connections[connection].connected = alive;
                    adapter.setState(connection + '.connected', connections[connection].connected, true);
                })
                .catch(error => {
                    adapter.log.error(connection + ': ' + error);
                });

            // Nur ausführen, wenn Gerät verbunden ist!
            if (!connections[connection].connected) {
                adapter.log.debug(`[poll] ${connection} ist nicht verfügbar!`);
                continue;
            }

            for (const command of statesConfig) {
                adapter.log.debug(`[poll] Polling ${connection}.${command}`);

                if (command === stateNames.mode.id) {
                    await connections[connection].twinkly.get_mode()
                        .then(async ({mode}) => {
                            adapter.setStateAsync(connection + '.' + stateNames.on.id, mode.mode !== twinkly.lightModes.value.off, true);
                            adapter.setStateAsync(connection + '.' + stateNames.mode.id, mode.mode, true);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.bri.id) {
                    await connections[connection].twinkly.get_brightness()
                        .then(async ({bri}) => {
                            await adapter.setStateAsync(connection + '.' + command, bri.value, true);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.name.id) {
                    await connections[connection].twinkly.get_name()
                        .then(async ({name}) => {
                            adapter.setStateAsync(connection + '.' + command, name.name, true);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.mqtt.parent.id) {
                    await connections[connection].twinkly.get_mqtt()
                        .then(async ({mqtt}) => {
                            saveJSONinState(connection, mqtt, stateNames.mqtt);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.networkStatus.parent.id) {
                    await connections[connection].twinkly.get_network_status()
                        .then(async ({status}) => {
                            saveJSONinState(connection, status, stateNames.networkStatus);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.timer.parent.id) {
                    await connections[connection].twinkly.get_timer()
                        .then(async ({timer}) => {
                            saveJSONinState(connection, timer, stateNames.timer);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.details.parent.id) {
                    await connections[connection].twinkly.get_details()
                        .then(async ({details}) => {
                            saveJSONinState(connection, details, stateNames.details);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });

                } else if (command === stateNames.firmware.id) {
                    await connections[connection].twinkly.get_firmware_version()
                        .then(async ({version}) => {
                            adapter.setStateAsync(connection + '.' + command, version.version, true);
                        })
                        .catch(error => {
                            adapter.log.error(`Could not get ${connection}.${command} ${error}`);
                        });
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
    adapter.config.interval = parseInt(adapter.config.interval, 10) < 15 ? 15 : parseInt(adapter.config.interval);
    if (adapter.config.devices === undefined)
        adapter.config.devices = {};
    if (adapter.config.details === undefined)
        adapter.config.details = false;
    if (adapter.config.mqtt === undefined)
        adapter.config.mqtt = false;
    if (adapter.config.network === undefined)
        adapter.config.network = false;
    if (adapter.config.expandJSON === undefined)
        adapter.config.expandJSON = false;

    // States/Objekte anlegen...
    syncConfig()
        .then(result => {
            if (result)
                // Polling starten...
                pollingInterval = setTimeout(async () => {await poll();}, 5000);
            else
                adapter.log.error('Polling wird nicht gestartet!');
        })
        .catch(error => {
            adapter.log.error(error);
        });
}

/**
 * Konfiguration auslesen und verarbeiten
 * @return Promise<Boolean>
 */
function syncConfig() {
    return new Promise((resolve, reject) => {
        // Details hinzufügen, wenn gewünscht
        if (adapter.config.details)
            statesConfig.push(stateNames.details.parent.id);
        // MQTT hinzufügen, wenn gewünscht
        if (adapter.config.mqtt)
            statesConfig.push(stateNames.mqtt.parent.id);
        // Network hinzufügen, wenn gewünscht
        if (adapter.config.network)
            statesConfig.push(stateNames.networkStatus.parent.id);

        let result = true;
        try {
            adapter.log.debug('[syncConfig] config devices: '    + JSON.stringify(adapter.config.devices));
            adapter.log.debug('[syncConfig] config interval: '   + adapter.config.interval);
            adapter.log.debug('[syncConfig] config details: '    + adapter.config.details);
            adapter.log.debug('[syncConfig] config mqtt: '       + adapter.config.mqtt);
            adapter.log.debug('[syncConfig] config expandJSON: ' + adapter.config.expandJSON);

            if (!adapter.config.devices) {
                adapter.log.warn('no connections added...');
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
                    const deviceName = device.name.replace(/[\][*,;'"`<>\\?]/g, '_').replace(/[.\s]+/g, '_');
                    if (Object.keys(connections).includes(deviceName))
                        adapter.log.warn(`Objects with same id = ${stateTools.buildId({device: deviceName, channel: null, state: null}, adapter)} created for two connections ${JSON.stringify(device)}`);
                    else
                        connections[deviceName] = {
                            enabled        : device.enabled,
                            name           : device.name,
                            host           : device.host,
                            connected      : false,
                            twinkly        : new twinkly.Connection(adapter.log, device.name, device.host)
                        };
                }

            // Prüfung ob aktive Verbindungen verfügbar sind
            if (result && Object.keys(connections).length === 0) {
                result = false;
                adapter.log.warn('no enabled connections added...');
            }
        } catch (e) {
            result = false;
        }

        if (result) {
            adapter.log.debug('[syncConfig] Prepare objects');
            const preparedObjects = prepareObjectsByConfig();
            adapter.log.debug('[syncConfig] Get existing objects');

            adapter.getAdapterObjects(_objects => {
                adapter.log.debug('[syncConfig] Prepare tasks of objects update');
                const tasks = prepareTasks(preparedObjects, _objects);

                adapter.log.debug('[syncConfig] Start tasks of objects update');
                processTasks(tasks)
                    .then(response => {
                        result = response;
                        adapter.log.debug('[syncConfig] Finished tasks of objects update');
                    })
                    .catch(error => {
                        result = false;
                        reject(error);
                    });
            });
        }

        resolve(result);
    });
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

        if (config.min !== undefined)
            result.min = config.min;
        if (config.max !== undefined)
            result.max = config.max;

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
                id : {
                    device  : config.device.id.device,
                    channel : prevChannel.id.channel ? prevChannel.id.channel : ''
                },
                common : getCommon(states[state].parent !== undefined ? states[state].parent : states[state], prevChannel),
                native : {}
            };

            if (states[state].parent !== undefined) {

                if (adapter.config.expandJSON && states[state].subIDs !== undefined) {
                    stateObj.id.channel += (stateObj.id.channel !== '' ? '.' : '') + states[state].parent.id;
                    config.channels.push(stateObj);

                    prepareConfig(config, states[state].subIDs, false, stateObj);
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


    const result = [];
    for (const connection of Object.keys(connections)) {
        const config = {
            device: {
                id: {
                    device: connection
                },
                common: {
                    name: connections[connection].name
                },
                native: {
                    host: connections[connection].twinkly.host
                }
            },
            states  : [],
            channels: []
        };

        prepareConfig(config, stateNames, true, config.device);

        config.states.push({
            id: {device: connection, state: 'connected'},
            common: {
                name : config.device.common.name + ' Connected',
                read : true,
                write: false,
                type : 'boolean',
                role : 'indicator.connected',
                def  : false
            }
        });

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
                                type: 'update_channel',
                                id: channel.id,
                                data: {
                                    common: channel.common,
                                    native: channel.native
                                }
                            });
                        }
                        old_objects[fullID] = undefined;
                    } else {
                        channelsToUpdate.push({
                            type: 'create_channel',
                            id: channel.id,
                            data: {
                                common: channel.common,
                                native: channel.native
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
                                type: 'update_state',
                                id: state.id,
                                data: {
                                    common: state.common,
                                    native: state.native
                                }
                            });
                        }
                        old_objects[fullID] = undefined;
                    } else {
                        statesToUpdate.push({
                            type: 'create_state',
                            id: state.id,
                            data: {
                                common: state.common,
                                native: state.native
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
    const devicesToDelete  = oldEntries.filter(([id, object]) => object.type === 'device') .map(([id, object]) => ({ type: 'delete_device', id: id }));
    // eslint-disable-next-line no-unused-vars
    const channelsToDelete = oldEntries.filter(([id, object]) => object.type === 'channel').map(([id, object]) => ({ type: 'delete_channel', id: id }));
    // eslint-disable-next-line no-unused-vars
    const stateToDelete    = oldEntries.filter(([id, object]) => object.type === 'state')  .map(([id, object]) => ({ type: 'delete_state',  id: id }));

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
 * @return Promise<Boolean>
 */
function processTasks(tasks) {
    return new Promise((resolve, reject) => {
        if (!tasks || !tasks.length || tasks.length === 0) {
            reject('Tasks nicht gefüllt!');
        } else {
            while (tasks.length > 0) {
                const
                    task = tasks.shift(),
                    id   = stateTools.buildId(task.id, adapter);

                adapter.log.debug('[processTasks] Task: ' + JSON.stringify(task) + ', ID: ' + id);

                if (task.type === 'create_device') {
                    adapter.log.debug('[processTasks] Create device id=' + id);
                    stateTools.createDevice(adapter, task.id, task.data.common, task.data.native)
                        .catch(error => {
                            adapter.log.error('Cannot create device: ' + id + ' Error: ' + error);
                        });
                } else if (task.type === 'update_device') {
                    adapter.log.debug('[processTasks] Update device id=' + id);
                    adapter.extendObject(id, task.data, err => {
                        if (err) adapter.log.error('Cannot update device: ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'delete_device') {
                    adapter.log.debug('[processTasks] Delete device id=' + id);

                    adapter.delObject(id, err => {
                        if (err) adapter.log.error('Cannot delete device : ' + id + ' Error: ' + err);
                    });

                } else if (task.type === 'create_channel') {
                    adapter.log.debug('[processTasks] Create channel id=' + id);
                    stateTools.createChannel(adapter, task.id, task.data.common, task.data.native)
                        .catch(error => {
                            adapter.log.error('Cannot create channel: ' + id + ' Error: ' + error);
                        });
                } else if (task.type === 'update_channel') {
                    adapter.log.debug('[processTasks] Update channel id=' + id);

                    adapter.extendObject(id, task.data, err => {
                        err && adapter.log.error('Cannot update channel : ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'delete_channel') {
                    adapter.log.debug('[processTasks] Delete channel id=' + id);

                    adapter.delObject(id, err => {
                        err && adapter.log.error('Cannot delete channel : ' + id + ' Error: ' + err);
                    });

                } else if (task.type === 'create_state') {
                    adapter.log.debug('[processTasks] Create state id=' + id);
                    stateTools.createState(adapter, task.id, task.data.common, task.data.native)
                        .catch(error => {
                            adapter.log.error('Cannot create state: ' + id + ' Error: ' + error);
                        });
                } else if (task.type === 'update_state') {
                    adapter.log.debug('[processTasks] Update state id=' + id);

                    adapter.extendObject(id, task.data, err => {
                        if (err) adapter.log.error('Cannot update state : ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'delete_state') {
                    adapter.log.debug('[processTasks] Delete state id=' + id);

                    adapter.delObject(id, err => {
                        if (err) adapter.log.error('Cannot delete state : ' + id + ' Error: ' + err);
                    });
                } else
                    adapter.log.error('Unknown task type: ' + JSON.stringify(task));
            }

            resolve(true);
        }
    });
}

/**
 * Save States from JSON
 * @param state <String>
 * @param json <{}>
 * @param mapping <{}>
 */
function saveJSONinState(state, json, mapping) {
    if (adapter.config.expandJSON) {
        state += '.' + mapping.parent.id;
        adapter.setStateAsync(state, JSON.stringify(json), true);

        for (const key of Object.keys(json)) {
            if (Object.keys(mapping.subIDs).includes((key))) {
                if (typeof json[key] !== 'object')
                    adapter.setStateAsync(state + '.' + mapping.subIDs[key].id, json[key], true);
                else
                    saveJSONinState(state, json[key], mapping.subIDs[key]);
            } else
                adapter.log.warn(`[saveJSONinState] Unhandled Item <${key}> detected!`);
        }
    } else
        adapter.setStateAsync(state + '.' + mapping.parent.id, JSON.stringify(json), true);
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
        if (!Object.keys(json).includes((key))) {
            // Check LastState first
            if (lastState && mapping[key] === lastState.id)
                json[key] = lastState.val;
            else
                await adapter.getStateAsync(state + '.' + mapping[key])
                    .then(state => {
                        if (state)
                            json[key] = state.val;
                        else
                            json[key] = '';
                    });
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