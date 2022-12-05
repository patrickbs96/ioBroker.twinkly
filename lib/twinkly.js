const ping    = require('./ping');
const tools   = require('./tools');
const crypto  = require('crypto');
// const dgram   = require('dgram');
const axios   = require('axios').default;

const HTTPCodes = {
    values : {
        ok           : 1000,
        invalid      : 1101,
        error        : 1102,
        errorValue   : 1103,
        errorJSON    : 1104,
        invalidKey   : 1105,
        errorLogin   : 1106,
        errorConnect : 9999
    },
    text : {
        1000 : 'OK',
        1101 : 'Invalid argument value',
        1102 : 'Error',
        1103 : 'Error - value too long',
        1104 : 'Error - malformed JSON on input',
        1105 : 'Invalid argument key',
        1106 : 'Error - Login',
        9999 : 'Error - not connected'
    },

    INVALID_TOKEN : 'Invalid Token'
};

const lightModes = {
    value: {
        color         : 'color',
        effect        : 'effect',
        movie         : 'movie',
        musicreactive : 'musicreactive',
        playlist      : 'playlist',
        off           : 'off',
        rt            : 'rt',
        demo          : 'demo'
    },

    text : {
        color         : 'Color',
        effect        : 'Effect',
        movie         : 'Movie',
        musicreactive : 'Music Reactive',
        playlist      : 'Playlist',
        off           : 'Off',
        rt            : 'Real Time',
        demo          : 'Demo'
    }
};

const STATE_ON_LASTMODE = 'lastMode';

const TOKEN_VERIFICATION_FAILED = `(${HTTPCodes.values.error}) Verification failed!`;

// UDP port to send realtime frames to
// const REALTIME_UDP_PORT_NUMBER = 7777;

// https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L58
const TWINKLY_MUSIC_DRIVERS_OFFICIAL = {
    'VU Meter': '00000000-0000-0000-0000-000000000001',
    'Beat Hue': '00000000-0000-0000-0000-000000000002',
    'Psychedelica': '00000000-0000-0000-0000-000000000003',
    'Red Vertigo': '00000000-0000-0000-0000-000000000004',
    'Dancing Bands': '00000000-0000-0000-0000-000000000005',
    'Diamond Swirl': '00000000-0000-0000-0000-000000000006',
    'Joyful Stripes': '00000000-0000-0000-0000-000000000007',
    'Angel Fade': '00000000-0000-0000-0000-000000000008',
    'Clockwork': '00000000-0000-0000-0000-000000000009',
    'Sipario': '00000000-0000-0000-0000-00000000000A',
    'Sunset': '00000000-0000-0000-0000-00000000000B',
    'Elevator': '00000000-0000-0000-0000-00000000000C',
};

// https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L73
const TWINKLY_MUSIC_DRIVERS_UNOFFICIAL = {
    'VU Meter 2': '00000000-0000-0000-0000-000001000001',
    'Beat Hue 2': '00000000-0000-0000-0000-000001000002',
    'Psychedelica 2': '00000000-0000-0000-0000-000001000003',
    'Sparkle': '00000000-0000-0000-0000-000001000005',
    'Sparkle Hue': '00000000-0000-0000-0000-000001000006',
    'Psycho Sparkle': '00000000-0000-0000-0000-000001000007',
    'Psycho Hue': '00000000-0000-0000-0000-000001000008',
    'Red Line': '00000000-0000-0000-0000-000001000009',
    'Red Vertigo 2': '00000000-0000-0000-0000-000002000004',
    'Dancing Bands 2': '00000000-0000-0000-0000-000002000005',
    'Diamond Swirl 2': '00000000-0000-0000-0000-000002000006',
    'Angel Fade 2': '00000000-0000-0000-0000-000002000008',
    'Clockwork 2': '00000000-0000-0000-0000-000002000009',
    'Sunset 2': '00000000-0000-0000-0000-00000200000B',
};

class Twinkly {
    /**
     *
     * @param {ioBroker.Adapter} adapter
     * @param {string} name
     * @param {string} host
     * @param {function(connection: String, type: string, val: any, oldVal: any)} onDataChange
     */
    constructor(adapter, name, host, onDataChange) {
        this.adapter = adapter;
        this.name    = name;
        this.host    = host;
        this.onDataChange = onDataChange;

        // Axios
        this.axiosInstance = axios.create({
            baseURL : this.base(),
            headers : {
                'Content-Type': 'application/json'
            }
        });

        this.connected = false;
        this.firmware  = '0.0.0';
        this.ledMode   = '';

        /**
         * @type {{base_leds_number: Number, bytes_per_led: Number, copyright: String, device_name: String, flash_size: Number,
         *         frame_rate: Number, fw_family: String, hardware_version: String, hw_id: String, led_profile: String,
         *         led_type: Number, mac: String, max_movies: Number, max_supported_led: Number, measured_frame_rate: Number,
         *         movie_capacity: Number, number_of_led: Number, production_site: Number, production_date: Number,
         *         product_name: String, product_code: String, serial: String, uid: String, uptime: String, uuid: String,
         *         wire_type: Number, group: {mode: String, compat_mode: Number, uid: String}}}
         */
        this.details    = {};
        /** @type {{[p: String]: String}} */
        this.ledEffects = {};
        /** @type {{[p: String]: String}} */
        this.ledMovies  = {};
        /** @type {{[p: String]: String}} */
        this.playlist  = {};

        this.resetToken();
    }

    /**
     *
     * @return {String}
     */
    base() {
        return `http://${this.host}/xled/v1/`;
    }

    /**
     *
     * @return {Number} Anzahl LEDs
     */
    async length() {
        await this.interview();

        if (Object.keys(this.details).includes('number_of_led')) {
            return Number(this.details['number_of_led']);
        }

        return -1;
    }

    /**
     *
     * @return {Promise<void>}
     */
    async interview() {
        if (!this.connected) {
            this.adapter.log.debug(`[${this.name}.interview] Not connected!`);
            return;
        }

        if (this.isFirmwareEmpty()) {
            try {
                await this.getFirmwareVersion();
            } catch (e) {
                this.adapter.log.error(`[${this.name}.interview.fw] ${e}`);
            }
        }

        if (Object.keys(this.details).length === 0) {
            try {
                await this.getDeviceDetails();
            } catch (e) {
                this.adapter.log.error(`[${this.name}.interview.details] ${e}`);
            }
        }
    }

    /**
     * Token prüfen ob er bereits abgelaufen ist.
     * @param {boolean} force
     * @return {Promise<void>}
     */
    async ensure_token(force) {
        if (force || this.isTokenEmpty() || this.expires <= Date.now()) {
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh...`);

            try {
                await this.login();
                await this.verify();
            } catch (e) {
                if (e.message === TOKEN_VERIFICATION_FAILED) {
                    this.adapter.log.debug(`[${this.name}.ensure_token] Verification failed, another Instance maybe trying to access this API...`);
                } else {
                    throw Error(e.message);
                }
            }
        } else {
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`);
        }
    }

    /**
     * Login
     * @return {Promise<{authenticationToken: String, authenticationTokenExpiresIn: Number, challengeResponse: String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#login">REST-API</a>
     */
    async login() {
        this.resetToken();

        const buffer = crypto.randomBytes(32);
        const response = await this._sendRequestTwinklyCodeCheck('POST', 'login', {challenge: buffer.toString('base64')});

        this._setToken(String(response['authentication_token']));
        this.expires           = Date.now() + (Number(response['authentication_token_expires_in']) * 1000);
        this.challengeResponse = String(response['challenge-response']);

        return {
            authenticationToken          : String(response['authentication_token']),
            authenticationTokenExpiresIn : Number(response['authentication_token_expires_in']),
            challengeResponse            : String(response['challenge-response']),
            code                         : Number(response.code)
        };
    }

    /**
     * Verify
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#verify">REST-API</a>
     */
    async verify() {
        if (this.challengeResponse === '') {
            throw Error('Challenge-Response nicht gefüllt!');
        }

        try {
            const response = await this._sendRequestTwinklyCodeCheck('POST', 'verify', {'challenge-response': this.challengeResponse});
            return {code: response.code};
        } catch (e) {
            this.resetToken();
            if (e.message.includes(`(${HTTPCodes.values.error})`)) {
                throw Error(TOKEN_VERIFICATION_FAILED);
            } else {
                throw Error(e.message);
            }
        }
    }

    /**
     * Logout
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#logout">REST-API</a>
     */
    async logout() {
        let response;
        if (!this.isTokenEmpty()) {
            response = await this._post('logout', {});
            this.resetToken();
        }

        return {code: response ? response.code : HTTPCodes.values.ok};
    }

    /**
     * Device details
     * @return {Promise<{details: {base_leds_number: Number, bytes_per_led: Number, copyright: String, device_name: String, flash_size: Number,
     *                             frame_rate: Number, fw_family: String, hardware_version: String, hw_id: String, led_profile: String,
     *                             led_type: Number, mac: String, max_movies: Number, max_supported_led: Number, measured_frame_rate: Number,
     *                             movie_capacity: Number, number_of_led: Number, production_site: Number, production_date: Number,
     *                             product_name: String, product_code: String, serial: String, uid: String, uptime: String, uuid: String,
     *                             wire_type: Number, group: {mode: String, compat_mode: Number, uid: String}},
     *                   code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#device-details">REST-API</a>
     */
    async getDeviceDetails() {
        const oldDetails = this.details;
        this.details = {};

        const param    = tools.versionGreaterEquals('2.8.3', this.firmware) ? '?filter=prod_infos&filter2=group' : '';
        const response = await this._sendRequestTwinklyCodeCheck('GET', 'gestalt' + param, null);

        this._cloneTwinklyResponse(response, this.details);

        // Check for changes after first run
        if (Object.keys(oldDetails).length > 0) {
            // Check if group mode changed
            if (this.details.group) {
                await this._checkDataChange('groupMode', this.details.group.mode, oldDetails.group ? oldDetails.group.mode : '');
            }
        }

        return {details: this.details, code: response.code};
    }

    /**
     * Get Device name
     * @return {Promise<{name: {name: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-device-name">REST-API</a>
     */
    async getDeviceName() {
        const response = await this._get('device_name');

        /**
         * @type {{name: String}}
         */
        const name = {};
        this._cloneTwinklyResponse(response, name);

        return {name: name, code: response.code};
    }

    /**
     * Set Device name
     * @param {String} name Desired device name. At most 32 characters
     * @return {Promise<{name: String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-device-name">REST-API</a>
     */
    async setDeviceName(name) {
        return await this._post('device_name', {name: name});
    }

    /**
     * Echo
     * @param {String} message
     * @return {Promise<{message: String, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#echo">REST-API</a>
     */
    async echo(message) {
        const response = await this._post('echo', {message: message});
        return {message: response.json.message, code: response.code};
    }

    /**
     * Get timer
     * @return {Promise<{timer: {time_now: Number, time_on: Number, time_off: Number, tz: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-timer">REST-API</a>
     */
    async getTimer() {
        const response = await this._get('timer');

        /**
         * @type {{time_now: Number, time_on: Number, time_off: Number, tz: String}}
         */
        const timer = {};
        this._cloneTwinklyResponse(response, timer);

        return {timer: timer, code: response.code};
    }

    /**
     * Set timer
     * @param {{time_now: Number, time_on: Number, time_off: Number, tz: String} | String} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-timer">REST-API</a>
     */
    async setTimer(data) {
        return await this._post('timer', typeof data === 'string' ? JSON.parse(data) : data);
    }

    /**
     * Get Layout
     * @return {Promise<{layout: {aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean, uuid: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-layout">REST-API</a>
     */
    async getLayout() {
        const response = await this._get('led/layout/full');

        /**
         * @type {{aspectXY: Number, aspectXZ: Number, coordinates: {x: Number, y: Number, z: Number}[], source: String, synthesized: Boolean, uuid: String}}
         */
        const layout = {};
        this._cloneTwinklyResponse(response, layout);

        return {layout: layout, code: response.code};
    }

    /**
     * Upload Layout
     * @param {Number} aspectXY
     * @param {Number} aspectXZ
     * @param {{x: Number, y: Number, z: Number}[]} coordinates
     * @param {String} source “linear”, “2d”, “3d”
     * @param {Boolean} synthesized
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-layout">REST-API</a>
     */
    async uploadLayout(aspectXY, aspectXZ, coordinates, source, synthesized) {
        return await this._post('led/layout/full',
            {aspectXY: aspectXY, aspectXZ: aspectXZ, coordinates: coordinates, source: source, synthesized: synthesized});
    }

    /**
     * Get LED operation mode
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
            this._cloneTwinklyResponse(response, mode);

            const oldMode = this.ledMode;
            this.ledMode  = mode.mode;

            if (mode.mode !== '') {
                await this._checkDataChange('ledMode', this.ledMode, oldMode);
            }

            return {mode: mode, code: response.code};
        } catch (e) {
            this.ledMode = lightModes.value.off;
            throw Error(e.message);
        }
    }

    /**
     * Set LED operation mode
     * @param {String} mode mode of operation
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-operation-mode">REST-API</a>
     */
    async setLEDMode(mode) {
        return await this._post('led/mode', {mode: mode});
    }

    /**
     * Get LED color
     * @return {Promise<{color: {hue: Number, saturation: Number, value: Number, red: Number, green: Number, blue: Number, white: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-color">REST-API</a>
     */
    async getLEDColor() {
        const response = await this._get('led/color');

        /**
         * @type {{hue: Number, saturation: Number, value: Number, red: Number, green: Number, blue: Number, white: Number}}
         */
        const color = {};
        this._cloneTwinklyResponse(response, color);

        return {color: color, code: response.code};
    }

    /**
     * Set LED color
     * @param {Number} hue Hue
     * @param {Number} sat Saturation
     * @param {Number} value Value
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorHSV(hue, sat, value) {
        return await this.setLEDColor({hue: hue, saturation: sat, value: value});
    }

    /**
     * Set LED color
     * @param {Number} red Red
     * @param {Number} green Green
     * @param {Number} blue Blue
     * @param {Number} [white] White
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorRGBW(red, green, blue, white) {
        /** @type {{red: Number, green: Number, blue: Number, white?: Number}} */
        const data = {red: red, green: green, blue: blue};
        if (white >= 0 && await this.checkDetailInfo({name: 'led_profile', val: 'RGBW'})) {
            data.white = white;
        }

        return await this.setLEDColor(data);
    }

    /**
     * Set LED color
     * @param {{}} color colorConfig
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColor(color) {
        return await this._post('led/color', color);
    }

    /**
     * Get LED effects
     * @return {Promise<{effects: {effects_number: Number, unique_ids: String[]}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-effects">REST-API</a>
     */
    async getLEDEffects() {
        const response = await this._get('led/effects');

        /**
         * @type {{effects_number: Number, unique_ids: String[]}}
         */
        const effects = {};
        this._cloneTwinklyResponse(response, effects);

        return {effects: effects, code: response.code};
    }

    /**
     * Get LED effects
     * @return {Promise<{effects: {effects_number: Number, unique_ids: String[]}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-effects">REST-API</a>
     */
    async getListOfLEDEffects() {
        this.ledEffects = {};

        const response = await this.getLEDEffects();
        for (let effect = 0; effect < response.effects.effects_number; effect++) {
            this.ledEffects[effect] = `Effect ${effect+1}`;
        }
    }

    /**
     * Get current LED effect
     * @return {Promise<{effect: {effect_id: Number, preset_id: Number, unique_id: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-led-effect">REST-API</a>
     */
    async getCurrentLEDEffect() {
        const response = await this._get('led/effects/current');

        /**
         * @type {{effect_id: Number, preset_id: Number, unique_id: String}}
         */
        const effect = {};
        this._cloneTwinklyResponse(response, effect);

        return {effect: effect, code: response.code};
    }

    /**
     * Set current LED effect
     * @param {Number} effectId
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-led-effect">REST-API</a>
     */
    async setCurrentLEDEffect(effectId) {
        return await this._post('led/effects/current', {effect_id: effectId});
    }

    /**
     * Get LED config
     * @return {Promise<{config: {strings: {first_led_id: Number, length: Number}[]}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-config">REST-API</a>
     */
    async getLEDConfig() {
        const response = await this._get('led/config');

        /**
         * @type {{strings: {first_led_id: Number, length: Number}[]}}
         */
        const config = {};
        this._cloneTwinklyResponse(response, config);

        return {config: config, code: response.code};
    }

    /**
     * Set LED config
     * @param {{first_led_id: Number, length: Number}[]} strings
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-config">REST-API</a>
     */
    async setLEDConfig(strings) {
        return await this._post('led/config', {strings: strings});
    }

    /**
     * Upload movie
     * @param {{r: Number, g: Number, b: Number}[][]} frames
     * @param {Number} delay between frames in ms
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-full-movie">REST-API</a>
     */
    async uploadMovie(frames, delay) {
        const movieFormat = this._convertMovieFormat(frames);

        // Switch off lights
        let response = await this.setLEDMode(lightModes.value.off);
        // Upload movie
        if (response.code === HTTPCodes.values.ok) {
            response = await this._post('led/movie/full', movieFormat.bufferArray, {'Content-Type': 'application/octet-stream'});
        }
        // Update configuration
        if (response.code === HTTPCodes.values.ok) {
            response = await this.setLEDMovieConfig(delay, movieFormat.lightsCount, movieFormat.frameCount);
        }
        // Switch on lights
        if (response.code === HTTPCodes.values.ok) {
            response = await this.setLEDMode(lightModes.value.movie);
        }

        return {code: response.code};
    }

    /**
     *
     * @param {{r: Number, g: Number, b: Number}[][]} frames
     * @returns {{lightsCount, frameCount: number, bufferArray: ArrayBuffer}}
     * @private
     */
    _convertMovieFormat (frames) {
        const lightsCount = frames[0].length;

        const fullArray = [];
        for (let x = 0; x < frames.length; x++) {
            if (frames[x].length !== lightsCount) {
                throw new Error('Not all frames have the same number of lights!');
            }
            for (let y = 0; y < frames[x].length; y++) {
                fullArray.push(frames[x][y].r);
                fullArray.push(frames[x][y].g);
                fullArray.push(frames[x][y].b);
            }
        }

        const output = {
            bufferArray : new ArrayBuffer(fullArray.length),
            frameCount  : frames.length,
            lightsCount : lightsCount
        };

        const longInt8View = new Uint8Array(output.bufferArray);
        for (let x = 0; x < fullArray.length; x++) {
            longInt8View[x] = fullArray[x];
        }

        return output;
    }

    /**
     * Generate a full frame of a solid color
     * @param {{r: Number, g: Number, b: Number}|String} color RGB-Object or Hex-String
     * @returns {{r: Number, g: Number, b: Number}[]}
     */
    generateFrame (color) {
        if (typeof color === 'string') {
            color = tools.hexToRgb(color);
        }

        const frame = [];
        for (let x = 0; x < this.details.number_of_led; x++) {
            frame.push({r: color.r, g: color.g, b: color.b});
        }

        return frame;
    }

    /**
     * Generate a frames of a solid color
     * @param {{r: Number, g: Number, b: Number}|String|{r: Number, g: Number, b: Number}[]|String[]} colors RGB-Object or Hex-String
     * @returns {{r: Number, g: Number, b: Number}[]}
     */
    generateFrames (colors) {
        if (!tools.isArray(colors)) {
            colors = [colors];
        }

        const frames = [];
        for (const color of colors) {
            frames.push(this.generateFrame(color));
        }

        return frames;
    }

    /**
     * Get LED movie config
     * @return {Promise<{movie: {frame_delay: Number, leds_number: Number, loop_type: Number, frames_number: Number,
     *                           sync?: {mode: String, slave_id: String, master_id: String, compat_mode: Number},
     *                           mic?: {filters: {}[], brightness_depth: Number, hue_depth: Number, value_depth: Number, saturation_depth: Number}}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-movie-config">REST-API</a>
     */
    async getLEDMovieConfig() {
        const response = await this._get('led/movie/config');

        /**
         * @type {{frame_delay: Number, leds_number: Number, loop_type: Number, frames_number: Number,
         *         sync?: {mode: String, slave_id: String, master_id: String, compat_mode: Number},
         *         mic?: {filters: {}[], brightness_depth: Number, hue_depth: Number, value_depth: Number, saturation_depth: Number}}}
         */
        const movie = {};
        this._cloneTwinklyResponse(response, movie);

        return {movie: movie, code: response.code};
    }

    /**
     * Set LED movie config
     * @param {Number} delay delay between frames in ms
     * @param {Number} leds Number of leds in the frame
     * @param {Number} frames Number of frames
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-movie-config">REST-API</a>
     */
    async setLEDMovieConfig(delay, leds, frames) {
        return await this._post('led/movie/config', {frame_delay : delay, leds_number : leds, frames_number : frames});
    }

    /**
     * Get brightness
     * @return {Promise<{bri: {value: Number, mode: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-brightness">REST-API</a>
     */
    async getBrightness() {
        const response = await this._get('led/out/brightness');

        /**
         * @type {{value: Number, mode: String}}
         */
        const bri = {};
        this._cloneTwinklyResponse(response, bri);

        return {bri: bri, code: response.code};
    }

    /**
     * Set brightness absolute
     * @param {Number} brightness brightness level in range of 0..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessAbsolute(brightness) {
        return await this.setBrightness({value: brightness, mode: 'enabled', type: 'A'});
    }

    /**
     * Set brightness relative
     * @param {Number} brightness brightness level in range of -100..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessRelative(brightness) {
        return await this.setBrightness({value: brightness, mode: 'enabled', type: 'R'});
    }

    /**
     * Set brightness disabled
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessDisabled() {
        return await this.setBrightness({value: 0, mode: 'disabled', type: 'A'});
    }

    /**
     * Set brightness
     * @param {{value: number, mode: 'enabled'|'disabled', type: 'A'|'R'}} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightness(data) {
        return await this._post('led/out/brightness', data);
    }

    /**
     * Get saturation
     * @return {Promise<{sat: {value: Number, mode: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-saturation">REST-API</a>
     */
    async getSaturation() {
        const response = await this._get('led/out/saturation');

        /** @type {{value: Number, mode: String}} */
        const sat = {};
        this._cloneTwinklyResponse(response, sat);

        return {sat: sat, code: response.code};
    }

    /**
     * Set saturation absolute
     * @param {Number} saturation saturation level in range of 0..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationAbsolute(saturation) {
        return await this.setSaturation({value: saturation, mode: 'enabled', type: 'A'});
    }

    /**
     * Set saturation relative
     * @param {Number} saturation saturation level in range of -100..100
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationRelative(saturation) {
        return await this.setSaturation({value: saturation, mode: 'enabled', type: 'R'});
    }

    /**
     * Set saturation disabled
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationDisabled() {
        return await this.setSaturation({value: 0, mode: 'disabled', type: 'A'});
    }

    /**
     * Set saturation relative
     * @param {{value: number, mode: 'enabled'|'disabled', type: 'A'|'R'}} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturation(data) {
        return await this._post('led/out/saturation', data);
    }

    /**
     * Reset LED - Restart the current animation
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset-led">REST-API</a>
     */
    async resetLED() {
        return await this._get('reset');
    }

    /**
     * Reset LED (Reboot?)
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset2-led">REST-API</a>
     */
    async reset2LED() {
        return await this._get('reset2');
    }

    /**
     * Send Realtime Frame
     * @param {{r: Number, g: Number, b: Number}[]} frame
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#send-realtime-frame">REST-API</a>
     * @see <a href="https://github.com/scrool/xled/blob/develop/xled/control.py#L890-L906">Code xled</a>
     */
    async sendRealtimeFrame(frame) {
        return await this._post('led/rt/frame', frame, {'Content-Type': 'application/octet-stream'});
    }

    /**
     * Send Realtime Frame Socket
     * @return {Promise<{code}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/protocol_details.html#real-time-led-udp-datagram-format">Realtime</a>
     * @see <a href="https://github.com/scrool/xled/blob/develop/xled/control.py#L908-L945">Code xled</a>
     * @see <a href="https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L309-L318">Code ttls</a>
     */
    async sendRealtimeFrameSocket() {
        // https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L309-L318
        // const socket = dgram.createSocket('udp4');
        // socket.send(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 0, 8, REALTIME_UDP_PORT_NUMBER, this.host);
    }

    /**
     * Get firmware version
     * @return {Promise<{firmware: {version: String}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-firmware-version">REST-API</a>
     */
    async getFirmwareVersion() {
        const response = await this._sendRequestTwinklyCodeCheck('GET', 'fw/version', null);

        /** @type {{version: String}} */
        const firmware = {};
        this._cloneTwinklyResponse(response, firmware);

        const oldFirmware = this.firmware;
        this.firmware     = firmware.version;
        await this._checkDataChange('firmware', this.firmware, oldFirmware);

        return {firmware: firmware, code: response.code};
    }

    isFirmwareEmpty() {
        return this.firmware === '' || this.firmware === '0.0.0';
    }

    /**
     * Get Status
     * @return {Promise<{status: {status: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-status">REST-API</a>
     */
    async getStatus() {
        const response = await this._get('status');

        /** @type {{status: Number}} */
        const status = {};
        this._cloneTwinklyResponse(response, status);

        return {status: status, code: response.code};
    }

    /**
     * Get list of movies
     * @return {Promise<{movies: {movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
     *                            available_frames: Number, max_capacity: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-list-of-movies">REST-API</a>
     */
    async getListOfMovies() {
        this.ledMovies = {};

        try {
            const response = await this._get('movies');

            /**
             * @type {{movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
             *         available_frames: Number, max_capacity: Number}}
             */
            const movies = {};
            this._cloneTwinklyResponse(response, movies);

            // Liste füllen
            if (movies.movies) {
                for (const movie of movies.movies) {
                    this.ledMovies[movie.id] = movie.name;
                }
            }

            return {movies: movies, code: response.code};
        } catch (e) {
            // Wenn kein Movie aktiv ist, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return {movies: {movies: [], available_frames: 0, max_capacity: 0}, code: HTTPCodes.values.ok};
            }

            throw Error(e.message);
        }
    }

    // Delete movies

    // Create new movie entry

    // Upload new movie to list of movies

    /**
     * Get current movie
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
            this._cloneTwinklyResponse(response, movie);

            return {movie: movie, code: response.code};
        } catch (e) {
            // Wenn kein Movie aktiv ist, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return {movie: {id: -1, unique_id: '', name: ''}, code: HTTPCodes.values.ok};
            }

            throw Error(e.message);
        }
    }

    /**
     * Set current movie
     * @param {Number} movieId
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-movie">REST-API</a>
     */
    async setCurrentMovie(movieId) {
        return await this._post('movies/current', {id: movieId});
    }

    // Initiate WiFi network scan

    // Get results of WiFi network scan

    /**
     * Get network status
     * @return {Promise<{status: {mode: Number,
     *                            station: {ip: String, gw: String, mask: String, rssi: Number, ssid: String, status: String},
     *                            ap: {enc: Number, ip: String, channel: Number, max_connections: Number, password_changed: Number, ssid: String, ssid_hidden: Number}},
     *                   code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-network-status">REST-API</a>
     */
    async getNetworkStatus() {
        const response = await this._get('network/status');

        /**
         * @type {{mode: Number,
         *         station: {ip: String, gw: String, mask: String, rssi: Number, ssid: String, status: String},
         *         ap: {enc: Number, ip: String, channel: Number, max_connections: Number, password_changed: Number, ssid: String, ssid_hidden: Number}}}
         */
        const status = {};
        this._cloneTwinklyResponse(response, status);

        return {status: status, code: response.code};
    }

    /**
     * Set network status
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatusAP(data) {
        return await this.setNetworkStatus({mode: 2, ap: data});
    }

    /**
     * Set network status
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatusStation(data) {
        return await this.setNetworkStatus({mode: 1, station: data});
    }

    /**
     * Set network status
     * @param {{mode: Number, station?: {ip: String, gw: String, mask: String, rssi: Number, ssid: String, status: String},
     *          ap?: {enc: Number, ip: String, channel: Number, max_connections: Number, password_changed: Number, ssid: String, ssid_hidden: Number}}} data
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatus(data) {
        return await this._post('network/status', data);
    }

    /**
     * Get MQTT configuration
     * @return {Promise<{mqtt: {broker_host : String,
     *                          broker_port : Number,
     *                          client_id   : String,
     *                          user        : String,
     *                          keep_alive_interval: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mqtt-configuration">REST-API</a>
     */
    async getMqttConfiguration() {
        const response = await this._get('mqtt/config');

        /** @type {{broker_host : String, broker_port : Number, client_id : String, user: String, keep_alive_interval: Number}} */
        const mqtt = {};
        this._cloneTwinklyResponse(response, mqtt);

        return {mqtt: mqtt, code: response.code};
    }

    /**
     * Set MQTT configuration
     * @param {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean} | String} data
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-mqtt-configuration">REST-API</a>
     */
    async setMqttConfiguration(data) {
        return await this._post('mqtt/config', typeof data === 'string' ? JSON.parse(data) : data);
    }

    /**
     * Get playlist
     * @return {Promise<{playlist: {unique_id: String, name: String, entries: {id: Number, handle: Number, name: String, unique_id: String, duration: Number}[]}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-playlist">REST-API</a>
     */
    async getPlaylist() {
        this.playlist = {};

        const response = await this._get('playlist');

        /**
             * @type {{unique_id: String, name: String, entries:{id: Number, handle: Number, name: String, unique_id: String, duration: Number}[]}}
             */
        const playlist = {};
        this._cloneTwinklyResponse(response, playlist);

        // Liste füllen
        if (playlist.entries) {
            for (const entry of playlist.entries) {
                this.playlist[entry.id] = entry.name;
            }
        }

        return {playlist: playlist, code: response.code};
    }

    /**
     * Create playlist
     * @param {{duration: Number, unique_id: String}[]} entries
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#create-playlist">REST-API</a>
     */
    async createPlaylist(entries) {
        return await this._post('playlist', entries);
    }

    /**
     * Delete playlist
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#delete-playlist">REST-API</a>
     */
    async deletePlaylist() {
        return await this._delete('playlist');
    }

    /**
     * Get current playlist entry
     * @return {Promise<{playlist : {id: Number, unique_id: String, name: String, duration: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-playlist-entry">REST-API</a>
     */
    async getCurrentPlaylistEntry() {
        try {
            const response = await this._get('playlist/current');

            /**
             * @type {{id: Number, unique_id: String, name: String, duration: Number}}
             */
            const playlist  = {};
            this._cloneTwinklyResponse(response, playlist);

            return {playlist : playlist , code: response.code};
        } catch (e) {
            // Wenn keine Playlist existiert, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return {playlist: {id: -1, unique_id: '', name: '', duration: 0}, code: HTTPCodes.values.ok};
            }

            throw Error(e.message);
        }
    }

    /**
     * Set current playlist entry
     * @param {Number} playlistId
     * @return {Promise<{code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-playlist-entry">REST-API</a>
     */
    async setCurrentPlaylistEntry(playlistId) {
        return await this._post('playlist/current', {id: playlistId});
    }

    /**
     * Set mic configuration
     * @return {Promise<{code: number, summary: {filters: {}, silence_threshold: 0, active_range: number, brightness_depth: number,
     *                   hue_depth: number, value: depth, saturation_depth: number}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mic-config">REST-API</a>
     */
    async getMicConfig() {
        const response = await this._get('mic/config');

        /** @type {{filters: {}, silence_threshold: 0, active_range: number, brightness_depth: number, hue_depth: number, value: depth, saturation_depth: number}} */
        const micConfig = {};
        this._cloneTwinklyResponse(response, micConfig);

        return {code: response.code, summary: micConfig};
    }

    /**
     * Get mic sample
     * @return {Promise<{code: number, micSample: {sampled_value: number}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mic-sample">REST-API</a>
     */
    async getMicSample() {
        const response = await this._get('mic/sample');

        /** @type {{sampled_value: number}} */
        const micSample = {};
        this._cloneTwinklyResponse(response, micSample);

        return {code: response.code, micSample: micSample};
    }

    /**
     * Get summary
     * @return {Promise<{code: number, summary: {}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-summary">REST-API</a>
     */
    async getSummary() {
        const response = await this._get('summary');

        /** @type {{}} */
        const summary = {};
        this._cloneTwinklyResponse(response, summary);

        return {code: response.code, summary: summary};
    }

    /**
     * Get music drivers
     * @return {Promise<{code: number, musicDrivers: {drivers_number: Number, unique_ids: String[]}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-music-drivers">REST-API</a>
     */
    async getMusicDrivers() {
        const response = await this._get('music/drivers');

        /** @type {{drivers_number: Number, unique_ids: String[]}} */
        const musicDrivers = {};
        this._cloneTwinklyResponse(response, musicDrivers);

        return {code: response.code, musicDrivers: musicDrivers};
    }

    /**
     * Get current music driver
     * @return {Promise<{code: number, musicDriver: {handle: Number}}>}
     */
    async getCurrentMusicDriver() {
        const response = await this._get('music/drivers/current');

        // TODO: Inhalte prüfen
        /** @type {{handle: Number}} */
        const musicDriver = {};
        this._cloneTwinklyResponse(response, musicDriver);

        return {code: response.code, musicDriver: musicDriver};
    }

    /**
     * Set current music driver
     * @param {string} driverName
     * @return {Promise<{code: number}>}
     */
    async setCurrentMusicDriver(driverName) {
        const uniqueId = this._getMusicDriverIdByName(driverName);
        if (uniqueId === '') {
            throw Error(`${driverName} is an invalid music driver!`);
        }

        const currentDriver = await this.getCurrentMusicDriver();
        if (currentDriver.musicDriver.handle === -1) {
            await this.setNextMusicDriver();
        }

        return await this._post('music/drivers/current', {unique_id: uniqueId});
    }

    /**
     * Get Music driver by name
     * @param {string} name
     * @return {string}
     * @private
     */
    _getMusicDriverIdByName(name) {
        if (Object.keys(TWINKLY_MUSIC_DRIVERS_OFFICIAL).includes(name)) {
            return TWINKLY_MUSIC_DRIVERS_OFFICIAL[name];
        } else if (Object.keys(TWINKLY_MUSIC_DRIVERS_UNOFFICIAL).includes(name)) {
            this.adapter.log.info(`Music driver ${name} is defined, but is not officially supported`);
            return TWINKLY_MUSIC_DRIVERS_UNOFFICIAL[name];
        } else {
            return '';
        }
    }

    /**
     * Set next music driver
     * @return {Promise<{code: number}>}
     */
    async setNextMusicDriver() {
        return await this._post('music/drivers/current', {action: 'next'});
    }

    /**
     * Set previous music driver
     * @return {Promise<{code: number}>}
     */
    async setPreviousMusicDriver() {
        return await this._post('music/drivers/current', {action: 'prev'});
    }

    /**
     * Get music driver set
     * @return {Promise<{code: number, musicDriverSets: {current: Number, count: number, driversets: {id: number, count: number, unique_ids: string}[]}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-music-drivers-sets">REST-API</a>
     */
    async getMusicDriversSets() {
        const response = await this._get('music/drivers/sets');

        /** @type {{current: Number, count: number, driversets: {id: number, count: number, unique_ids: string}[]}} */
        const musicDriverSets = {};
        this._cloneTwinklyResponse(response, musicDriverSets);

        return {code: response.code, musicDriverSets: musicDriverSets};
    }

    /**
     * Get current music driver set
     * @return {Promise<{code: number, currentMusicDriverSet: {driverset_id: Number}}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-music-driverset">REST-API</a>
     */
    async getCurrentMusicDriversSet() {
        const response = await this._get('music/drivers/sets/current');

        /** @type {{driverset_id: Number}} */
        const currentMusicDriverSet = {};
        this._cloneTwinklyResponse(response, currentMusicDriverSet);

        return {code: response.code, currentMusicDriverSet: currentMusicDriverSet};
    }

    /**
     * Enable music
     * @param {boolean} enable
     * @return {Promise<{code: number}>}
     */
    async setMusicOn(enable) {
        return await this._post('music/enabled', {enabled: enable ? 1 : 0});
    }

    /**
     * Set Token
     * @param token
     * @private
     */
    _setToken(token) {
        this.token = token;
        this.axiosInstance.defaults.headers.common['X-Auth-Token'] = token;
    }

    /**
     * Reset Token Data
     * @private
     */
    resetToken() {
        this._setToken('');
        this.expires = 0;
        this.challengeResponse = '';
    }

    /**
     * Check if Token empty
     * @return {boolean}
     * @private
     */
    isTokenEmpty() {
        return this.token === '';
    }

    /**
     * @param {{name: String, val: any, type?: 'eq'|'ne'}} filter
     * @return {Promise<boolean>}
     */
    async checkDetailInfo(filter) {
        if (filter === undefined || filter.name === undefined || filter.val === undefined) return false;

        await this.interview();

        const filterPath = filter.name.split('.');

        // Walk through the filter path
        let details = this.details;
        for (const key of filterPath) {
            details = details[key];
            if (typeof details === 'undefined') {
                return false;
            }
        }

        filter.type = filter.type || 'eq';

        switch (filter.type) {
            case 'eq': return details === filter.val;
            case 'ne': return details !== filter.val;
            default: return false;
        }
    }

    /**
     * Check if values are different and execute dataChange event if available
     *
     * @param {string} type
     * @param {any} value
     * @param {any} oldValue
     * @return {Promise<void>}
     * @private
     */
    async _checkDataChange(type, value, oldValue) {
        if (value !== oldValue) {
            if (this.onDataChange) {
                await this.onDataChange(this.name, type, value, oldValue);
            }
        }
    }

    /**
     * @param {string} path
     * @return {Promise<any>}
     * @private
     */
    async _get(path) {
        return this._sendRequestTwinkly('GET', path, null);
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<any>}
     * @private
     */
    async _post(path, data, headers = {}) {
        return this._sendRequestTwinkly('POST', path, data, headers);
    }

    /**
     * @param {string} path
     * @param {{}} headers
     * @return {Promise<any>}
     * @private
     */
    async _delete(path, headers = {}) {
        return this._sendRequestTwinkly('DELETE', path, null, headers);
    }

    /**
     * @param {axios.Method} mode
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<any>}
     * @private
     */
    async _sendRequestTwinkly(mode, path, data, headers = {}) {
        await this.ensure_token(false);

        if (this.isTokenEmpty()) return {code: HTTPCodes.values.errorLogin};

        try {
            // Ausführen...
            return await this._sendRequestTwinklyCodeCheck(mode, path, data, headers);
        } catch (e) {
            // Bei "Invalid Token" wird es erneut versucht!
            if (e.message !== HTTPCodes.INVALID_TOKEN) {
                throw Error(e.message);
            }

            // Token erneuern
            await this.ensure_token(true);

            if (this.isTokenEmpty()) return {code: HTTPCodes.values.errorLogin};

            try {
                // Erneut ausführen...
                return await this._sendRequestTwinklyCodeCheck(mode, path, data, headers);
            } catch (e) {
                // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                if (e.message === HTTPCodes.INVALID_TOKEN) {
                    this.resetToken();
                }

                throw Error(e.message);
            }
        }
    }

    /**
     * Send Request and check Twinkly code
     *
     * @param {axios.Method} mode
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<any>}
     * @private
     */
    async _sendRequestTwinklyCodeCheck(mode, path, data, headers= {}) {
        if (!this.connected) return {code: HTTPCodes.values.errorConnect};

        let response;
        try {
            response = await this._sendRequest(path, data, mode, headers);
        } catch (e) {
            if (e.message && String(e.message).includes(HTTPCodes.INVALID_TOKEN)) {
                throw Error(HTTPCodes.INVALID_TOKEN);
            } else {
                throw Error(e.message);
            }
        }

        this._checkResponseTwinklyCode(mode, path, response);

        return response;
    }

    /**
     * Check Twinkly code in response
     *
     * @param {axios.Method} mode
     * @param {String} path
     * @param {any} response
     * @private
     */
    _checkResponseTwinklyCode(mode, path, response) {
        if (response && typeof response === 'object') {
            const code = response.code;
            if (code && code !== HTTPCodes.values.ok) {
                throw Error(`[${mode}.${path}] (${code}) ${HTTPCodes.text[code]}`);
            }
        }
    }

    /**
     * Add default Headers
     *
     * @param {{}} input
     * @param {{}} output
     * @private
     */
    _cloneTwinklyResponse(input, output) {
        tools.cloneObject(input, output);
        if (Object.keys(output).includes('code')) {
            delete output['code'];
        }
    }

    /**
     * Ping
     * @param {boolean} usePing
     * @returns {Promise<Boolean>}
     */
    async checkConnection(usePing) {
        let result = false;

        if (usePing) {
            try {
                /** @type {{host: string, alive: boolean, ms: number}} */
                const response = await ping.probe(this.host, {log: this.adapter.log.debug});
                this.adapter.log.debug(`[${this.name}.ping] Ping result for ${response.host}: ${response.alive} in ${response.ms === null ? '-' : response.ms}ms`);
                result = response.alive;
            } catch (e) {
                this.adapter.log.error(`[${this.name}.ping]: ${e}`);
            }
        } else {
            try {
                const response = await this.getDeviceDetails();
                result = response.code === HTTPCodes.values.ok;
            } catch (e) {
                //
            }
        }

        this.connected = result;
        return result;
    }

    /**
     * @param {string} url
     * @param {any} body
     * @param {axios.Method} method
     * @param {{}} headers
     * @return {Promise<any>}
     * @private
     */
    async _sendRequest(url, body, method, headers = {}) {
        this.adapter.log.debug(`[${this.name}._sendRequest.${method}] url="${url}", body="${body !== undefined ? JSON.stringify(body) : 'null'}", headers="${JSON.stringify(headers)}"`);

        let response;
        try {
            response = await this.axiosInstance.request({url: url, method: method, headers: headers, data: body});
        } catch (/** @type {axios.AxiosError | Error} */ e) {
            // Logging
            let message;
            if (e instanceof axios.AxiosError) {
                /** @type {object} */
                const json = e.toJSON();
                message = `code="${e.code}", status=${json.status}, config="${JSON.stringify(json.config)}", stack="${json.stack}"`;
            } else {
                message = `stack="${e.stack}"`;
            }

            this.adapter.log.debug(`[${this.name}._sendRequest.${method}] ${e.name}: "${e.message}", ${message}`);

            // Error handling
            if (e instanceof axios.AxiosError && e.response && e.response.status !== 200) {
                throw Error(`HTTP Error (${e.response.status}) ${e.response.statusText}${e.response.data ? ': ' + JSON.stringify(e.response.data) : ''}`);
            } else {
                throw Error(e.message ? e.message : e);
            }
        }

        if (typeof response === 'undefined') {
            throw Error('No response received');
        }

        if (response.status !== 200) {
            throw Error(`HTTP Error (${response.status}) ${response.statusText}${response.data ? ': ' + JSON.stringify(response.data) : ''}`);
        } else {
            if (response.data) {
                this.adapter.log.debug(`[${this.name}._sendRequest.${method}.response] ${JSON.stringify(response.data)}`);
            }
            return response.data;
        }
    }
}

module.exports = {
    Twinkly,
    HTTPCodes,
    lightModes,
    STATE_ON_LASTMODE
};
