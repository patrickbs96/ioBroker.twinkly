const ping = require('./ping');
const tools = require('./tools');
const crypto = require('node:crypto');
// const dgram   = require('dgram');
const axios = require('axios').default;

const HTTPCodes = {
    values: {
        ok: 1000,
        invalid: 1101,
        error: 1102,
        errorValue: 1103,
        errorJSON: 1104,
        invalidKey: 1105,
        errorLogin: 1106,
        errorConnect: 9999,
    },
    text: {
        1000: 'OK',
        1101: 'Invalid argument value',
        1102: 'Error',
        1103: 'Error - value too long',
        1104: 'Error - malformed JSON on input',
        1105: 'Invalid argument key',
        1106: 'Error - Login',
        9999: 'Error - not connected',
    },

    INVALID_TOKEN: 'Invalid Token',
};

const lightModes = {
    value: {
        color: 'color',
        effect: 'effect',
        movie: 'movie',
        musicreactive: 'musicreactive',
        playlist: 'playlist',
        off: 'off',
        rt: 'rt',
        demo: 'demo',
    },

    text: {
        color: 'Color',
        effect: 'Effect',
        movie: 'Movie',
        musicreactive: 'Music Reactive',
        playlist: 'Playlist',
        off: 'Off',
        rt: 'Real Time',
        demo: 'Demo',
    },
};

const STATE_ON_LASTMODE = 'lastMode';

const TOKEN_VERIFICATION_FAILED = `(${HTTPCodes.values.error}) Verification failed!`;

// UDP port to send realtime frames to
// const REALTIME_UDP_PORT_NUMBER = 7777;

// https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L58
const TWINKLY_MUSIC_DRIVERS_OFFICIAL = {
    'VU Meter': '00000000-0000-0000-0000-000000000001',
    'Beat Hue': '00000000-0000-0000-0000-000000000002',
    Psychedelica: '00000000-0000-0000-0000-000000000003',
    'Red Vertigo': '00000000-0000-0000-0000-000000000004',
    'Dancing Bands': '00000000-0000-0000-0000-000000000005',
    'Diamond Swirl': '00000000-0000-0000-0000-000000000006',
    'Joyful Stripes': '00000000-0000-0000-0000-000000000007',
    'Angel Fade': '00000000-0000-0000-0000-000000000008',
    Clockwork: '00000000-0000-0000-0000-000000000009',
    Sipario: '00000000-0000-0000-0000-00000000000A',
    Sunset: '00000000-0000-0000-0000-00000000000B',
    Elevator: '00000000-0000-0000-0000-00000000000C',
};

// https://github.com/jschlyter/ttls/blob/main/ttls/client.py#L73
const TWINKLY_MUSIC_DRIVERS_UNOFFICIAL = {
    'VU Meter 2': '00000000-0000-0000-0000-000001000001',
    'Beat Hue 2': '00000000-0000-0000-0000-000001000002',
    'Psychedelica 2': '00000000-0000-0000-0000-000001000003',
    Sparkle: '00000000-0000-0000-0000-000001000005',
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
        this.name = name;
        this.host = host;
        this.onDataChange = onDataChange;

        // Axios
        this.axiosInstance = axios.create({
            baseURL: this.base(),
            // Without a timeout a device that does not answer would block the polling forever
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.connected = false;
        this.firmware = '0.0.0';
        this.ledMode = '';

        this.details = {};
        this.ledEffects = {};
        this.ledMovies = {};
        this.playlist = {};

        this.resetToken();
    }

    /**
     *
     * @returns {string}
     */
    base() {
        return `http://${this.host}/xled/v1/`;
    }

    /**
     *
     * @returns {number} Anzahl LEDs
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
     * @returns {Promise<void>}
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
     *
     * @param {boolean} force
     * @returns {Promise<void>}
     */
    async ensure_token(force) {
        if (force || this.isTokenEmpty() || this.expires <= Date.now()) {
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh...`);

            try {
                await this.login();
                await this.verify();
            } catch (e) {
                if (e.message === TOKEN_VERIFICATION_FAILED) {
                    this.adapter.log.debug(
                        `[${this.name}.ensure_token] Verification failed, another Instance maybe trying to access this API...`,
                    );
                } else {
                    throw Error(e.message, { cause: e });
                }
            }
        } else {
            this.adapter.log.debug(
                `[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`,
            );
        }
    }

    /**
     * Login
     *
     * @returns {Promise<{authenticationToken: string, authenticationTokenExpiresIn: number, challengeResponse: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#login">REST-API</a>
     */
    async login() {
        this.resetToken();

        const buffer = crypto.randomBytes(32);
        const response = await this._sendRequestTwinklyCodeCheck('POST', 'login', {
            challenge: buffer.toString('base64'),
        });

        this._setToken(String(response['authentication_token']));
        this.expires = Date.now() + Number(response['authentication_token_expires_in']) * 1000;
        this.challengeResponse = String(response['challenge-response']);

        return {
            authenticationToken: String(response['authentication_token']),
            authenticationTokenExpiresIn: Number(response['authentication_token_expires_in']),
            challengeResponse: String(response['challenge-response']),
            code: Number(response.code),
        };
    }

    /**
     * Verify
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#verify">REST-API</a>
     */
    async verify() {
        if (this.challengeResponse === '') {
            throw Error('Challenge-Response nicht gefüllt!');
        }

        try {
            return await this._sendRequestTwinklyCodeCheck('POST', 'verify', {
                'challenge-response': this.challengeResponse,
            });
        } catch (e) {
            this.resetToken();
            if (e.message.includes(`(${HTTPCodes.values.error})`)) {
                throw Error(TOKEN_VERIFICATION_FAILED, { cause: e });
            } else {
                throw Error(e.message, { cause: e });
            }
        }
    }

    /**
     * Logout
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#logout">REST-API</a>
     */
    async logout() {
        let response;
        if (!this.isTokenEmpty()) {
            response = await this._post('logout', {});
            this.resetToken();
        }

        return { code: response ? response.code : HTTPCodes.values.ok };
    }

    /**
     * Device details
     *
     * @returns {Promise<{base_leds_number: Number, bytes_per_led: Number, copyright: String, device_name: String, flash_size: Number,
     *                   frame_rate: Number, fw_family: String, hardware_version: String, hw_id: String, led_profile: String,
     *                   led_type: Number, mac: String, max_movies: Number, max_supported_led: Number, measured_frame_rate: Number,
     *                   movie_capacity: Number, number_of_led: Number, production_site: Number, production_date: Number,
     *                   product_name: String, product_code: String, serial: String, uid: String, uptime: String, uuid: String,
     *                   wire_type: Number, group: {mode: String, compat_mode: Number, uid: String},
     *                   code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#device-details">REST-API</a>
     */
    async getDeviceDetails() {
        const oldDetails = this.details;
        this.details = {};

        const param = tools.versionGreaterEquals('2.8.3', this.firmware) ? '?filter=prod_infos&filter2=group' : '';
        const response = await this._sendRequestTwinklyCodeCheck('GET', `gestalt${param}`, null);

        tools.cloneObject(response, this.details);
        delete this.details['code'];

        // Check for changes after first run
        if (Object.keys(oldDetails).length > 0) {
            // Check if group mode changed
            if (this.details.group) {
                await this._checkDataChange(
                    'groupMode',
                    this.details.group.mode,
                    oldDetails.group ? oldDetails.group.mode : '',
                );
            }
        }

        return response;
    }

    /**
     * Get Device name
     *
     * @returns {Promise<{name: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-device-name">REST-API</a>
     */
    async getDeviceName() {
        return await this._get('device_name');
    }

    /**
     * Set Device name
     *
     * @param {string} name Desired device name. At most 32 characters
     * @returns {Promise<{name: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-device-name">REST-API</a>
     */
    async setDeviceName(name) {
        return await this._post('device_name', { name: name });
    }

    /**
     * Echo
     *
     * @param {string} message
     * @returns {Promise<{message: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#echo">REST-API</a>
     */
    async echo(message) {
        const response = await this._post('echo', { message: message });
        return { message: response.json.message, code: response.code };
    }

    /**
     * Get timer
     *
     * @returns {Promise<{time_now: number, time_on: number, time_off: number, tz: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-timer">REST-API</a>
     */
    async getTimer() {
        return await this._get('timer');
    }

    /**
     * Set timer
     *
     * @param {{time_now: number, time_on: number, time_off: number, tz: string} | string} data
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-timer">REST-API</a>
     */
    async setTimer(data) {
        return await this._post('timer', typeof data === 'string' ? JSON.parse(data) : data);
    }

    /**
     * Get Layout
     *
     * @returns {Promise<{aspectXY: number, aspectXZ: number, coordinates: {x: number, y: number, z: number}[], source: string, synthesized: boolean, uuid: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-layout">REST-API</a>
     */
    async getLayout() {
        return await this._get('led/layout/full');
    }

    /**
     * Upload Layout
     *
     * @param {number} aspectXY
     * @param {number} aspectXZ
     * @param {{x: number, y: number, z: number}[]} coordinates
     * @param {string} source “linear”, “2d”, “3d”
     * @param {boolean} synthesized
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-layout">REST-API</a>
     */
    async uploadLayout(aspectXY, aspectXZ, coordinates, source, synthesized) {
        return await this._post('led/layout/full', {
            aspectXY: aspectXY,
            aspectXZ: aspectXZ,
            coordinates: coordinates,
            source: source,
            synthesized: synthesized,
        });
    }

    /**
     * Get LED operation mode
     *
     * @returns {Promise<{mode: string, shop_mode: number, id: number, unique_id: string, name: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-operation-mode">REST-API</a>
     */
    async getLEDMode() {
        try {
            const response = await this._get('led/mode');

            const oldMode = this.ledMode;
            this.ledMode = response.mode;

            if (response.mode !== '' && typeof response.mode !== 'undefined') {
                await this._checkDataChange('ledMode', this.ledMode, oldMode);
            }

            return response;
        } catch (e) {
            this.ledMode = lightModes.value.off;
            throw Error(e.message, { cause: e });
        }
    }

    /**
     * Set LED operation mode
     *
     * @param {string} mode mode of operation
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-operation-mode">REST-API</a>
     */
    async setLEDMode(mode) {
        return await this._post('led/mode', { mode: mode });
    }

    /**
     * Get LED color
     *
     * @returns {Promise<{hue: number, saturation: number, value: number, red: number, green: number, blue: number, white: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-color">REST-API</a>
     */
    async getLEDColor() {
        return await this._get('led/color');
    }

    /**
     * Set LED color
     *
     * @param {number} hue Hue
     * @param {number} sat Saturation
     * @param {number} value Value
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorHSV(hue, sat, value) {
        return await this.setLEDColor({ hue: hue, saturation: sat, value: value });
    }

    /**
     * Set LED color
     *
     * @param {number} red Red
     * @param {number} green Green
     * @param {number} blue Blue
     * @param {number} [white] White
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColorRGBW(red, green, blue, white) {
        const data = { red: red, green: green, blue: blue };
        if (white >= 0 && (await this.checkDetailInfo({ name: 'led_profile', val: 'RGBW' }))) {
            data.white = white;
        }

        return await this.setLEDColor(data);
    }

    /**
     * Set LED color
     *
     * @param {{}} color colorConfig
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-color">REST-API</a>
     */
    async setLEDColor(color) {
        return await this._post('led/color', color);
    }

    /**
     * Get LED effects
     *
     * @returns {Promise<{effects_number: number, unique_ids: string[], code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-effects">REST-API</a>
     */
    async getLEDEffects() {
        return await this._get('led/effects');
    }

    /**
     * Get LED effects
     *
     * @returns {Promise<{effects: {effects_number: number, unique_ids: string[]}, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-effects">REST-API</a>
     */
    async getListOfLEDEffects() {
        this.ledEffects = {};

        const response = await this.getLEDEffects();
        for (let effect = 0; effect < response.effects_number; effect++) {
            this.ledEffects[effect] = `Effect ${effect + 1}`;
        }
    }

    /**
     * Get current LED effect
     *
     * @returns {Promise<{effect_id: number, preset_id: number, unique_id: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-led-effect">REST-API</a>
     */
    async getCurrentLEDEffect() {
        return await this._get('led/effects/current');
    }

    /**
     * Set current LED effect
     *
     * @param {number} effectId
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-led-effect">REST-API</a>
     */
    async setCurrentLEDEffect(effectId) {
        return await this._post('led/effects/current', { effect_id: effectId });
    }

    /**
     * Get LED config
     *
     * @returns {Promise<{strings: {first_led_id: number, length: number}[], code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-config">REST-API</a>
     */
    async getLEDConfig() {
        return await this._get('led/config');
    }

    /**
     * Set LED config
     *
     * @param {{first_led_id: number, length: number}[]} strings
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-config">REST-API</a>
     */
    async setLEDConfig(strings) {
        return await this._post('led/config', { strings: strings });
    }

    /**
     * Upload movie
     *
     * @param {{r: number, g: number, b: number}[][]} frames
     * @param {number} delay between frames in ms
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#upload-full-movie">REST-API</a>
     */
    async uploadMovie(frames, delay) {
        const movieFormat = this._convertMovieFormat(frames);

        // Switch off lights
        let response = await this.setLEDMode(lightModes.value.off);
        // Upload movie
        if (response.code === HTTPCodes.values.ok) {
            response = await this._post('led/movie/full', movieFormat.bufferArray, {
                'Content-Type': 'application/octet-stream',
            });
        }
        // Update configuration
        if (response.code === HTTPCodes.values.ok) {
            response = await this.setLEDMovieConfig(delay, movieFormat.lightsCount, movieFormat.frameCount);
        }
        // Switch on lights
        if (response.code === HTTPCodes.values.ok) {
            response = await this.setLEDMode(lightModes.value.movie);
        }

        return { code: response.code };
    }

    /**
     *
     * @param {{r: number, g: number, b: number}[][]} frames
     * @returns {{lightsCount, frameCount: number, bufferArray: ArrayBuffer}}
     */
    _convertMovieFormat(frames) {
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
            bufferArray: new ArrayBuffer(fullArray.length),
            frameCount: frames.length,
            lightsCount: lightsCount,
        };

        const longInt8View = new Uint8Array(output.bufferArray);
        for (let x = 0; x < fullArray.length; x++) {
            longInt8View[x] = fullArray[x];
        }

        return output;
    }

    /**
     * Generate a full frame of a solid color
     *
     * @param {{r: number, g: number, b: number} | string} color RGB-Object or Hex-String
     * @returns {{r: number, g: number, b: number}[]}
     */
    generateFrame(color) {
        if (typeof color === 'string') {
            color = tools.hexToRgb(color);
        }

        const frame = [];
        for (let x = 0; x < this.details.number_of_led; x++) {
            frame.push({ r: color.r, g: color.g, b: color.b });
        }

        return frame;
    }

    /**
     * Generate a frames of a solid color
     *
     * @param {{r: number, g: number, b: number} | string | {r: number, g: number, b: number}[] | string[]} colors RGB-Object or Hex-String
     * @returns {{r: number, g: number, b: number}[]}
     */
    generateFrames(colors) {
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
     *
     * @returns {Promise<{frame_delay: Number, leds_number: Number, loop_type: Number, frames_number: Number,
     *                   sync?: {mode: String, slave_id: String, master_id: String, compat_mode: Number},
     *                   mic?: {filters: {}[], brightness_depth: Number, hue_depth: Number, value_depth: Number, saturation_depth: Number}, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-led-movie-config">REST-API</a>
     */
    async getLEDMovieConfig() {
        return await this._get('led/movie/config');
    }

    /**
     * Set LED movie config
     *
     * @param {number} delay delay between frames in ms
     * @param {number} leds Number of leds in the frame
     * @param {number} frames Number of frames
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-led-movie-config">REST-API</a>
     */
    async setLEDMovieConfig(delay, leds, frames) {
        return await this._post('led/movie/config', { frame_delay: delay, leds_number: leds, frames_number: frames });
    }

    /**
     * Get brightness
     *
     * @returns {Promise<{value: number, mode: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-brightness">REST-API</a>
     */
    async getBrightness() {
        return await this._get('led/out/brightness');
    }

    /**
     * Set brightness absolute
     *
     * @param {number} brightness brightness level in range of 0..100
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessAbsolute(brightness) {
        return await this.setBrightness({ value: brightness, mode: 'enabled', type: 'A' });
    }

    /**
     * Set brightness relative
     *
     * @param {number} brightness brightness level in range of -100..100
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessRelative(brightness) {
        return await this.setBrightness({ value: brightness, mode: 'enabled', type: 'R' });
    }

    /**
     * Set brightness disabled
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightnessDisabled() {
        return await this.setBrightness({ value: 0, mode: 'disabled', type: 'A' });
    }

    /**
     * Set brightness
     *
     * @param {{value: number, mode: 'enabled'|'disabled', type: 'A'|'R'}} data
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-brightness">REST-API</a>
     */
    async setBrightness(data) {
        return await this._post('led/out/brightness', data);
    }

    /**
     * Get saturation
     *
     * @returns {Promise<{value: number, mode: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-saturation">REST-API</a>
     */
    async getSaturation() {
        return await this._get('led/out/saturation');
    }

    /**
     * Set saturation absolute
     *
     * @param {number} saturation saturation level in range of 0..100
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationAbsolute(saturation) {
        return await this.setSaturation({ value: saturation, mode: 'enabled', type: 'A' });
    }

    /**
     * Set saturation relative
     *
     * @param {number} saturation saturation level in range of -100..100
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationRelative(saturation) {
        return await this.setSaturation({ value: saturation, mode: 'enabled', type: 'R' });
    }

    /**
     * Set saturation disabled
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturationDisabled() {
        return await this.setSaturation({ value: 0, mode: 'disabled', type: 'A' });
    }

    /**
     * Set saturation relative
     *
     * @param {{value: number, mode: 'enabled'|'disabled', type: 'A'|'R'}} data
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-saturation">REST-API</a>
     */
    async setSaturation(data) {
        return await this._post('led/out/saturation', data);
    }

    /**
     * Reset LED - Restart the current animation
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset-led">REST-API</a>
     */
    async resetLED() {
        return await this._get('reset');
    }

    /**
     * Reset LED (Reboot?)
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#reset2-led">REST-API</a>
     */
    async reset2LED() {
        return await this._get('reset2');
    }

    /**
     * Send Realtime Frame
     *
     * @param {{r: number, g: number, b: number}[]} frame
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#send-realtime-frame">REST-API</a>
     * @see <a href="https://github.com/scrool/xled/blob/develop/xled/control.py#L890-L906">Code xled</a>
     */
    async sendRealtimeFrame(frame) {
        return await this._post('led/rt/frame', frame, { 'Content-Type': 'application/octet-stream' });
    }

    /**
     * Send Realtime Frame Socket
     *
     * @returns {Promise<{code}>}
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
     *
     * @returns {Promise<{version: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-firmware-version">REST-API</a>
     */
    async getFirmwareVersion() {
        const response = await this._sendRequestTwinklyCodeCheck('GET', 'fw/version', null);

        const oldFirmware = this.firmware;
        this.firmware = response.version;
        await this._checkDataChange('firmware', this.firmware, oldFirmware);

        return response;
    }

    isFirmwareEmpty() {
        return this.firmware === '' || this.firmware === '0.0.0';
    }

    /**
     * Get Status
     *
     * @returns {Promise<{status: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-status">REST-API</a>
     */
    async getStatus() {
        return await this._get('status');
    }

    /**
     * Get list of movies
     *
     * @returns {Promise<{movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
     *                   available_frames: Number, max_capacity: Number, code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-list-of-movies">REST-API</a>
     */
    async getListOfMovies() {
        this.ledMovies = {};

        try {
            const response = await this._get('movies');

            // Liste füllen
            if (response.movies) {
                for (const movie of response.movies) {
                    this.ledMovies[movie.id] = movie.name;
                }
            }

            return response;
        } catch (e) {
            // Wenn kein Movie aktiv ist, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return { movies: [], available_frames: 0, max_capacity: 0, code: HTTPCodes.values.ok };
            }

            throw Error(e.message, { cause: e });
        }
    }

    // Delete movies

    // Create new movie entry

    // Upload new movie to list of movies

    /**
     * Get current movie
     *
     * @returns {Promise<{id: number, unique_id: string, name: string, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-movie">REST-API</a>
     */
    async getCurrentMovie() {
        try {
            return await this._get('movies/current');
        } catch (e) {
            // Wenn kein Movie aktiv ist, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return { id: -1, unique_id: '', name: '', code: HTTPCodes.values.ok };
            }

            throw Error(e.message, { cause: e });
        }
    }

    /**
     * Set current movie
     *
     * @param {number} movieId
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-movie">REST-API</a>
     */
    async setCurrentMovie(movieId) {
        return await this._post('movies/current', { id: movieId });
    }

    // Initiate WiFi network scan

    // Get results of WiFi network scan

    /**
     * Get network status
     *
     * @returns {Promise<{mode: Number,
     *                   station: {ip: String, gw: String, mask: String, rssi: Number, ssid: String, status: String},
     *                   ap: {enc: Number, ip: String, channel: Number, max_connections: Number, password_changed: Number, ssid: String, ssid_hidden: Number},
     *                   code: Number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-network-status">REST-API</a>
     */
    async getNetworkStatus() {
        return await this._get('network/status');
    }

    /**
     * Set network status
     *
     * @param data
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatusAP(data) {
        return await this.setNetworkStatus({ mode: 2, ap: data });
    }

    /**
     * Set network status
     *
     * @param data
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatusStation(data) {
        return await this.setNetworkStatus({ mode: 1, station: data });
    }

    /**
     * Set network status
     *
     * @param {{mode: Number, station?: {ip: String, gw: String, mask: String, rssi: Number, ssid: String, status: String},
     *          ap?: {enc: Number, ip: String, channel: Number, max_connections: Number, password_changed: Number, ssid: String, ssid_hidden: Number}}} data
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-network-status">REST-API</a>
     */
    async setNetworkStatus(data) {
        return await this._post('network/status', data);
    }

    /**
     * Get MQTT configuration
     *
     * @returns {Promise<{broker_host: string, broker_port: number, client_id: string, user: string, keep_alive_interval: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mqtt-configuration">REST-API</a>
     */
    async getMqttConfiguration() {
        return await this._get('mqtt/config');
    }

    /**
     * Set MQTT configuration
     *
     * @param {{broker_host: string, broker_port: number, client_id: string, user: string, keep_alive_interval: number, encryption_key_set: boolean} | string} data
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-mqtt-configuration">REST-API</a>
     */
    async setMqttConfiguration(data) {
        return await this._post('mqtt/config', typeof data === 'string' ? JSON.parse(data) : data);
    }

    /**
     * Get playlist
     *
     * @returns {Promise<{unique_id: string, name: string, entries: {id: number, handle: number, name: string, unique_id: string, duration: number}[], code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-playlist">REST-API</a>
     */
    async getPlaylist() {
        this.playlist = {};

        const response = await this._get('playlist');

        // Liste füllen
        if (response.entries) {
            for (const entry of response.entries) {
                this.playlist[entry.id] = entry.name;
            }
        }

        return response;
    }

    /**
     * Create playlist
     *
     * @param {{duration: number, unique_id: string}[]} entries
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#create-playlist">REST-API</a>
     */
    async createPlaylist(entries) {
        return await this._post('playlist', entries);
    }

    /**
     * Delete playlist
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#delete-playlist">REST-API</a>
     */
    async deletePlaylist() {
        return await this._delete('playlist');
    }

    /**
     * Get current playlist entry
     *
     * @returns {Promise<{id: number, unique_id: string, name: string, duration: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-playlist-entry">REST-API</a>
     */
    async getCurrentPlaylistEntry() {
        try {
            return await this._get('playlist/current');
        } catch (e) {
            // Wenn keine Playlist existiert, kommt hier eine Exception
            // HTTP Error (204) No Content: {"code":1102}
            if (e.message && (e.message.includes('ECONNRESET') || e.message.includes('(204)'))) {
                return { id: -1, unique_id: '', name: '', duration: 0, code: HTTPCodes.values.ok };
            }

            throw Error(e.message, { cause: e });
        }
    }

    /**
     * Set current playlist entry
     *
     * @param {number} playlistId
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#set-current-playlist-entry">REST-API</a>
     */
    async setCurrentPlaylistEntry(playlistId) {
        return await this._post('playlist/current', { id: playlistId });
    }

    /**
     * Set mic configuration
     *
     * @returns {Promise<{filters: {}, silence_threshold: 0, active_range: number, brightness_depth: number,
     *                   hue_depth: number, value: depth, saturation_depth: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mic-config">REST-API</a>
     */
    async getMicConfig() {
        return await this._get('mic/config');
    }

    /**
     * Get mic sample
     *
     * @returns {Promise<{sampled_value: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-mic-sample">REST-API</a>
     */
    async getMicSample() {
        return await this._get('mic/sample');
    }

    /**
     * Get summary
     *
     * @returns {Promise<{code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-summary">REST-API</a>
     */
    async getSummary() {
        return await this._get('summary');
    }

    /**
     * Get music drivers
     *
     * @returns {Promise<{drivers_number: number, unique_ids: string[], code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-music-drivers">REST-API</a>
     */
    async getMusicDrivers() {
        return await this._get('music/drivers');
    }

    /**
     * Get current music driver
     *
     * @returns {Promise<{handle: number, code: number}>}
     */
    async getCurrentMusicDriver() {
        // TODO: Inhalte prüfen
        return await this._get('music/drivers/current');
    }

    /**
     * Set current music driver
     *
     * @param {string} driverName
     * @returns {Promise<{code: number}>}
     */
    async setCurrentMusicDriver(driverName) {
        const uniqueId = this._getMusicDriverIdByName(driverName);
        if (uniqueId === '') {
            throw Error(`${driverName} is an invalid music driver!`);
        }

        const currentDriver = await this.getCurrentMusicDriver();
        if (currentDriver.handle === -1) {
            await this.setNextMusicDriver();
        }

        return await this._post('music/drivers/current', { unique_id: uniqueId });
    }

    /**
     * Get Music driver by name
     *
     * @param {string} name
     * @returns {string}
     */
    _getMusicDriverIdByName(name) {
        if (Object.keys(TWINKLY_MUSIC_DRIVERS_OFFICIAL).includes(name)) {
            return TWINKLY_MUSIC_DRIVERS_OFFICIAL[name];
        } else if (Object.keys(TWINKLY_MUSIC_DRIVERS_UNOFFICIAL).includes(name)) {
            this.adapter.log.info(`Music driver ${name} is defined, but is not officially supported`);
            return TWINKLY_MUSIC_DRIVERS_UNOFFICIAL[name];
        }
        return '';
    }

    /**
     * Set next music driver
     *
     * @returns {Promise<{code: number}>}
     */
    async setNextMusicDriver() {
        return await this._post('music/drivers/current', { action: 'next' });
    }

    /**
     * Set previous music driver
     *
     * @returns {Promise<{code: number}>}
     */
    async setPreviousMusicDriver() {
        return await this._post('music/drivers/current', { action: 'prev' });
    }

    /**
     * Get music driver set
     *
     * @returns {Promise<{current: number, count: number, driversets: {id: number, count: number, unique_ids: string}[], code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-music-drivers-sets">REST-API</a>
     */
    async getMusicDriversSets() {
        return await this._get('music/drivers/sets');
    }

    /**
     * Get current music driver set
     *
     * @returns {Promise<{driverset_id: number, code: number}>}
     * @see <a href="https://xled-docs.readthedocs.io/en/latest/rest_api.html#get-current-music-driverset">REST-API</a>
     */
    async getCurrentMusicDriversSet() {
        return await this._get('music/drivers/sets/current');
    }

    /**
     * Enable music
     *
     * @param {boolean} enable
     * @returns {Promise<{code: number}>}
     */
    async setMusicOn(enable) {
        return await this._post('music/enabled', { enabled: enable ? 1 : 0 });
    }

    /**
     * Set Token
     *
     * @param token
     */
    _setToken(token) {
        this.token = token;
        this.axiosInstance.defaults.headers.common['X-Auth-Token'] = token;
    }

    /**
     * Reset Token Data
     *
     */
    resetToken() {
        this._setToken('');
        this.expires = 0;
        this.challengeResponse = '';
    }

    /**
     * Check if Token empty
     *
     * @returns {boolean}
     */
    isTokenEmpty() {
        return this.token === '';
    }

    /**
     * @param {{name: string, val: any, type?: 'eq' | 'ne'}} filter
     * @returns {Promise<boolean>}
     */
    async checkDetailInfo(filter) {
        if (filter === undefined || filter.name === undefined || filter.val === undefined) {
            return false;
        }

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
            case 'eq':
                return details === filter.val;
            case 'ne':
                return details !== filter.val;
            default:
                return false;
        }
    }

    /**
     * Check if values are different and execute dataChange event if available
     *
     * @param {string} type
     * @param {any} value
     * @param {any} oldValue
     * @returns {Promise<void>}
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
     * @returns {Promise<any>}
     */
    async _get(path) {
        return this._sendRequestTwinkly('GET', path, null);
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @returns {Promise<any>}
     */
    async _post(path, data, headers = {}) {
        return this._sendRequestTwinkly('POST', path, data, headers);
    }

    /**
     * @param {string} path
     * @param {{}} headers
     * @returns {Promise<any>}
     */
    async _delete(path, headers = {}) {
        return this._sendRequestTwinkly('DELETE', path, null, headers);
    }

    /**
     * @param {axios.Method} mode
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @returns {Promise<any>}
     */
    async _sendRequestTwinkly(mode, path, data, headers = {}) {
        await this.ensure_token(false);

        if (this.isTokenEmpty()) {
            return { code: HTTPCodes.values.errorLogin };
        }

        try {
            // Ausführen...
            return await this._sendRequestTwinklyCodeCheck(mode, path, data, headers);
        } catch (e) {
            // Bei "Invalid Token" wird es erneut versucht!
            if (e.message !== HTTPCodes.INVALID_TOKEN) {
                throw Error(e.message, { cause: e });
            }

            // Token erneuern
            await this.ensure_token(true);

            if (this.isTokenEmpty()) {
                return { code: HTTPCodes.values.errorLogin };
            }

            try {
                // Erneut ausführen...
                return await this._sendRequestTwinklyCodeCheck(mode, path, data, headers);
            } catch (e) {
                // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                if (e.message === HTTPCodes.INVALID_TOKEN) {
                    this.resetToken();
                }

                throw Error(e.message, { cause: e });
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
     * @returns {Promise<any>}
     */
    async _sendRequestTwinklyCodeCheck(mode, path, data, headers = {}) {
        if (!this.connected) {
            return { code: HTTPCodes.values.errorConnect };
        }

        let response;
        try {
            response = await this.request(mode, path, data, headers);
        } catch (e) {
            if (e.message && String(e.message).includes(HTTPCodes.INVALID_TOKEN)) {
                throw Error(HTTPCodes.INVALID_TOKEN, { cause: e });
            } else {
                throw Error(e.message, { cause: e });
            }
        }

        this._checkResponseTwinklyCode(mode, path, response);

        return response;
    }

    /**
     * Check Twinkly code in response
     *
     * @param {axios.Method} mode
     * @param {string} path
     * @param {any} response
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
     * Ping
     *
     * @param {boolean} usePing
     * @returns {Promise<boolean>}
     */
    async checkConnection(usePing) {
        let result = false;

        if (usePing) {
            try {
                const response = await ping.probe(this.host, { log: this.adapter.log.debug });
                this.adapter.log.debug(
                    `[${this.name}.ping] Ping result for ${response.host}: ${response.alive} in ${response.ms === null ? '-' : response.ms}ms`,
                );
                result = response.alive;
                if (response.denied && !this.pingDeniedLogged) {
                    this.pingDeniedLogged = true;
                    this.adapter.log.warn(
                        `[${this.name}.ping] This host is not allowed to send ICMP packets (${response.error}), the device is reported as offline. Allow ping for the ioBroker user (e.g. setcap cap_net_raw+ep $(which ping)) or disable "Use ping for reachability" in the instance settings.`,
                    );
                }
            } catch (e) {
                this.adapter.log.error(`[${this.name}.ping]: ${e}`);
            }
        } else {
            try {
                const response = await this.getDeviceDetails();
                result = response.code === HTTPCodes.values.ok;
            } catch (e) {
                this.adapter.log.silly(`[${this.name}.ping]: ${e}`);
            }
        }

        this.connected = result;
        return result;
    }

    /**
     @param {axios.Method} method
     * @param {string} path
     * @param {any} body
     * @param {{}} headers
     * @returns {Promise<any>}
     */
    async request(method, path, body, headers = {}) {
        this.adapter.log.debug(
            `[${this.name}.request.${method}] path="${path}", body="${JSON.stringify(body)}", headers="${JSON.stringify(headers)}"`,
        );

        let response;
        try {
            response = await this.axiosInstance.request({ url: path, method: method, headers: headers, data: body });
        } catch (e) {
            // Logging
            let message;
            if (e instanceof axios.AxiosError) {
                const json = e.toJSON();
                message = `code="${e.code}", status=${json.status}, config="${JSON.stringify(json.config)}", stack="${json.stack}"`;
            } else {
                message = `stack="${e.stack}"`;
            }

            this.adapter.log.debug(`[${this.name}.request.${method}] ${e.name}: "${e.message}", ${message}`);

            // Error handling
            if (e instanceof axios.AxiosError && e.response && e.response.status !== 200) {
                throw Error(
                    `HTTP Error (${e.response.status}) ${e.response.statusText}${e.response.data ? `: ${JSON.stringify(e.response.data)}` : ''}`,
                    { cause: e },
                );
            } else {
                throw Error(e.message ? e.message : e, { cause: e });
            }
        }

        if (typeof response === 'undefined') {
            throw Error('No response received');
        }

        if (response.status !== 200) {
            throw Error(
                `HTTP Error (${response.status}) ${response.statusText}${response.data ? `: ${JSON.stringify(response.data)}` : ''}`,
            );
        } else {
            if (response.data) {
                this.adapter.log.debug(`[${this.name}.request.${method}.response] ${JSON.stringify(response.data)}`);
            }
            return response.data;
        }
    }
}

module.exports = {
    Twinkly,
    HTTPCodes,
    lightModes,
    STATE_ON_LASTMODE,
};
