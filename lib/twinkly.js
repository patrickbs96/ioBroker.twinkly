const request = require('./request');
const ping    = require('./ping');

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
        1106 : 'Error - Login'},

    INVALID_TOKEN : 'Invalid Token'
};

const lightModes = {
    value: {
        on       : 'movie',
        color    : 'color',
        effect   : 'effect',
        playlist : 'playlist',
        off      : 'off',
        rt       : 'rt',
        demo     : 'demo'
    },

    text : {
        movie    : 'On',
        color    : 'Color',
        effect   : 'Effect',
        playlist : 'Playlist',
        off      : 'Off',
        rt       : 'Real Time',
        demo     : 'Demo'
    }
};

class Twinkly {

    /**
     * @param {ioBroker.Adapter} adapter
     * @param {string} name
     * @param {string} host
     * @param {function(functionName: String, key: String, message: String)} handleSentryMessages
     */
    constructor(adapter, name, host, handleSentryMessages) {
        this.adapter = adapter;
        this.name    = name;
        this.host    = host;
        this.handleSentryMessages = handleSentryMessages;
        this.expires = 0;
        this.headers = {};
        this.details = {};
        this.token   = '';
        this.challengeResponse = '';
        this.connected = false;
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
    async length() {
        await this.interview();

        if (Object.keys(this.details).includes('number_of_led'))
            return Number(this.details['number_of_led']);
        return -1;
    }

    async interview() {
        if (Object.keys(this.details).length === 0) {
            try {
                this.details = await this.getDeviceDetails();
            } catch (e) {
                this.adapter.log.error(`[${this.name}.interview] ${e}`);
            }
        }
    }

    /**
     * Token prüfen ob er bereits abgelaufen ist.
     * @param {boolean} force
     * @return {Promise<String>}
     */
    async ensure_token(force) {
        if (force || this.token === '' || this.expires <= Date.now()) {
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh`);

            try {
                await this.login();
                await this.verify();
            } catch (e) {
                throw Error(e.message);
            }
        } else
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`);

        return this.token;
    }

    /** Login
     * @return {Promise<{authentication_token: String, authentication_token_expires_in: Number, 'challenge-response': String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#login">REST-API</a>
     */
    async login() {
        const TWINKLY_OBJ = this;

        this.token = '';

        let response;
        try {
            response = await this.sendPostHTTP(TWINKLY_OBJ.base() + '/login', {challenge: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='});
        } catch (e) {
            throw Error(e.message);
        }

        let checkTwinklyCode;
        try {
            if (response && typeof response === 'object')
                checkTwinklyCode = this.translateTwinklyCode(TWINKLY_OBJ.name, 'POST', 'login', response['code']);
        } catch (e) {
            throw Error(`${e.name}: ${e.message}`);
        }

        if (checkTwinklyCode)
            throw Error(checkTwinklyCode);

        TWINKLY_OBJ.token                   = String(response['authentication_token']);
        TWINKLY_OBJ.headers['X-Auth-Token'] = TWINKLY_OBJ.token;
        TWINKLY_OBJ.expires                 = Date.now() + (Number(response['authentication_token_expires_in']) * 1000);
        TWINKLY_OBJ.challengeResponse       = String(response['challenge-response']);

        return {
            'authentication_token'            : String(response['authentication_token']),
            'authentication_token_expires_in' : Number(response['authentication_token_expires_in']),
            'challenge-response'              : String(response['challenge-response']),
            'code'                            : Number(response['code'])
        };
    }

    /** Verify
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#verify">REST-API</a>
     */
    async verify() {
        if (this.challengeResponse === '')
            throw Error('Challenge-Response nicht gefüllt!');

        try {
            const response = await this._post('verify', {'challenge-response': this.challengeResponse});
            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Logout
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#logout">REST-API</a>
     */
    async logout() {
        try {
            let response;
            if (this.token !== '') {
                response = await this._post('logout', {});
                this.token = '';
            }

            return {code: response ? response['code'] : HTTPCodes.values.ok};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Device details
     * @return {Promise<{details: {product_name: String, product_version: String, hardware_version: String, flash_size: Number, led_type: Number,
     *                             product_code: String, device_name: String, uptime: String, hw_id: String, mac: String,
     *                             max_supported_led: Number, number_of_led: Number, led_profile: String, frame_rate: Number,
     *                             movie_capacity: Number, copyright: String, wire_type: Number, measured_frame_rate: Number, uuid: String,
     *                             fw_family: String, bytes_per_led: Number, base_leds_number: Number, rssi: Number, led_version: String},
     *                   code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#device-details">REST-API</a>
     */
    async getDeviceDetails() {
        try {
            const response = await this._get('gestalt');

            /**
             * @type {{product_name: String, product_version: String, hardware_version: String, flash_size: Number, led_type: Number,
             *         product_code: String, device_name: String, uptime: String, hw_id: String, mac: String,
             *         max_supported_led: Number, number_of_led: Number, led_profile: String, frame_rate: Number,
             *         movie_capacity: Number, copyright: String, wire_type: Number, measured_frame_rate: Number, uuid: String,
             *         fw_family: String, bytes_per_led: Number, base_leds_number: Number, rssi: Number, led_version: String}}
             */
            const details = {};
            this.getObjectByArrayNew('gestalt', details, response, [
                'product_name', 'product_version', 'hardware_version', 'flash_size', 'led_type',
                'product_code', 'device_name', 'uptime', 'hw_id', 'mac',
                'number_of_led', 'led_profile', 'frame_rate', 'movie_capacity', 'copyright',
                'max_supported_led', 'wire_type', 'measured_frame_rate', 'uuid', 'fw_family',
                'bytes_per_led', 'base_leds_number', 'rssi', 'led_version']);

            return {details: details, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get Device name
     * @return {Promise<{name: {name: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-device-name">REST-API</a>
     */
    async getDeviceName() {
        try {
            const response = await this._get('device_name');

            /**
             * @type {{name: String}}
             */
            const name = {};
            this.getObjectByArrayNew('device_name', name, response, ['name']);

            return {name: name, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set Device name
     * @param {String} name Desired device name. At most 32 characters
     * @return {Promise<{name: String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-device-name">REST-API</a>
     */
    async setDeviceName(name) {
        try {
            const response = await this._post('device_name', {name: name});

            return {name: response['name'], code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Echo
     * @param {String} message
     * @return {Promise<{message: String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#echo">REST-API</a>
     */
    async echo(message) {
        try {
            const response = await this._post('echo', {message: message});

            return {message: response['json']['message'], code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get timer
     * @return {Promise<{timer: {time_now: Number, time_on: Number, time_off: Number, tz: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-timer">REST-API</a>
     */
    async getTimer() {
        try {
            const response = await this._get('timer');

            /**
             * @type {{time_now: Number, time_on: Number, time_off: Number, tz: String}}
             */
            const timer = {};
            this.getObjectByArrayNew('timer', timer, response, ['time_now', 'time_on', 'time_off', 'tz']);

            return {timer: timer, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set timer
     * @param {{time_now: Number, time_on: Number, time_off: Number, tz: String} | String} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-timer">REST-API</a>
     */
    async setTimer(data) {
        try {
            data = typeof data === 'string' ? JSON.parse(data) : data;

            const response = await this._post('timer', data);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get Layout
     * @return {Promise<{layout: {aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean, uuid: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-layout">REST-API</a>
     */
    async getLayout() {
        try {
            const response = await this._get('led/layout/full');

            /**
             * @type {{aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean, uuid: String}}
             */
            const layout = {};
            this.getObjectByArrayNew('led/layout/full', layout, response,
                ['aspectXY', 'aspectXZ', 'coordinates', 'source', 'synthesized', 'uuid']);

            return {layout: layout, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Upload Layout
     * @param {Number} aspectXY
     * @param {Number} aspectXZ
     * @param {{x: Number, y: Number, z: Number}[]} coordinates
     * @param {String} source “linear”, “2d”, “3d”
     * @param {Boolean} synthesized
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-layout">REST-API</a>
     */
    async uploadLayout(aspectXY, aspectXZ, coordinates, source, synthesized) {
        try {
            const response = await this._post('led/layout/full',
                {aspectXY: aspectXY, aspectXZ: aspectXZ, coordinates: coordinates, source: source, synthesized: synthesized});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get LED operation mode
     * @return {Promise<{mode: {mode: String, shop_mode: Number, id: Number, unique_id: String, name: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-operation-mode">REST-API</a>
     */
    async getLEDMode() {
        try {
            const response = await this._get('led/mode');

            /**
             * @type {{mode: String, shop_mode: Number, id: Number, unique_id: String, name: String}}
             */
            const mode = {};
            this.getObjectByArrayNew('led/mode', mode, response,
                ['id', 'color_config', 'mode', 'movie', 'musicreactive_config', 'name', 'shop_mode', 'unique_id']);

            return {mode: mode, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set LED operation mode
     * @param {String} mode mode of operation
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-operation-mode">REST-API</a>
     */
    async setLEDMode(mode) {
        try {
            const response = await this._post('led/mode', {mode: mode});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get LED color
     * @return {Promise<{color: {hue: Number, saturation: Number, value: Number, red: Number, green: Number, blue: Number, white: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-color">REST-API</a>
     */
    async getLEDColor() {
        try {
            const response = await this._get('led/color');

            /**
             * @type {{hue: Number, saturation: Number, value: Number, red: Number, green: Number, blue: Number, white: Number}}
             */
            const color = {};
            this.getObjectByArrayNew('led/color', color, response,
                ['hue', 'saturation', 'value', 'red', 'green', 'blue', 'white']);

            return {color: color, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set LED color
     * @param {Number} hue Hue
     * @param {Number} sat Saturation
     * @param {Number} value Value
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorHSV(hue, sat, value) {
        try {
            const response = await this.setLEDColor({hue: hue, saturation: sat, value: value});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set LED color
     * @param {Number} red Red
     * @param {Number} green Green
     * @param {Number} blue Blue
     * @param {Number} [white] White
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorRGBW(red, green, blue, white) {
        try {
            const data = {red: red, green: green, blue: blue};
            if (white >= 0 && await this.checkDetailInfo({name: 'led_profile', val: 'RGBW'}))
                data['white'] = white;

            const response = await this.setLEDColor(data);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set LED color
     * @param {{}} color colorConfig
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColor(color) {
        try {
            const response = await this._post('led/color', color);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get LED effects
     * @return {Promise<{effects: {effects_number: Number, unique_ids: String[]}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-effects">REST-API</a>
     */
    async getLEDEffects() {
        try {
            const response = await this._get('led/effects');

            /**
             * @type {{effects_number: Number, unique_ids: String[]}}
             */
            const effects = {};
            this.getObjectByArrayNew('led/effects', effects, response, ['effects_number', 'unique_ids']);

            return {effects: effects, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get current LED effect
     @return {Promise<{effect: {effect_id: Number, preset_id: Number, unique_id: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-led-effect">REST-API</a>
     */
    async getCurrentLEDEffect() {
        try {
            const response = await this._get('led/effects/current');

            /**
             * @type {{effect_id: Number, preset_id: Number, unique_id: String}}
             */
            const effect = {};
            this.getObjectByArrayNew('led/effects/current', effect, response, ['effect_id', 'preset_id', 'unique_id']);

            return {effect: effect, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set current LED effect
     * @param {Number} effectId
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-led-effect">REST-API</a>
     */
    async setCurrentLEDEffect(effectId) {
        try {
            const response = await this._post('led/effects/current', {effect_id: effectId});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get LED config
     @return {Promise<{color: {hue: Number, saturation: Number, value: Number, red: Number, green: Number, blue: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-config">REST-API</a>
     */
    async getLEDConfig() {
        // try {
        //     const response = await this._get('led/mode');
        //
        //     /**
        //      * @type {{mode: String, shop_mode: Number, id: Number, unique_id: String, name: String}}
        //      */
        //     const mode = {};
        //     this.getObjectByArrayNew('led/mode', mode, response,
        //         ['id', 'color_config', 'mode', 'movie', 'musicreactive_config', 'name', 'shop_mode', 'unique_id']);
        //
        //     return {mode: mode, code: response['code']};
        // } catch (e) {
        //     throw Error(e.message);
        // }
    }

    /** Set LED config
     * @param {{}} color colorConfig
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-config">REST-API</a>
     */
    async setLEDConfig(color) {
        // try {
        //     const response = await this._post('led/mode', {'mode': mode});
        //
        //     return {code: response['code']};
        // } catch (e) {
        //     throw Error(e.message);
        // }
    }

    /** Upload full movie
     * @param {{}} movie
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-full-movie">REST-API</a>
     */
    async uploadFullMovie(movie) {
        try {
            const response = await this._post('led/movie/full', movie, {'Content-Type': 'application/octet-stream'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get LED movie config
     * @return {Promise<{movie: {frame_delay: Number, leds_number: Number, loop_type: Number, frames_number: Number,
     *                           sync?: {mode: String, slave_id: String, master_id: String, compat_mode: Number},
     *                           mic?: {filters: {}[], brightness_depth: Number, hue_depth: Number, value_depth: Number, saturation_depth: Number}}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-movie-config">REST-API</a>
     */
    async getLEDMovieConfig() {
        try {
            const response = await this._get('led/movie/config');

            /**
             * @type {{frame_delay: Number, leds_number: Number, loop_type: Number, frames_number: Number,
             *         sync?: {mode: String, slave_id: String, master_id: String, compat_mode: Number},
             *         mic?: {filters: {}[], brightness_depth: Number, hue_depth: Number, value_depth: Number, saturation_depth: Number}}}
             */
            const movie = {};
            this.getObjectByArrayNew('led/movie/config', movie, response,
                ['frame_delay', 'leds_number', 'loop_type', 'frames_number', 'sync', 'mic']);

            return {movie: movie, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set LED movie config
     * @param {Number} frame_delay
     * @param {Number} leds_number seems to be total number of LEDs to use
     * @param {Number} frames_number
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-movie-config">REST-API</a>
     */
    async setLEDMovieConfig(frame_delay, leds_number, frames_number) {
        try {
            const response = await this._post('led/movie/config', {frame_delay : frame_delay, leds_number : leds_number, frames_number : frames_number});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get brightness
     * @return {Promise<{bri: {value: Number, mode: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-brightness">REST-API</a>
     */
    async getBrightness() {
        try {
            const response = await this._get('led/out/brightness');

            /**
             * @type {{value: Number, mode: String}}
             */
            const bri = {};
            this.getObjectByArrayNew('led/out/brightness', bri, response, ['value', 'mode']);

            return {bri: bri, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set brightness absolute
     * @param {Number} brightness brightness level in range of 0..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessAbsolute(brightness) {
        try {
            const response = await this.setBrightness({value: brightness, mode: 'enabled', type: 'A'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set brightness relative
     * @param {Number} brightness brightness level in range of -100..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessRelative(brightness) {
        try {
            const response = await this.setBrightness({value: brightness, mode: 'enabled', type: 'R'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set brightness disabled
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessDisabled() {
        try {
            const response = await this.setBrightness({value: 0, mode: 'disabled', type: 'A'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set brightness
     * @param {{}} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightness(data) {
        try {
            const response = await this._post('led/out/brightness', data);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get saturation
     * @return {Promise<{sat: {value: Number, mode: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-saturation">REST-API</a>
     */
    async getSaturation() {
        try {
            const response = await this._get('led/out/saturation');

            /** @type {{value: Number, mode: String}} */
            const sat = {};
            this.getObjectByArrayNew('led/out/saturation', sat, response, ['value', 'mode']);

            return {sat: sat, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set saturation absolute
     * @param {Number} saturation saturation level in range of 0..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationAbsolute(saturation) {
        try {
            const response = await this.setSaturation({value: saturation, mode: 'enabled', type: 'A'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set saturation relative
     * @param {Number} saturation saturation level in range of -100..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationRelative(saturation) {
        try {
            const response = await this.setSaturation({value: saturation, mode: 'enabled', type: 'R'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set saturation disabled
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationDisabled() {
        try {
            const response = await this.setSaturation({value: 0, mode: 'disabled', type: 'A'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set saturation relative
     * @param {{}} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturation(data) {
        try {
            const response = await this._post('led/out/saturation', data);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Reset LED
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset-led">REST-API</a>
     */
    async resetLED() {
        try {
            const response = await this._get('reset');

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Reset LED (Reboot?)
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset2-led">REST-API</a>
     */
    async reset2LED() {
        try {
            const response = await this._get('reset2');

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Send Realtime Frame
     * @param {{}} frame
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#send-realtime-frame">REST-API</a>
     */
    async sendRealtimeFrame(frame) {
        try {
            const response = await this._post('led/led/rt/frame', frame, {'Content-Type': 'application/octet-stream'});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get firmware version
     * @return {Promise<{version: {version: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-firmware-version">REST-API</a>
     */
    async getFirmwareVersion() {
        try {
            const response = await this._get('fw/version');

            /** @type {{version: String}} */
            const version = {};
            this.getObjectByArrayNew('fw/version', version, response, ['version']);

            return {version: version, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Get Status
     * @return {Promise<{version: {version: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-status">REST-API</a>
     */
    async getStatus() {
        // try {
        //     const response = await this._get('led/mode');
        //
        //     /**
        //      * @type {{mode: String, shop_mode: Number, id: Number, unique_id: String, name: String}}
        //      */
        //     const mode = {};
        //     this.getObjectByArrayNew('led/mode', mode, response,
        //         ['id', 'color_config', 'mode', 'movie', 'musicreactive_config', 'name', 'shop_mode', 'unique_id']);
        //
        //     return {mode: mode, code: response['code']};
        // } catch (e) {
        //     throw Error(e.message);
        // }
    }

    /** Get list of movies
     * @return {Promise<{movies: {movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
     *                            available_frames: Number, max_capacity: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-list-of-movies">REST-API</a>
     */
    async getListOfMovies() {
        try {
            const response = await this._get('movies');

            /**
             * @type {{movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
             *         available_frames: Number, max_capacity: Number}}
             */
            const movies = {};
            this.getObjectByArrayNew('movies', movies, response, ['movies', 'available_frames', 'max_capacity']);

            return {movies: movies, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    // Delete movies

    // Create new movie entry

    // Upload new movie to list of movies

    /** Get current movie
     * @return {Promise<{movie: {id: Number, unique_id: String, name: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-movie">REST-API</a>
     */
    async getCurrentMovie() {
        try {
            const response = await this._get('movies/current');

            /**
             * @type {{id: Number, unique_id: String, name: String}}
             */
            const movie = {};
            this.getObjectByArrayNew('movies/current', movie, response, ['id', 'unique_id', 'name']);

            return {movie: movie, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set current movie
     * @param {Number} movieId
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-movie">REST-API</a>
     */
    async setCurrentMovie(movieId) {
        try {
            const response = await this._post('movies/current', {id: movieId});

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    // Initiate WiFi network scan

    // Get results of WiFi network scan

    /** Get network status
     * @return {Promise<{status: {}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-network-status">REST-API</a>
     */
    async getNetworkStatus() {
        try {
            const response = await this._get('network/status');

            /**
             * @type {{}}
             */
            const status = {};
            this.getObjectByArrayNew('network/status', status, response, ['mode', 'station', 'ap']);

            return {status: status, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set network status
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatus() {
        // const response = await this._post('network/status', );
        // return {code: response['code']};
    }

    /** Get MQTT configuration
     * @return {Promise<{mqtt: {broker_host : String,
     *                          broker_port : Number,
     *                          client_id   : String,
     *                          user        : String,
     *                          keep_alive_interval: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mqtt-configuration">REST-API</a>
     */
    async getMqttConfiguration() {
        try {
            const response = await this._get('mqtt/config');

            /**
             * @type {{broker_host : String, broker_port : Number, client_id : String, user: String, keep_alive_interval: Number}}
             */
            const mqtt = {};
            this.getObjectByArrayNew('mqtt/config', mqtt, response, [
                'broker_host', 'broker_port', 'client_id', 'user', 'keep_alive_interval', 'encryption_key_set']);

            return {mqtt: mqtt, code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    /** Set MQTT configuration
     * @param {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean} | String} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-mqtt-configuration">REST-API</a>
     */
    async setMqttConfiguration(data) {
        try {
            data = typeof data === 'string' ? JSON.parse(data) : data;

            const response = await this._post('mqtt/config', data);

            return {code: response['code']};
        } catch (e) {
            throw Error(e.message);
        }
    }

    // Get playlist

    // Create playlist

    // Delete playlist

    // Get current playlist entry

    // Set current playlist entry

    // Get mic config

    // Get mic sample

    // Get summary

    // Get music drivers

    // Get music drivers sets

    // Get current music driverset

    /**
     * @param {string} name
     * @param {string} mode
     * @param {string} path
     * @param {number} code
     */
    translateTwinklyCode(name, mode, path, code) {
        if (code && code !== HTTPCodes.values.ok)
            return `[${name}.${mode}.${path}] ${code} (${HTTPCodes.text[code]})`;
    }

    /**
     *
     * @param {string} name
     * @param {{}} input
     * @param {string[]} include
     * @param {string[]} exclude
     * @return {{}}
     */
    getObjectByArray(name, input, include = [], exclude = ['code']) {
        const json = {};
        for (const key of Object.keys(input)) {
            if (include.length === 0 || include.includes(key))
                json[key] = input[key];
            else if (!exclude.includes(key)) {
                this.handleSentryMessages('getObjectByArray',
                    `${name}:${key}`, `New Item in Response ${name}! (${key}, ${JSON.stringify(input[key])}, ${typeof input[key]})`);
            }
        }

        return json;
    }

    /**
     *
     * @param {string} name
     * @param {{}} output
     * @param {{}} input
     * @param {string[]} include
     * @param {string[]} exclude
     */
    getObjectByArrayNew(name, output, input, include = [], exclude = ['code']) {
        for (const key of Object.keys(input)) {
            if (include.length === 0 || include.includes(key))
                output[key] = input[key];
            else if (!exclude.includes(key)) {
                this.handleSentryMessages('getObjectByArrayNew',
                    `${name}:${key}`, `New Item in Response ${name}! (${key}, ${JSON.stringify(input[key])}, ${typeof input[key]})`);
            }
        }
    }

    /**
     * @param {{name: String, val: any}} filter
     * @return {Promise<boolean>}
     */
    async checkDetailInfo(filter) {
        if (filter === undefined || filter.name === undefined || filter.val === undefined) return false;

        await this.interview();
        if (Object.keys(this.details).length === 0) return false;

        return Object.keys(this.details.details).includes(filter.name) && this.details.details[filter.name] === filter.val;
    }

    /**
     * @param {string} path
     * @return {Promise<{}>}
     */
    async _get(path) {
        this.adapter.log.debug(`[${this.name}._get] <${path}>`);

        try {
            // Token erneuern
            await this.ensure_token(false);
        } catch (e) {
            throw Error(e.message);
        }

        let response, error;
        try {
            // GET ausführen...
            response = await this._doGET(path);
        } catch (e) {
            error = e.message;
        }

        if (error) {
            if (error === HTTPCodes.INVALID_TOKEN) {
                try {
                    // Token erneuern
                    await this.ensure_token(true);
                } catch (e) {
                    throw Error(e.message);
                }

                let error;
                try {
                    // GET erneut ausführen...
                    response = await this._doGET(path);
                } catch (e) {
                    error = e.message;
                }

                if (error) {
                    // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                    if (error === HTTPCodes.INVALID_TOKEN)
                        this.token = '';
                    throw Error(error);
                }
            } else
                throw Error(error);
        }

        return response;
    }

    /**
     * @param {string} path
     * @return {Promise<{}>}
     */
    async _doGET(path) {
        let response;
        try {
            response = await this.sendGetHTTP(this.base() + '/' + path, this.headers);
        } catch (e) {
            throw Error(e.message);
        }

        let checkTwinklyCode;
        try {
            if (response && typeof response === 'object')
                checkTwinklyCode = this.translateTwinklyCode(this.name, 'GET', path, response['code']);
        } catch (e) {
            throw Error(`${e.name}: ${e.message}`);
        }

        if (checkTwinklyCode)
            throw Error(`${checkTwinklyCode}, Headers: ${JSON.stringify(this.headers)}`);

        return response;
    }

    /**
     * @param {string} url
     * @param {{}} headers
     * @return {Promise<string | {}>}
     */
    async sendGetHTTP(url, headers = {}) {
        try {
            const response = await request.sendGetHTTP(url, headers);

            if (response)
                this.adapter.log.debug('[sendGetHTTP] ' + JSON.stringify(response));
            return response;
        } catch (e) {
            if (e && e.message && String(e.message).includes(HTTPCodes.INVALID_TOKEN))
                throw Error(HTTPCodes.INVALID_TOKEN);
            else
                throw Error(e.message);
        }
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<{}>}
     */
    async _post(path, data, headers = {}) {
        for (const header of Object.keys(this.headers)) {
            if (!Object.keys(headers).includes(header))
                headers[header] = this.headers[header];
        }

        this.adapter.log.debug(`[${this.name}._post] <${path}>, ${JSON.stringify(data)}, ${JSON.stringify(headers)}`);

        try {
            await this.ensure_token(false);
        } catch (e) {
            throw Error(e.message);
        }

        let response, error;
        try {
            // POST ausführen...
            response = await this._doPOST(path, data, headers);
        } catch (e) {
            error = e.message;
        }

        if (error) {
            if (error === HTTPCodes.INVALID_TOKEN) {
                try {
                    // Token erneuern
                    await this.ensure_token(true);
                } catch (e) {
                    throw Error(e.message);
                }

                let error;
                try {
                    // POST erneut ausführen...
                    response = await this._doPOST(path, data, headers);
                } catch (e) {
                    error = e.message;
                }

                // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                if (error) {
                    if (error === HTTPCodes.INVALID_TOKEN)
                        this.token = '';
                    throw Error(error);
                }
            } else {
                throw Error(error);
            }
        }

        return response;
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<{}>}
     */
    async _doPOST(path, data, headers) {
        let response;
        try {
            response = await this.sendPostHTTP(this.base() + '/' + path, data, headers);
        } catch (e) {
            throw Error(e.message);
        }

        let checkTwinklyCode;
        try {
            if (response && typeof response === 'object')
                checkTwinklyCode = this.translateTwinklyCode(this.name, 'POST', path, response['code']);
        } catch (e) {
            throw Error(`${e.name}: ${e.message}`);
        }

        if (checkTwinklyCode)
            throw Error(`${checkTwinklyCode}, Data: ${JSON.stringify(data)}, Headers: ${JSON.stringify(headers)}`);

        return response;
    }

    /**
     * @param {string} url
     * @param {string | {}} body
     * @param {{}} headers
     * @return {Promise<string | {}>}
     */
    async sendPostHTTP(url, body, headers = {}) {
        try {
            const response = await request.sendPostHTTP(url, body, headers);

            if (response)
                this.adapter.log.debug('[sendPostHTTP] ' + JSON.stringify(response));
            return response;
        } catch (e) {
            if (e && e.message && String(e.message).includes(HTTPCodes.INVALID_TOKEN))
                throw Error(HTTPCodes.INVALID_TOKEN);
            else
                throw Error(e.message);
        }
    }

    /**
     * Ping
     * @returns {Promise<Boolean>}
     */
    async ping() {
        let result = false;
        await ping.probe(this.host, {log: this.adapter.log.debug})
            .then(({host, alive, ms}) => {
                this.adapter.log.debug('[ping] Ping result for ' + host + ': ' + alive + ' in ' + (ms === null ? '-' : ms) + 'ms');
                result = alive;
            })
            .catch(error => {
                this.adapter.log.error(this.name + ': ' + error);
            });

        this.connected = result;
        return result;
    }
}

module.exports = {
    Twinkly,
    HTTPCodes,
    lightModes
};