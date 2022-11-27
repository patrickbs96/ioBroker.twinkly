const twinkly = require('./twinkly');

/**
 * Mapping zwischen API und Objekten
 * @type {{[x: string]: {id: string, name: string} |
 *                      {parent: {id: string, name: string, hide?: boolean, deprecated?: String, newSince?: String},
 *                       child: {[x: string]: {id: string, name: string, hide?: boolean, deprecated?: String, newSince?: String} |
 *                                             {parent: {id: string, name: string, hide?: boolean, deprecated?: String, newSince?: String},
 *                                              child: {[x: string]: {id: string, name: string}}, expandJSON: boolean}},
 *                       expandJSON: boolean}}}
 */
const apiObjectsMap = {
    details : {
        parent : {id: 'details', name: 'Details', role: 'json'},
        child  : {
            base_leds_number    : {id: 'baseLedsNumber',    name: 'Base LEDs Number',    type: 'number',                     deprecated: '2.6.6'},
            bytes_per_led       : {id: 'bytesPerLed',       name: 'Bytes per LED',       type: 'number',                     newSince: '2.4.0'},
            copyright           : {id: 'copyright',         name: 'Copyright'},
            device_name         : {id: 'deviceName',        name: 'Device Name'},
            flash_size          : {id: 'flashSize',         name: 'Flash Size',          type: 'number',                     deprecated: '2.8.15'},
            frame_rate          : {id: 'frameRate',         name: 'Frame Rate',          type: 'number'},
            fw_family           : {id: 'fwFamily',          name: 'Firmware Family',                                         newSince: '2.4.0'},
            hardware_version    : {id: 'hardwareVersion',   name: 'Hardware Version'},
            hw_id               : {id: 'hwId',              name: 'Hardware ID'},
            led_profile         : {id: 'ledProfile',        name: 'LED Profile'},
            led_type            : {id: 'ledType',           name: 'LED Type',            type: 'number'},
            led_version         : {id: 'ledVersion',        name: 'LED Version',         type: 'number',                     deprecated: '2.6.6'},
            mac                 : {id: 'mac',               name: 'MAC'},
            max_movies          : {id: 'maxMovies',         name: 'Max Movies',          type: 'number',                     newSince: '2.8.9'},
            max_supported_led   : {id: 'maxSupportedLed',   name: 'Max Supported LED',   type: 'number'},
            measured_frame_rate : {id: 'measuredFrameRate', name: 'Measured Frame Rate', type: 'number',                     newSince: '2.4.0'},
            movie_capacity      : {id: 'movieCapacity',     name: 'Movie Capacity',      type: 'number'},
            number_of_led       : {id: 'numberOfLed',       name: 'Number of LED',       type: 'number'},
            production_site     : {id: 'productionSite',    name: 'Production Site',     type: 'number',                     newSince: '2.8.3'},
            production_date     : {id: 'productionDate',    name: 'Production Date',     type: 'number', role: 'value.time', newSince: '2.8.3'},
            product_name        : {id: 'productName',       name: 'Product Name'},
            product_version     : {id: 'productVersion',    name: 'Product Version',                                         deprecated: '2.6.6'},
            product_code        : {id: 'productCode',       name: 'Product Code'},
            rssi                : {id: 'rssi',              name: 'RSSI',                type: 'number',                     deprecated: '2.6.6'},
            serial              : {id: 'serial',            name: 'Serial',                                                  newSince: '2.8.3'},
            uid                 : {id: 'uid',               name: 'UID',                                                     deprecated: '2.6.6', ignore: {deprecated: true}, hint: 'Unknown availablilty. Sometimes available.'},
            uptime              : {id: 'uptime',            name: 'Uptime'},
            uuid                : {id: 'uuid',              name: 'UUID'},
            wire_type           : {id: 'wireType',          name: 'Wire Type',           type: 'number',                     newSince: '2.7.3', deprecated: '2.8.3'},

            group : {
                parent : {id: 'group', name: 'Group', newSince: '2.8.3'},
                child  : {
                    mode        : {id: 'mode',       name: 'Name',        states: {'none': 'None', 'master': 'Master', 'slave': 'Slave'}},
                    compat_mode : {id: 'compatMode', name: 'Compat Mode', type: 'number', hide: true},
                    offset      : {id: 'offset',     name: 'Offset',      type: 'number',             filter: {detail: {name: 'group.mode', val: 'slave', type: 'eq'}}, ignore: {create: true}},
                    size        : {id: 'size',       name: 'Size',        type: 'number',             filter: {detail: {name: 'group.mode', val: 'none',  type: 'ne'}}, ignore: {create: true}},
                    uid         : {id: 'uid',        name: 'UID',                         hide: true, filter: {detail: {name: 'group.mode', val: 'none',  type: 'ne'}}}
                },
                expandJSON: true
            },

            pwr: {
                parent : {id: 'power', name: 'Power', newSince: '2.8.15', filter: {family: 'T'}},
                child  : {
                    mA : {id: 'mA', name: 'Ampere',  type: 'number'},
                    mV : {id: 'mV', name: 'Voltage', type: 'number'}
                },
                expandJSON: true
            }
        },
        expandJSON: true
    },
    firmware : {
        parent : {id: 'firmware',  name: 'Firmware', hide: true},
        child  : {
            version : {id: 'firmware',  name: 'Firmware'}
        },
        expandJSON: true
    },

    ledBri : {
        parent : {id: 'ledBri', name: 'LED Brightness', hide: true},
        child  : {
            value : {id: 'ledBri',     name: 'LED Brightness',      write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},
            mode  : {id: 'ledBriMode', name: 'LED Brightness Mode', hide : true}
        },
        expandJSON: true
    },
    ledColor : {
        parent : {id: 'ledColor', name: 'LED Color', role: 'json'},
        child  : {
            hue        : {id: 'hue',   name: 'Hue',   type: 'number', role: 'level.color.hue',        write: true, min: 0, max: 359, unit: '°'},
            saturation : {id: 'sat',   name: 'Sat',   type: 'number', role: 'level.color.saturation', write: true, min: 0, max: 255},
            value      : {id: 'value', name: 'Value', type: 'number', role: 'level.color.value',      write: true, min: 0, max: 255},
            red        : {id: 'r',     name: 'Red',   type: 'number', role: 'level.color.red',        write: true, min: 0, max: 255},
            green      : {id: 'g',     name: 'Green', type: 'number', role: 'level.color.green',      write: true, min: 0, max: 255},
            blue       : {id: 'b',     name: 'Blue',  type: 'number', role: 'level.color.blue',       write: true, min: 0, max: 255},
            white      : {id: 'w',     name: 'White', type: 'number', role: 'level.color.white',      write: true, min: 0, max: 255, filter: {detail: {name: 'led_profile', val: 'RGBW'}}},
            hex        : {id: 'hex',   name: 'Hex',   type: 'string', role: 'level.color.hex',        write: true,                   ignore: {deprecated: true, newSince: true}, hint: 'Feature from adapter.'}
        },

        expandJSON : true
    },
    ledConfig : {id: 'ledConfig', name: 'LED Config', write: true, role: 'json'},
    ledEffect : {
        parent : {id: 'ledEffect', name: 'LED Effect', hide: true},
        child  : {
            preset_id : {id: 'ledEffect',    name: 'LED Effect',           write: true, type: 'number', newSince: '2.4.0', checkStates: false}, // deprecated fw=2.6.6, fwFamily=G
            effect_id : {id: 'ledEffectEId', name: 'LED Effect Effect Id', hide : true, type: 'number', deprecated: '2.6.6'},
            unique_id : {id: 'ledEffectUId', name: 'LED Effect Unique Id', hide : true,                 newSince: '2.4.0'}
        },
        expandJSON: true
    },
    ledLayout : {
        parent : {id: 'ledLayout', name: 'LED Layout', write: true, role: 'json'},
        child  : {
            aspectXY    : {id: 'aspectXY',    name: 'Aspect XY',   write: true, type: 'number', deprecated: '2.8.3'},
            aspectXZ    : {id: 'aspectXZ',    name: 'Aspect XZ',   write: true, type: 'number', deprecated: '2.8.3'},
            coordinates : {id: 'coordinates', name: 'Coordinates', write: true, type: 'string',  role: 'json'},
            source      : {id: 'source',      name: 'Source',      write: true,                                 states: {linear: 'linear', '2d': '2D', '3d': '3D'}},
            synthesized : {id: 'synthesized', name: 'Synthesized', write: true, type: 'boolean', role: 'switch'},
            uuid        : {id: 'uuid',        name: 'UUID',        hide : true},
        },
        expandJSON: true
    },
    ledMode : {
        parent : {id: 'mode', name: 'LED Mode', role: 'json', hide: true},
        child  : {
            mode : {id: 'ledMode', name: 'LED Mode', write: true, role: 'state', def: twinkly.lightModes.value.off, states: twinkly.lightModes.text},

            // Active Movie in Mode "movie"
            id          : {id: 'id',         name: 'Id',        type: 'number', hide: true,                    deprecated: '2.3.5'},
            name        : {id: 'name',       name: 'Name',                      hide: true, newSince: '2.4.0', deprecated: '2.6.6'},
            unique_id   : {id: 'uniqueId',   name: 'Unique Id',                 hide: true, newSince: '2.4.0', deprecated: '2.6.6'},
            shop_mode   : {id: 'shopMode',   name: 'Shop',      type: 'number', hide: true, newSince: '2.4.0'},
            detect_mode : {id: 'detectMode', name: 'Detect',    type: 'number', hide: true, newSince: '2.8.11'},

            // Active Movie in Mode "playlist"
            movie : {
                parent : {id: 'movie', name: 'Movie', hide: true, newSince: '2.4.0', filter: {mode: 'playlist'}},
                child  : {
                    name      : {id: 'activePlaylistMovie',         name: 'Active Playlist Movie',                           hide: true},
                    id        : {id: 'activePlaylistMovieId',       name: 'Active Playlist Movie Id',        type: 'number', hide: true},
                    duration  : {id: 'activePlaylistMovieDuration', name: 'Active Playlist Movie Duration',  type: 'number', hide: true},
                    unique_id : {id: 'activePlaylistMovieUniqueId', name: 'Active Playlist Movie Unique Id',                 hide: true},
                },
                expandJSON: true
            },

            // Color configuration
            color_config : {
                parent : {id: 'colorConfig', name: 'Color Config', hide: true, newSince: '2.4.0', filter: {mode: 'color'}},
                child  : {
                    hue        : {id: 'hue', name: 'Hue',   type: 'number', hide: true},
                    saturation : {id: 'sat', name: 'Sat',   type: 'number', hide: true},
                    value      : {id: 'val', name: 'Value', type: 'number', hide: true},
                    red        : {id: 'r',   name: 'Red',   type: 'number', hide: true},
                    green      : {id: 'g',   name: 'Green', type: 'number', hide: true},
                    blue       : {id: 'b',   name: 'Blue',  type: 'number', hide: true},
                    white      : {id: 'w',   name: 'White', type: 'number', hide: true, filter: {detail: {name: 'led_profile', val: 'RGBW'}}}
                },
                expandJSON: false
            },

            musicreactive_config : {
                parent : {id: 'musicReactiveConfig', name: 'Music Reactive Config', hide: true, newSince: '2.4.0', filter: {mode: 'musicreactive'}},
                child  : {
                    handle    : {id: 'handle',   name: 'handle', type: 'number', hide: true},
                    unique_id : {id: 'uniqueId', name: 'Unique Id',              hide: true}
                },
                expandJSON : false
            }
        },
        expandJSON: true
    },

    ledMovie : {
        parent : {id: 'ledMovie', name: 'LED Movie', hide: true},
        child  : {
            id        : {id: 'ledMovie', name: 'LED Movie', write: true, type: 'number', checkStates: false},
            unique_id : {id: 'ledMovie', name: 'LED Movie', hide: true},
            name      : {id: 'ledMovie', name: 'LED Movie', hide: true}
        },
        expandJSON: true
    },
    ledMovies   : {id: 'ledMovies', name: 'LED Movies', role: 'json'},
    ledPlaylist : {
        parent : {id: 'ledPlaylist', name: 'LED Playlist', hide: true},
        child  : {
            id        : {id: 'ledPlaylist',         name: 'LED Playlist',          write: true, type: 'number', checkStates: false},
            unique_id : {id: 'ledPlaylistUId',      name: 'LED Playlist UId',      hide : true, type: 'number'},
            name      : {id: 'ledPlaylistName',     name: 'LED Playlist Name',     hide : true},
            duration  : {id: 'ledPlaylistDuration', name: 'LED Playlist Duration', hide : true, type: 'number'}
        },
        expandJSON: true
    },
    ledSat : {
        parent : {id: 'ledSat', name: 'LED Saturation', hide: true},
        child  : {
            value : {id: 'ledSat',     name: 'LED Saturation',      write: true, type: 'number', role: 'level.dimmer', min: -1, max: 100},
            mode  : {id: 'ledSatMode', name: 'LED Saturation Mode', hide : true}
        },
        expandJSON: true
    },

    mqtt : {
        parent : {id: 'mqtt', name: 'MQTT', write: true, role: 'json'},
        child  : {
            broker_host         : {id: 'brokerHost',        name: 'Broker Host',         write: true},
            broker_port         : {id: 'brokerPort',        name: 'Broker Port',         write: true, type: 'number'},
            client_id           : {id: 'clientId',          name: 'Client ID',           write: true},
            enabled             : {id: 'enabled',           name: 'Enabled',             write: true, type: 'boolean', newSince: '2.8.15', filter: {family: 'T'}},
            keep_alive_interval : {id: 'keepAliveInterval', name: 'Keep Alive Interval', write: true, type: 'number', def: 60},
            user                : {id: 'user',              name: 'User',                write: true},
            encryption_key_set  : {id: 'encryptionKeySet',  name: 'Encryption-Key set',               type: 'boolean', deprecated: '2.6.6'}
        },
        expandJSON: true
    },
    name : {
        parent : {id: 'name', name: 'Name', hide : true},
        child  : {
            name : {id: 'name', name: 'Name', write: true, role: 'info.name'}
        },
        expandJSON: true
    },
    networkStatus : {
        parent : {id: 'network', name: 'Network', role: 'json'},
        child  : {
            mode    : {id: 'mode', name: 'Mode', type: 'number', states: {1: 'Station', 2: 'AccessPoint'}},
            station : {
                parent : {id: 'station', name: 'Station', role: 'json'},
                child  : {
                    connected_bssid : {id: 'connectedBssid', name: 'Connected BSSID',                  newSince: '2.8.9'},
                    ip              : {id: 'ip',             name: 'IP'},
                    gw              : {id: 'gateway',        name: 'Gateway'},
                    mask            : {id: 'subnetmask',     name: 'Subnetmask'},
                    monitor_enabled : {id: 'monitorEnabled', name: 'Monitor Enabled', type: 'boolean', newSince: '2.8.9'},
                    rssi            : {id: 'rssi',           name: 'RSSI',            type: 'number',  newSince: '2.4.0'},
                    ssid            : {id: 'ssid',           name: 'SSID'},
                    status          : {id: 'status',         name: 'Status',                           deprecated: '2.6.6'},
                },
                expandJSON: true
            },
            ap : {
                parent : {id: 'accesspoint', name: 'AccessPoint', role: 'json'},
                child  : {
                    enc              : {id: 'encrypted',       name: 'Encrypted',        type: 'number', states: {0: 'No encryption', 2: 'WPA1', 3: 'WPA2', 4: 'WPA1+WPA2'}},
                    ip               : {id: 'ip',              name: 'IP'},
                    channel          : {id: 'channel',         name: 'Channel',          type: 'number'},
                    max_connections  : {id: 'maxConnections',  name: 'Max Connections',  type: 'number',  newSince: '2.4.0'},
                    password_changed : {id: 'passwordChanged', name: 'Password Changed', type: 'boolean', newSince: '2.4.0', deprecated: '2.6.6'},
                    ssid             : {id: 'ssid',            name: 'SSID'},
                    ssid_hidden      : {id: 'ssidHidden',      name: 'SSID Hidden',      type: 'boolean', newSince: '2.4.0'}
                },
                expandJSON: true
            }
        },
        expandJSON: true
    },
    on     : {id: 'on',       name: 'On',               write: true, type: 'boolean', role: 'switch'},
    paused : {id: 'paused',   name: 'Pause Connection', write: true, type: 'boolean', role: 'switch'},
    reset  : {id: 'reset',    name: 'Reset',            write: true, type: 'boolean', role: 'button'},
    status : {id: 'status',   name: 'Status', role: 'json'},
    timer  : {
        parent : {id: 'timer', name: 'Timer', write: true, role: 'json'},
        child  : {
            time_now : {id: 'timeNow',  name: 'Now',      write: true, type: 'number'},
            time_on  : {id: 'timeOn',   name: 'On',       write: true, type: 'number'},
            time_off : {id: 'timeOff',  name: 'Off',      write: true, type: 'number'},
            tz       : {id: 'timeZone', name: 'Timezone', write: true,                  newSince: '2.7.9'}
        },
        expandJSON: true
    },

    connected : {id: 'connected', name: 'Connected', type: 'boolean', role: 'indicator.connected', def: true}
};

module.exports = {
    apiObjectsMap
};