'use strict';

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

const axios = require('axios').default;
// const CircularJSON = require('circular-json');

// Load your modules here, e.g.:
// const fs = require("fs");

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
 * @type {{{name: String, host: String, twinkly: Twinkly, connectedState: String, checkConnected: Boolean, connected: Boolean}}}
 */
const connections = {};

/**
 * Liste aller States
 * @type {{connection: String, command: String}}
 */
const subscribedStates = {};

/**
 * Namen der einzelnen States individualisieren
 * @type {{{name: string, id: string}}}
 */
const stateNames = {
    on            : 'on',
    mode          : 'mode',
    bri           : 'bri',
    name          : 'name',
    mqtt          : 'mqtt',
    timer         : 'timer',
    reset         : 'reset',
    // movieConfig   : 'movieConfig',
    // networkStatus : 'networkStatus',
    details       : 'details',
    firmware      : 'firmware'
};

/**
 * Anzulegende States
 * @type {[]}
 */
const statesConfig = [
    stateNames.on,
    stateNames.mode,
    stateNames.bri,
    stateNames.name
];

const LIGHT_MODES = {
    value: {
        rt       : 'rt',
        on       : 'movie',
        off      : 'off',
        playlist : 'playlist',
        demo     : 'demo',
        effect   : 'effect'
    },
    text : {
        rt       : 'Real Time',
        movie    : 'Eingeschaltet',
        off      : 'Ausgeschaltet',
        playlist : 'Playlist',
        demo     : 'Demo',
        effect   : 'Effect'
    }
};


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

        // is called if a subscribed state changes
        stateChange: async (id, state) => {
            if (state) {
                if (state.ack) return;

                // The state was changed
                adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

                // Ist der state bekannt?
                if (!Object.keys(subscribedStates).includes(id)) {
                    adapter.log.warn(`${id} wird nicht verarbeitet!`);
                    return;
                }

                const
                    connection = subscribedStates[id].connection,
                    command    = subscribedStates[id].command;

                // Nur ausführen, wenn Gerät verbunden ist!
                if (connections[connection].checkConnected && !connections[connection].connected) {
                    adapter.log.debug(`${connections[connection].name} ist nicht verfügbar!`);
                    return;
                }

                // Doppelte Ereignisse verhindern...
                // let action = 'set:' + command + ':' + obj.state.val;
                // if (devices[device].lastAction == action) return;
                // devices[device].lastAction = action;


                // Gerät ein-/ausschalten
                if (command === stateNames.on) {
                    connections[connection].twinkly.set_mode(state.val ? LIGHT_MODES.value.on : LIGHT_MODES.value.off)
                        .catch(error => {
                            adapter.log.error(`[${connection}${command}] ${error}`);
                        });

                // Mode anpassen
                } else if (command === stateNames.mode) {
                    connections[connection].twinkly.set_mode(state.val)
                        .catch(error => {
                            adapter.log.error(`[${connection}${command}] ${error}`);
                        });

                // Helligkeit anpassen
                } else if (command === stateNames.bri) {
                    connections[connection].twinkly.set_brightness(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Namen anpassen
                } else if (command === stateNames.name) {
                    connections[connection].twinkly.set_name(state.val)
                        .catch(
                            error => {adapter.log.error(`[${connection}${command}] ${error}`);
                            });

                // MQTT anpassen
                } else if (command === stateNames.mqtt) {
                    connections[connection].twinkly.set_mqtt_str(state.val)
                        .catch(error => {
                            adapter.log.error(`[${connection}${command}] ${error}`);
                        });

                // Timer anpassen
                } else if (command === stateNames.timer) {
                    connections[connection].twinkly.set_mqtt_str(state.val)
                        .catch(error => {
                            adapter.log.error(`[${connection}${command}] ${error}`);
                        });

                // Reset
                } else if (command === stateNames.reset) {
                    await adapter.setState(id, false, true);
                    connections[connection].twinkly.reset()
                        .catch(error => {
                            adapter.log.error(`[${connection}${command}] ${error}`);
                        });
                }
            } else {
                // The state was deleted
                adapter.log.info(`state ${id} deleted`);
            }
        }
    }));
}

async function poll() {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
        pollingInterval = null;
    }

    adapter.log.debug(`Start polling...`);
    for (const connection of Object.keys(connections)) {
        // Ping-Test
        // await adapter.sendToAsync('ping', 'ping', connections[connection].twinkly.host, )
        //     .then(result => {
        //         adapter.log.info('Polling: Ping Result=' + result);
        //     });

        // Connected abfragen
        if (connections[connection].checkConnected) {
            await adapter.getForeignStateAsync(connections[connection].connectedState)
                .then((state) => {
                    connections[connection].connected = state ? state.val : false;
                });

            adapter.setState(connection + '.connected', connections[connection].connected, true);

            // Nur ausführen, wenn Gerät verbunden ist!
            if (!connections[connection].connected) {
                adapter.log.debug(`${connection} ist nicht verfügbar!`);
                continue;
            }
        }

        // if (connections[connection].fetchActive) continue;
        // // Fetch gestartet und Flag setzen
        // connections[connection].fetchActive = true;

        for (const command of statesConfig) {
            adapter.log.debug(`Polling ${connection}.${command}`);

            if (command === stateNames.mode) {
                await connections[connection].twinkly.get_mode()
                    .then(async ({mode}) => {
                        adapter.setState(connection + '.' + stateNames.on, mode !== LIGHT_MODES.value.off, true);
                        adapter.setState(connection + '.' + stateNames.mode, mode, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.bri) {
                await connections[connection].twinkly.get_brightness()
                    .then(async ({value}) => {
                        await adapter.setState(connection + '.' + command, value, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.name) {
                await connections[connection].twinkly.get_name()
                    .then(async ({name}) => {
                        adapter.setState(connection + '.' + command, name, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.mqtt) {
                await connections[connection].twinkly.get_mqtt()
                    .then(async ({mqtt}) => {
                        adapter.setState(connection + '.' + command, JSON.stringify(mqtt), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.timer) {
                await connections[connection].twinkly.get_timer()
                    .then(async ({timer}) => {
                        adapter.setState(connection + '.' + command, JSON.stringify(timer), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.details) {
                await connections[connection].twinkly.get_details()
                    .then(async ({details}) => {
                        adapter.setState(connection + '.' + command, JSON.stringify(details), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });

            } else if (command === stateNames.firmware){
                await connections[connection].twinkly.get_firmware_version()
                    .then(async ({version}) => {
                        adapter.setState(connection + '.' + command, version, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}.${command}] ${error}`);
                    });
            }
        }
    }

    adapter.log.debug(`Finished polling...`);

    // Fetch abgeschlossen und Flag zurücksetzen
    // connections[connection].fetchActive = false;

    pollingInterval = setTimeout(async () => {await poll();}, adapter.config.polling * 1000);
}

async function main() {
    adapter.subscribeStates('*');

    adapter.config.polling = parseInt(adapter.config.polling, 10) < 15 ? 15 : parseInt(adapter.config.polling, 10);

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
        // Details und Firmware hinzufügen, wenn gewünscht
        if (adapter.config.showDeviceInfo) {
            statesConfig.push(stateNames.details);
            statesConfig.push(stateNames.firmware);
        }

        // Reset hinzufügen, wenn gewünscht
        if (adapter.config.reset)
            statesConfig.push(stateNames.reset);

        // MQTT hinzufügen, wenn gewünscht
        if (adapter.config.mqtt)
            statesConfig.push(stateNames.mqtt);

        // Timer hinzufügen, wenn gewünscht
        if (adapter.config.timer)
            statesConfig.push(stateNames.timer);

        let result = true;
        try {
            adapter.log.silly('config devices: '        + JSON.stringify(adapter.config.devices));
            adapter.log.silly('config polling: '        + adapter.config.polling);
            adapter.log.silly('config showDeviceInfo: ' + adapter.config.showDeviceInfo);
            adapter.log.silly('config reset: '          + adapter.config.reset);
            adapter.log.silly('config mqtt: '           + adapter.config.mqtt);
            adapter.log.silly('config timer: '          + adapter.config.timer);

            if (!adapter.config.devices) {
                result = false;
                adapter.log.warn('no connections added...');
            }

            // Verbindungen auslesen und erstellen
            if (result)
                for (const device of adapter.config.devices) {
                    // Verbindung aktiv?
                    if (!device.enabled) {
                        adapter.log.info(`${device.name} deaktiviert...`);
                        continue;
                    }

                    // Host gefüllt
                    if (device.host === '') {
                        adapter.log.warn(`${device.name}: Host nicht gefüllt!`);
                        continue;
                    }

                    // Verbindung anlegen
                    const deviceName = device.name.replace(/[\][*,;'"`<>\\?]/g, '_').replace(/[.\s]+/g, '_');
                    connections[deviceName] = {
                        enabled        : device.enabled,
                        name           : device.name,
                        host           : device.host,
                        twinkly        : new Twinkly(device.name, device.host),
                        connectedState : device.connectedState,
                        checkConnected : adapter.getState,
                        connected      : false
                    };

                    // Prüfen ob State existiert
                    if (typeof connections[deviceName].connectedState !== 'undefined')
                        adapter.getForeignObject(connections[deviceName].connectedState, (err, obj) => {
                            connections[deviceName].checkConnected = !err && obj != null;
                        });
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
            adapter.log.debug('Prepare objects');
            const preparedObjects = prepareObjectsByConfig();
            adapter.log.debug('Get existing objects');

            adapter.getAdapterObjects(_objects => {
                adapter.log.debug('Prepare tasks of objects update');
                const tasks = prepareTasks(preparedObjects, _objects);

                adapter.log.debug('Start tasks of objects update');
                processTasks(tasks)
                    .then(response => {
                        result = response;
                        adapter.log.debug('Finished tasks of objects update');
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
            states: []
        };

        if (statesConfig.includes(stateNames.on))
            config.states.push({
                id: {device: connection, state: stateNames.on},
                common: {
                    name : config.device.common.name + ' eingeschaltet',
                    read : true,
                    write: true,
                    type : 'boolean',
                    role : 'switch',
                    def  : false
                }
            });

        if (statesConfig.includes(stateNames.mode))
            config.states.push({
                id: {device: connection, state: stateNames.mode},
                common: {
                    name  : config.device.common.name + ' Mode',
                    read  : true,
                    write : true,
                    type  : 'string',
                    role  : 'state',
                    def   : LIGHT_MODES.value.off,
                    states: LIGHT_MODES.text}
            });

        if (statesConfig.includes(stateNames.bri))
            config.states.push({
                id: {device: connection, state: stateNames.bri},
                common: {
                    name : config.device.common.name + ' Brightness',
                    read : true,
                    write: true,
                    type : 'number',
                    role : 'level.dimmer',
                    min  : 0,
                    max  : 100,
                    def  : 0}
            });

        if (statesConfig.includes(stateNames.name))
            config.states.push({
                id: {device: connection, state: stateNames.name},
                common: {
                    name : config.device.common.name + ' Name',
                    read : true,
                    write: true,
                    type : 'string',
                    role : 'state',
                    def: ''}
            });

        if (statesConfig.includes(stateNames.mqtt))
            config.states.push({
                id: {device: connection, state: stateNames.mqtt},
                common: {
                    name : config.device.common.name + ' MQTT',
                    read : true,
                    write: true,
                    type : 'string',
                    role : 'state',
                    def  : '{}'}
            });

        if (statesConfig.includes(stateNames.timer))
            config.states.push({
                id: {device: connection, state: stateNames.timer},
                common: {
                    name : config.device.common.name + ' Timer',
                    read : true,
                    write: true,
                    type : 'string',
                    role : 'state',
                    def  : '{}'}
            });

        if (statesConfig.includes(stateNames.reset))
            config.states.push({
                id: {device: connection, state: stateNames.reset},
                common: {
                    name : config.device.common.name + ' Reset',
                    read : true,
                    write: true,
                    type : 'boolean',
                    role : 'button',
                    def  : false}
            });

        if (statesConfig.includes(stateNames.details))
            config.states.push({
                id: {device: connection, state: stateNames.details},
                common: {
                    name : config.device.common.name + ' Details',
                    read : true,
                    write: false,
                    type : 'string',
                    role : 'state',
                    def  : '{}'}
            });

        if (statesConfig.includes(stateNames.firmware))
            config.states.push({
                id: {device: connection, state: stateNames.firmware},
                common: {
                    name : config.device.common.name + ' Firmware',
                    read : true,
                    write: false,
                    type : 'string',
                    role : 'state',
                    def  : ''}
            });

        config.states.push({
            id: {device: connection, state: 'connected'},
            common: {
                name : config.device.common.name + ' Connected',
                read : true,
                write: false,
                type : 'boolean',
                role : 'indicator.connected',
                def  : false}
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
    const devicesToUpdate = [];
    const statesToUpdate  = [];

    try {
        for (const group of preparedObjects) {
            // Device prüfen
            if (group.device) {
                const fullID = buildId(group.device.id);
                const oldObj = old_objects[fullID];

                if (oldObj && oldObj.type === 'device') {
                    if (!areDevicesEqual(oldObj, group.device)) {
                        devicesToUpdate.push({
                            type: 'update_device',
                            id: group.device.id,
                            data: {
                                common: group.device.common,
                                native: group.device.native
                            }
                        });
                    }
                    old_objects[fullID] = undefined;
                } else {
                    devicesToUpdate.push({
                        type: 'create_device',
                        id: group.device.id,
                        data: {
                            common: group.device.common,
                            native: group.device.native
                        }
                    });
                }
            }

            // States prüfen
            for (const state of group.states) {
                const fullID = buildId(state.id);
                const oldObj = old_objects[fullID];

                // Nur wenn der State bearbeitet werden darf hinzufügen
                if (state.common.write)
                    subscribedStates[fullID] = {connection: state.id.device, command: state.id.state};

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
    } catch (e) {
        adapter.log.error(e.name + ': ' + e.message);
    }

    const oldEntries       = Object.keys(old_objects).map(id => ([id, old_objects[id]])).filter(([id, object]) => object);
    const devicesToDelete  = oldEntries.filter(([id, object]) => object.type === 'device').map(([id, object]) => ({ type: 'delete_device', id: id }));
    const stateToDelete    = oldEntries.filter(([id, object]) => object.type === 'state') .map(([id, object]) => ({ type: 'delete_state',  id: id }));

    return stateToDelete.concat(devicesToDelete, devicesToUpdate, statesToUpdate);
}

/**
 * areDevicesEqual
 * @param rhs
 * @param lhs
 * @returns {boolean}
 */
function areDevicesEqual(rhs, lhs) {
    return areObjectsEqual(rhs.common, lhs.common) &&
           areObjectsEqual(rhs.native, lhs.native);
}

/**
 * areStatesEqual
 * @param rhs
 * @param lhs
 * @returns {boolean}
 */
function areStatesEqual(rhs, lhs) {
    return areObjectsEqual(rhs.common, lhs.common);
}

/**
 * areObjectsEqual
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
 * buildId
 * @param id
 * @returns {string}
 */
function buildId(id) {
    if (typeof id === 'object')
        return adapter.namespace + (id.device ? '.' + id.device : '') + (id.state ? '.' + id.state : '');
    else
        return id;
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
                const task = tasks.shift(),
                    id = buildId(task.id);
                adapter.log.debug('Task: ' + JSON.stringify(task) + ', ID: ' + id);

                if (task.type === 'create_device') {
                    adapter.log.debug('Create device id=' + id);
                    try {
                        adapter.createDevice(task.id.device, task.data.common, task.data.native, err => {
                            if (err) adapter.log.error('Cannot create device: ' + id + ' Error: ' + err);
                        });
                    } catch (err) {
                        adapter.log.error('Cannot create device: ' + id + ' Error: ' + err);
                    }
                } else if (task.type === 'update_device') {
                    adapter.log.debug('Update device id=' + id);
                    adapter.extendObject(id, task.data, err => {
                        if (err) adapter.log.error('Cannot update device: ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'delete_device') {
                    adapter.log.debug('Delete device id=' + id);

                    adapter.delObject(id, err => {
                        if (err) adapter.log.error('Cannot delete device : ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'create_state') {
                    adapter.log.debug('Create state id=' + id);

                    try {
                        adapter.createState(task.id.device, null, task.id.state, task.data.common, task.data.native, err => {
                            if (err) adapter.log.error('Cannot create state : ' + id + ' Error: ' + err);
                        });
                    } catch (err) {
                        adapter.log.error('Cannot create state : ' + id+ ' Error: ' + err);
                    }
                } else if (task.type === 'update_state') {
                    adapter.log.debug('Update state id=' + id);

                    adapter.extendObject(id, task.data, err => {
                        if (err) adapter.log.error('Cannot update state : ' + id + ' Error: ' + err);
                    });
                } else if (task.type === 'delete_state') {
                    adapter.log.debug('Delete state id=' + id);

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

const HTTPCodes = {
    values : {
        ok         : 1000,
        invalid    : 1101,
        error      : 1102,
        errorValue : 1103,
        errorJSON  : 1104,
        invalidKey : 1105,
        errorLogin : 1106},
    text : {
        1000 : 'OK',
        1101 : 'Invalid argument value',
        1102 : 'Error',
        1103 : 'Error - value too long',
        1104 : 'Error - malformed JSON on input',
        1105 : 'Invalid argument key',
        1106 : 'Error - Login'}
};

const INVALID_TOKEN = 'Invalid Token';

class Twinkly {

    /**
     * @param {string} name
     * @param {string} host
     */
    constructor(name, host) {
        this.name    = name;
        this.host    = host;
        this.expires = 0;
        this.headers = {};
        this.details = {};
        this.token   = '';
        this.challengeResponse = '';
    }

    /**
     * @return {String}
     */
    base() {
        return `http://${this.host}/xled/v1`;
    }

    /**
     * @return {Number} Anzahl LEDs
     */
    length() {
        return Number(this.details['number_of_led']);
    }

    async interview() {
        if (Object.keys(this.details).length === 0)
            this.details = await this.get_details();
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<{}>}
     */
    async _post(path, data, headers = {}) {
        if (Object.keys(headers).length === 0) headers = this.headers;

        adapter.log.debug(`[${this.name}._post] <${path}>, ${JSON.stringify(data)}, ${JSON.stringify(headers)}`);

        let result, resultError;
        await this.ensure_token(false).catch(error => {resultError = error;});

        if (!resultError) {
            // POST ausführen...
            await this._doPOST(path, data, headers).then(response => {result = response;}).catch(error => {resultError = error;});

            if (resultError && resultError === INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true).catch(error => {resultError = error;});

                // POST erneut ausführen...
                if (!resultError) {
                    await this._doPOST(path, data, headers).then(response => {result = response;}).catch(error => {resultError = error;});

                    // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                    if (resultError && resultError === INVALID_TOKEN)
                        this.token = '';
                }
            }
        }

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else {
                resolve(result);
            }
        });
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<{}>}
     */
    async _doPOST(path, data, headers) {
        return new Promise((resolve, reject) => {
            sendPostHTTP(this.base() + '/' + path, data, headers)
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = translateTwinklyCode(this.name, 'POST', path, response['code']);

                        if (checkTwinklyCode)
                            reject(`${checkTwinklyCode}, Data: ${JSON.stringify(data)}, Headers: ${JSON.stringify(headers)}`);
                        else
                            resolve(response);
                    } catch (e) {
                        reject(`${e.name}: ${e.message}`);
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    /**
     * @param {string} path
     * @return {Promise<{}>}
     */
    async _get(path) {
        adapter.log.debug(`[${this.name}._get] <${path}>`);

        let result, resultError;
        await this.ensure_token(false).catch(error => {resultError = error;});

        if (!resultError) {
            // GET ausführen...
            await this._doGET(path).then(response => {result = response;}).catch(error => {resultError = error;});

            if (resultError && resultError === INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true).catch(error => {resultError = error;});

                // GET erneut ausführen...
                if (!resultError) {
                    await this._doGET(path).then(response => {result = response;}).catch(error => {resultError = error;});

                    // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                    if (resultError && resultError === INVALID_TOKEN)
                        this.token = '';
                }
            }
        }

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(result);
        });
    }

    /**
     * @param {string} path
     * @return {Promise<{}>}
     */
    async _doGET(path) {
        return new Promise((resolve, reject) => {
            sendGetHTTP(this.base() + '/' + path, this.headers)
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = translateTwinklyCode(this.name, 'GET', path, response['code']);

                        if (checkTwinklyCode)
                            reject(`${checkTwinklyCode}, Headers: ${JSON.stringify(this.headers)}`);
                        else
                            resolve(response);
                    } catch (e) {
                        reject(`${e.name}: ${e.message}`);
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    /**
     * Token prüfen ob er bereits abgelaufen ist.
     * @param {boolean} force
     * @return {Promise<String>}
     */
    async ensure_token(force) {
        // const TWINKLY_OBJ = this;

        let resultError;
        if (force || (this.token === '' || this.expires <= Date.now())) {
            adapter.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh`);

            await this.login().catch(error => {resultError = error;});
            if (!resultError)
                await this.verify_login().catch(error => {resultError = error;});

        } else
            adapter.log.debug(`[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`);

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(this.token);
        });
    }

    /**
     * @return {Promise<{authentication_token: String, authentication_token_expires_in: Number, 'challenge-response': String, code: Number}>}
     */
    async login() {
        const TWINKLY_OBJ = this;

        this.token = '';
        return new Promise((resolve, reject) => {
            sendPostHTTP(TWINKLY_OBJ.base() + '/login', {'challenge': 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='})
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = translateTwinklyCode(TWINKLY_OBJ.name, 'POST', 'login', response['code']);

                        if (checkTwinklyCode)
                            reject(checkTwinklyCode);
                        else {
                            TWINKLY_OBJ.token                   = response['authentication_token'];
                            TWINKLY_OBJ.headers['X-Auth-Token'] = TWINKLY_OBJ.token;
                            TWINKLY_OBJ.expires                 = Date.now() + (response['authentication_token_expires_in'] * 1000);
                            TWINKLY_OBJ.challengeResponse       = response['challenge-response'];

                            resolve({
                                authentication_token            : response['authentication_token'],
                                authentication_token_expires_in : response['authentication_token_expires_in'],
                                'challenge-response'            : response['challenge-response'],
                                code                            : response['code']});
                        }
                    } catch (e) {
                        reject(`${e.name}: ${e.message}`);
                    }
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    /**
     * @return {Promise<{code: Number}>}
     */
    async logout() {
        let resultError, response;
        if (this.token !== '')
            response = await this._post('logout', {}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else {
                this.token = '';
                resolve({code: response ? response['code'] : HTTPCodes.values.ok});
            }
        });
    }

    /**
     * @return {Promise<{code: Number}>}
     */
    async verify_login() {
        let result, resultError;
        if (this.challengeResponse === '')
            resultError = 'Challenge-Response nicht gefüllt!';
        else {
            const response = await this._post('verify', {'challenge-response': this.challengeResponse}).catch(error => {resultError = error;});
            result = {code: response['code']};
        }

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(result);
        });
    }

    /**
     * @return {Promise<{name: String, code: Number}>}
     */
    async get_name() {
        let resultError;
        const response = await this._get('device_name').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({name: response['name'], code: response['code']});
        });
    }

    /**
     * @param {String} name Desired device name. At most 32 characters
     * @return {Promise<{name: String, code: Number}>}
     */
    async set_name(name) {
        let resultError;
        const response = await this._post('device_name', {'name': name}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({name: response['name'], code: response['code']});
        });
    }

    /**
     * @return {Promise<{code: Number}>}
     */
    async reset() {
        let resultError;
        const response = await this._get('reset').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @return {Promise<void | {}>}
     */
    async get_network_status() {
        let resultError;
        const response = await this._get('network/status').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(response); //{code: response['code']});
        });
    }

    /**
     *
     */
    async set_network_status() {
        // const response = await this._post('network/status', );
        // return {code: response['code']};
    }

    /**
     * @return {Promise<{timer: {time_now: Number, time_on: Number, time_off: Number}, code: Number}>}
     */
    async get_timer() {
        let resultError;
        const response = await this._get('timer').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({timer: {time_now: response['time_now'], time_on: response['time_on'], time_off: response['time_off']}, code: response['code']});
        });
    }

    /**
     * @param {Number} time_now current time in seconds after midnight
     * @param {Number} time_on  time when to turn lights on in seconds after midnight.  -1 if not set
     * @param {Number} time_off time when to turn lights off in seconds after midnight. -1 if not set
     * @return {Promise<{code: Number}>}
     */
    async set_timer(time_now, time_on, time_off) {
        let resultError;
        const response = await this._post('timer', {'time_now': time_now, 'time_on': time_on, 'time_off': time_off}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @param {string} data
     */
    async set_timer_str(data) {
        try {
            const json = JSON.parse(data);

            let resultError;
            const response = await this.set_timer(json.time_now, json.time_on, json.time_off).catch(error => {resultError = error;});

            return new Promise((resolve, reject) => {
                if (resultError)
                    reject(resultError);
                else
                    resolve({code: response['code']});
            });
        } catch (e) {
            throw Error(e.message);
        }
    }

    /**
     * @return {Promise<{version: String, code: Number}>}
     */
    async get_firmware_version() {
        let resultError;
        const response = await this._get('fw/version').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({version: response['version'], code: response['code']});
        });
    }

    /**
     * @return {Promise<{details: {product_name: String, product_version: String, hardware_version: String, flash_size: Number, led_type: Number,
     *                             led_version: Number, product_code: String, device_name: String, uptime: String, hw_id: String, mac: String,
     *                             max_supported_led: Number, base_leds_number: Number, number_of_led: Number, led_profile: String, frame_rate: Number,
     *                             movie_capacity: Number, copyright: String},
     *                   code: Number}>}
     */
    async get_details() {
        let resultError;
        const response = await this._get('gestalt').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({
                    details: {
                        product_name     : response['product_name'],     product_version : response['product_version'], hardware_version  : response['hardware_version'],
                        flash_size       : response['flash_size'],       led_type        : response['led_type'],        led_version       : response['led_version'],
                        product_code     : response['product_code'],     device_name     : response['device_name'],     uptime            : response['uptime'],
                        hw_id            : response['hw_id'],            mac             : response['mac'],             max_supported_led : response['max_supported_led'],
                        base_leds_number : response['base_leds_number'], number_of_led   : response['number_of_led'],   led_profile       : response['led_profile'],
                        frame_rate       : response['frame_rate'],       movie_capacity  : response['movie_capacity'],  copyright         : response['copyright']},
                    code: response['code']});
        });
    }

    /**
     * @return {Promise<{mode: String, code: Number}>}
     */
    async get_mode() {
        let resultError;
        const response = await this._get('led/mode').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({mode: response['mode'], code: response['code']});
        });
    }

    /**
     * @param {String} mode mode of operation
     * @return {Promise<{code: Number}>}
     */
    async set_mode(mode) {
        let resultError;
        const response = await this._post('led/mode', {'mode': mode}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @return {Promise<{value: Number, enabled: String, code: Number}>}
     */
    async get_brightness() {
        let resultError;
        const response = await this._get('led/out/brightness').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({value: response['value'], enabled: response['enabled'], code: response['code']});
        });
    }

    /**
     * @param {Number} brightness brightness level in range of 0..100
     * @return {Promise<{code: Number}>}
     */
    async set_brightness(brightness) {
        let resultError;
        const response = await this._post('led/out/brightness', {value: brightness, mode: 'enabled', type: 'A'}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @return {Promise<{mqtt: {broker_host : String,
     *                          broker_port : Number,
     *                          client_id   : String,
     *                          user        : String,
     *                          keep_alive_interval: Number,
     *                          encryption_key_set: Boolean}, code: Number}>}
     */
    async get_mqtt() {
        let resultError;
        const response = await this._get('mqtt/config').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({
                    mqtt: {
                        broker_host         : response['broker_host'],
                        broker_port         : response['broker_port'],
                        client_id           : response['client_id'],
                        user                : response['user'],
                        keep_alive_interval : response['keep_alive_interval'],
                        encryption_key_set  : response['encryption_key_set']},
                    code: response['code']});
        });
    }

    /**
     * @param {String} broker_host hostname of broker
     * @param {Number} broker_port destination port of broker
     * @param {String} client_id
     * @param {String} user
     * @param {String} encryption_key length exactly 16 characters?
     * @param {Number} keep_alive_interval
     * @return {Promise<{code: Number}>}
     */
    async set_mqtt(broker_host, broker_port, client_id, user, encryption_key, keep_alive_interval) {
        let resultError;
        const response = await this._post('mqtt/config', {broker_host         : broker_host,
            broker_port         : broker_port,
            client_id           : client_id,
            user                : user,
            encryption_key      : encryption_key,
            keep_alive_interval : keep_alive_interval}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @param {string} data
     */
    async set_mqtt_str(data) {
        try {
            const json = JSON.parse(data);

            let resultError;
            const response = await this.set_mqtt(json.broker_host,
                json.broker_port,
                json.client_id,
                json.user,
                json.encryption_key,
                json.keep_alive_interval).catch(error => {resultError = error;});

            return new Promise((resolve, reject) => {
                if (resultError)
                    reject(resultError);
                else
                    resolve({code: response['code']});
            });
        } catch (e) {
            throw Error(e.message);
        }
    }

    /**
     * @param {{}} movie
     * @return {Promise<{code: Number}>}
     */
    async upload_movie(movie) {
        let resultError;
        const response = await this._post('led/movie/full', movie, {'Content-Type': 'application/octet-stream', 'X-Auth-Token': this.token})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /**
     * @return {Promise<{response: void | {}, code: Number}>}
     */
    async get_movie_config() {
        let resultError;
        const response = await this._get('led/movie/config').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({response, code: response['code']}); // TODO:
        });
    }

    /**
     * @param {Number} frame_delay
     * @param {Number} leds_number seems to be total number of LEDs to use
     * @param {Number} frames_number
     * @return {Promise<{code: Number}>}
     */
    async set_movie_config(frame_delay, leds_number, frames_number) {
        let resultError;
        const response = await this._post('led/movie/config', {frame_delay   : frame_delay,
            leds_number   : leds_number,
            frames_number : frames_number}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    // async send_frame(frame) {
    // await this.interview()
    // if (frame.length != this.length()) {
    //     logs.error('Invalid frame length');
    //     return;
    // }

    // let token = await this.ensure_token();
    // header = bytes([0x01]) + bytes(base64.b64decode(token)) + bytes([this.length()])
    // payload = []
    // for x in frame:
    //     payload.extend(list(x))
    // this.socket.sendto(header + bytes(payload), (this.host, this.rt_port))
    // }

    // async set_static_colour(colour) {
    //     frame = [colour for _ in range(0, self.length)]
    //     movie = bytes([item for t in frame for item in t])
    //     await this.upload_movie(movie)
    //     await this.set_movie_config(
    //         {
    //             'frames_number': 1,
    //             'loop_type': 0,
    //             'frame_delay': 56,
    //             'leds_number': self.length,
    //         }
    //     )
    //     await self.set_mode(MODES.on)
    // }
}

/**
 * @param {string} name
 * @param {string} mode
 * @param {string} path
 * @param {number} code
 */
function translateTwinklyCode(name, mode, path, code) {
    if (code && code !== HTTPCodes.values.ok)
        return `[${name}.${mode}.${path}] ${code} (${HTTPCodes.text[code]})`;
}

// /**
//  * Checks if String is a JSON-Object
//  * @param {string} str
//  */
// function isJsonString(str) {
//     try {
//         const json = JSON.parse(str);
//         return (typeof json === 'object');
//     } catch (e) {
//         return false;
//     }
// }

/**
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
function sendGetHTTP(url, headers = {}) {
    return new Promise((resolve, reject) => {
        sendHTTP(url, null, 'GET', headers)
            .then(response => {
                if (response) adapter.log.debug('[sendGetHTTP] ' + JSON.stringify(response));
                resolve(response);
            })
            .catch(error => {
                reject(error);
            });
    });
}

/**
 * @param {string} url
 * @param {string | {}} body
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
function sendPostHTTP(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        sendHTTP(url, body, 'POST', headers)
            .then(response => {
                if (response) adapter.log.debug('[sendPostHTTP] ' + JSON.stringify(response));
                resolve(response);
            })
            .catch(error => {
                reject(error);
            });
    });
}

/**
 * @param {string} url
 * @param {any} body
 * @param {string} method
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
function sendHTTP(url, body, method, headers = {}) {
    return new Promise((resolve, reject) => {
        // Header zusammenbasteln
        if (!Object.keys(headers).includes('Content-Type'))
            headers['Content-Type'] = 'application/json';

        try {
            axios.request({
                method  : (method === 'POST' ? 'POST' : 'GET'),
                url     : url,
                data    : body,
                headers : headers
            })
                .then(response => {
                    // const json = CircularJSON.stringify(response);

                    if (response.status !== 200)
                        reject('HTTP Error ' + response.statusText);
                    else
                        resolve(response.data);
                })
                .catch(error => {
                    if (error.response && error.response.status === 401 && error.response.data && error.response.data.includes(INVALID_TOKEN))
                        reject(INVALID_TOKEN);
                    else if (error.response && error.response.status !== 200)
                        reject('HTTP Error ' + error.response.statusText);
                    else
                        reject(error);
                });
        } catch (e) {
            reject(e.message);
        }
    });
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}