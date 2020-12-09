'use strict';

/*
 * Created with @iobroker/create-adapter v1.26.3
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

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
 * @type {{name: String, ipAdresse: String, twinkly: Twinkly, connectedState: String, checkConnected: Boolean, connected: Boolean}}
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
    on            : '.on',
    mode          : '.mode',
    bri           : '.bri',
    name          : '.name',
    mqtt          : '.mqtt',
    timer         : '.timer',
    reset         : '.reset',
    // movieConfig   : '.movieConfig',
    // networkStatus : '.networkStatus',
    details       : '.details',
    firmware      : '.firmware'
};

/**
 * Anzulegende States
 * @type {[]}
 */
const statesConfig = [
    stateNames.on,
    stateNames.mode,
    stateNames.bri,
    stateNames.name,
    stateNames.reset
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
                // The state was changed
                adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

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
                    adapter.log.debug(`${subscribedStates[id].device} ist nicht verfügbar!`);
                    return;
                }

                // Doppelte Ereignisse verhindern...
                // let action = 'set:' + command + ':' + obj.state.val;
                // if (devices[device].lastAction == action) return;
                // devices[device].lastAction = action;


                // Gerät ein-/ausschalten
                if (command === stateNames.on) {
                    connections[connection].twinkly.set_mode(state.val ? LIGHT_MODES.value.on : LIGHT_MODES.value.off)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Mode anpassen
                } else if (command === stateNames.mode) {
                    connections[connection].twinkly.set_mode(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Helligkeit anpassen
                } else if (command === stateNames.bri) {
                    connections[connection].twinkly.set_brightness(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Namen anpassen
                } else if (command === stateNames.name) {
                    connections[connection].twinkly.set_name(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // MQTT anpassen
                } else if (command === stateNames.mqtt) {
                    connections[connection].twinkly.set_mqtt_str(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Timer anpassen
                } else if (command === stateNames.timer) {
                    connections[connection].twinkly.set_mqtt_str(state.val)
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});

                // Reset
                } else if (command === stateNames.reset) {
                    await adapter.setForeignStateChangedAsync(id, false, true);
                    connections[connection].twinkly.reset()
                        .catch(error => {adapter.log.error(`[${connection}${command}] ${error}`);});
                }
            } else {
                // The state was deleted
                adapter.log.info(`state ${id} deleted`);
            }
        },

        // If you need to accept messages in your adapter, uncomment the following block.
        // /**
        //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
        //  * Using this method requires "common.message" property to be set to true in io-package.json
        //  */
        // message: (obj) => {
        //     if (typeof obj === 'object' && obj.message) {
        //         if (obj.command === 'send') {
        //             // e.g. send email or pushover or whatever
        //             adapter.log.info('send command');

        //             // Send response in callback if required
        //             if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        //         }
        //     }
        // },
    }));
}

async function poll() {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
        pollingInterval = null;
    }

    for (const connection of Object.keys(connections)) {
        if (connections[connection].ipAdresse === '') continue;

        // Connected abfragen
        if (connections[connection].checkConnected) {
            connections[connection].connected = await adapter.getForeignStateAsync(connections[connection].connectedState).val;
            await adapter.setForeignStateChangedAsync(connection + '.connected', connections[connection].connected, true);

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
            if (command === stateNames.mode) {
                await connections[connection].twinkly.get_mode()
                    .then(async ({mode}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, mode !== LIGHT_MODES.value.off, true);
                        await adapter.setForeignStateChangedAsync(connection + command, mode, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.bri) {
                await connections[connection].twinkly.get_brightness()
                    .then(async ({value}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, value, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.name) {
                await connections[connection].twinkly.get_name()
                    .then(async ({name}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, name, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.mqtt) {
                await connections[connection].twinkly.get_mqtt()
                    .then(async ({mqtt}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, JSON.stringify(mqtt), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.timer) {
                await connections[connection].twinkly.get_timer()
                    .then(async ({timer}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, JSON.stringify(timer), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.details) {
                await connections[connection].twinkly.get_details()
                    .then(async ({details}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, JSON.stringify(details), true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });

            } else if (command === stateNames.firmware){
                await connections[connection].twinkly.get_firmware_version()
                    .then(async ({version}) => {
                        await adapter.setForeignStateChangedAsync(connection + command, version, true);
                    })
                    .catch(error => {
                        adapter.log.error(`[${connection}${command}] ${error}`);
                    });
            }
        }
    }

    // Fetch abgeschlossen und Flag zurücksetzen
    // connections[connection].fetchActive = false;

    pollingInterval = setTimeout(async () => {await poll();}, adapter.config.polling * 1000);
}

async function main() {
    adapter.subscribeStates('*');

    adapter.config.polling = parseInt(adapter.config.polling, 10) < 15 ? 15 : parseInt(adapter.config.polling, 10);

    // Details und Firmware hinzufügen, wenn gewünscht
    if (adapter.config.showDeviceInfo) {
        statesConfig.push(stateNames.details);
        statesConfig.push(stateNames.firmware);
    }

    // MQTT hinzufügen, wenn gewünscht
    if (adapter.config.mqtt)
        statesConfig.push(stateNames.mqtt);

    // Timer hinzufügen, wenn gewünscht
    if (adapter.config.timer)
        statesConfig.push(stateNames.timer);


    adapter.log.info('config devices: '        + adapter.config.devices);
    adapter.log.info('config polling: '        + adapter.config.polling);
    adapter.log.info('config showDeviceInfo: ' + adapter.config.showDeviceInfo);


    let result = true;
    try {
        const devices = JSON.parse(adapter.config.devices);
        // active         : true,
        // name           : 'Twinkly Lichterkette 2',       // Name für ioBroker
        // host           : '192.168.178.53',               // IP-Adresse von der Twinkly-Lichterkette
        // connectedState : 'ping.0.Twinkly_Lichterkette_2' // State mit true/false der den aktuellen Status der Lichterkette überwacht (bspw. ping, tr-064)

        for (const device of devices) {
            if (!device.active) {
                adapter.log.info(`${device.name} deaktiviert...`);
                continue;
            }

            // connections.push



        }

        // Prüfung ob aktive Verbindungen verfügbar sind
        if (result && Object.keys(connections).length === 0) {
            result = false;
            adapter.log.warn('Keine aktiven Verbindungen hinterlegt...');
        }
    } catch (e) {
        result = false;
    }

    // TODO: Objecte/ States anlegen...
    // await adapter.setObjectNotExistsAsync('testVariable', {
    //     type: 'state',
    //     common: {
    //         name: 'testVariable',
    //         type: 'boolean',
    //         role: 'indicator',
    //         read: true,
    //         write: true,
    //     },
    //     native: {}
    // });


    // TODO: Test


    // Polling starten...
    if (result)
        await poll();
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}