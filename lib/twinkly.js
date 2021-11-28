const request = require('./request');

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

class Connection {

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
            this.details = await this.getDetails();
    }

    /**
     * @param {string} path
     * @param {any} data
     * @param {{}} headers
     * @return {Promise<{}>}
     */
    async _post(path, data, headers = {}) {
        if (!headers || Object.keys(headers).length === 0) headers = this.headers;

        this.adapter.log.debug(`[${this.name}._post] <${path}>, ${JSON.stringify(data)}, ${JSON.stringify(headers)}`);

        let result, resultError;
        await this.ensure_token(false).catch(error => {resultError = error;});

        if (!resultError) {
            // POST ausführen...
            await this._doPOST(path, data, headers).then(response => {result = response;})
                .catch(error => {resultError = error;});

            if (resultError && resultError === HTTPCodes.INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true)
                    .catch(error => {resultError = error;});

                // POST erneut ausführen...
                if (!resultError) {
                    await this._doPOST(path, data, headers)
                        .then(response => {result = response;})
                        .catch(error => {resultError = error;});

                    // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                    if (resultError && resultError === HTTPCodes.INVALID_TOKEN)
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
            this.sendPostHTTP(this.base() + '/' + path, data, headers)
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = this.translateTwinklyCode(this.name, 'POST', path, response['code']);

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
        this.adapter.log.debug(`[${this.name}._get] <${path}>`);

        let result, resultError;
        await this.ensure_token(false)
            .catch(error => {resultError = error;});

        if (!resultError) {
            // GET ausführen...
            await this._doGET(path).then(response => {result = response;})
                .catch(error => {resultError = error;});

            if (resultError && resultError === HTTPCodes.INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true).catch(error => {resultError = error;});

                // GET erneut ausführen...
                if (!resultError) {
                    await this._doGET(path).then(response => {result = response;})
                        .catch(error => {resultError = error;});

                    // Wenn wieder fehlerhaft, dann Pech gehabt. Token wird gelöscht...
                    if (resultError && resultError === HTTPCodes.INVALID_TOKEN)
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
            this.sendGetHTTP(this.base() + '/' + path, this.headers)
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = this.translateTwinklyCode(this.name, 'GET', path, response['code']);

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
        let resultError;
        if (force || this.token === '' || this.expires <= Date.now()) {
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh`);

            await this.login().catch(error => {resultError = error;});
            if (!resultError)
                await this.verify().catch(error => {resultError = error;});

        } else
            this.adapter.log.debug(`[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`);

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(this.token);
        });
    }

    /** Login
     * @return {Promise<{authentication_token: String, authentication_token_expires_in: Number, 'challenge-response': String, code: Number}>}
     */
    async login() {
        const TWINKLY_OBJ = this;

        this.token = '';
        return new Promise((resolve, reject) => {
            this.sendPostHTTP(TWINKLY_OBJ.base() + '/login', {'challenge': 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='})
                .then(response => {
                    try {
                        let checkTwinklyCode;
                        if (response && typeof response === 'object')
                            checkTwinklyCode = this.translateTwinklyCode(TWINKLY_OBJ.name, 'POST', 'login', response['code']);

                        if (checkTwinklyCode)
                            reject(checkTwinklyCode);
                        else {
                            TWINKLY_OBJ.token                   = response['authentication_token'];
                            TWINKLY_OBJ.headers['X-Auth-Token'] = TWINKLY_OBJ.token;
                            TWINKLY_OBJ.expires                 = Date.now() + (response['authentication_token_expires_in'] * 1000);
                            TWINKLY_OBJ.challengeResponse       = response['challenge-response'];

                            resolve({
                                'authentication_token'            : response['authentication_token'],
                                'authentication_token_expires_in' : response['authentication_token_expires_in'],
                                'challenge-response'              : response['challenge-response'],
                                'code'                            : response['code']});
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

    /** Verify
     * @return {Promise<{code: Number}>}
     */
    async verify() {
        let result, resultError;
        if (this.challengeResponse === '')
            resultError = 'Challenge-Response nicht gefüllt!';
        else {
            const response = await this._post('verify', {'challenge-response': this.challengeResponse})
                .catch(error => {resultError = error;});
            result = {code: response['code']};
        }

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve(result);
        });
    }

    /** Logout
     * @return {Promise<{code: Number}>}
     */
    async logout() {
        let resultError, response;
        if (this.token !== '')
            response = await this._post('logout', {})
                .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else {
                this.token = '';
                resolve({code: response ? response['code'] : HTTPCodes.values.ok});
            }
        });
    }

    /** Device details
     * @return {Promise<{details: {product_name: String, product_version: String, hardware_version: String, flash_size: Number, led_type: Number,
     *                             product_code: String, device_name: String, uptime: String, hw_id: String, mac: String,
     *                             max_supported_led: Number, number_of_led: Number, led_profile: String, frame_rate: Number,
     *                             movie_capacity: Number, copyright: String, wire_type: Number, measured_frame_rate: Number, uuid: String,
     *                             fw_family: String, bytes_per_led: Number, base_leds_number: Number, rssi: Number, led_version: String},
     *                   code: Number}>}
     */
    async getDetails() {
        let resultError;
        const response = await this._get('gestalt')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({
                    details: this.getObjectByArray('gestalt', response, [
                        'product_name',      'product_version',  'hardware_version',    'flash_size',     'led_type',
                        'product_code',      'device_name',      'uptime',              'hw_id',          'mac',
                        'number_of_led',     'led_profile',      'frame_rate',          'movie_capacity', 'copyright',
                        'max_supported_led', 'wire_type',        'measured_frame_rate', 'uuid',           'fw_family',
                        'bytes_per_led',     'base_leds_number', 'rssi',                'led_version']),
                    code: response['code']});
        });
    }

    /** Get Device name
     * @return {Promise<{name: {name: String}, code: Number}>}
     */
    async getDeviceName() {
        let resultError;
        const response = await this._get('device_name').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({name: this.getObjectByArray('device_name', response, ['name']), code: response['code']});
        });
    }

    /** Set Device name
     * @param {String} name Desired device name. At most 32 characters
     * @return {Promise<{name: String, code: Number}>}
     */
    async setDeviceName(name) {
        let resultError;
        const response = await this._post('device_name', {'name': name})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({name: response['name'], code: response['code']});
        });
    }

    /** Get timer
     * @return {Promise<{timer: {time_now: Number, time_on: Number, time_off: Number}, code: Number}>}
     */
    async getTimer() {
        let resultError;
        const response = await this._get('timer')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({timer: this.getObjectByArray('timer', response, ['time_now', 'time_on', 'time_off', 'tz']), code: response['code']});
        });
    }

    /** Set timer
     * @param {{time_now: Number, time_on: Number, time_off: Number} | String} data
     * @return {Promise<{code: Number}>}
     */
    async setTimer(data) {
        let result, resultError;
        try {
            data = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            resultError = e.message;
        }

        if (!resultError)
            result = await this._post('timer', data)
                .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: result['code']});
        });
    }

    // Get Layout

    // Upload Layout

    /** Get LED operation mode
     * @return {Promise<{mode: {mode: String, shop_mode: Number, id: Number, unique_id: String, name: String}, code: Number}>}
     */
    async getLEDMode() {
        let resultError;
        const response = await this._get('led/mode').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({mode: this.getObjectByArray('led/mode', response,
                    ['id', 'color_config', 'mode', 'movie', 'name', 'shop_mode', 'unique_id']),
                code: response['code']});
        });
    }

    /** Set LED operation mode
     * @param {String} mode mode of operation
     * @return {Promise<{code: Number}>}
     */
    async setLEDMode(mode) {
        let resultError;
        const response = await this._post('led/mode', {'mode': mode}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    // Get LED effects

    // Get current LED effect

    // Set current LED effect

    // Get LED config

    // Set LED config

    /** Upload full movie
     * @param {{}} movie
     * @return {Promise<{code: Number}>}
     */
    async uploadFullMovie(movie) {
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

    /** Get LED movie config
     * @return {Promise<{movie: {}, code: Number}>}
     */
    async getMovieConfig() {
        let resultError;
        const response = await this._get('led/movie/config')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({movie: this.getObjectByArray('led/movie/config', response), code: response['code']});
        });
    }

    /** Set LED movie config
     * @param {Number} frame_delay
     * @param {Number} leds_number seems to be total number of LEDs to use
     * @param {Number} frames_number
     * @return {Promise<{code: Number}>}
     */
    async setMovieConfig(frame_delay, leds_number, frames_number) {
        let resultError;
        const response = await this._post('led/movie/config', {frame_delay : frame_delay,
            leds_number   : leds_number,
            frames_number : frames_number}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Get brightness
     * @return {Promise<{bri: {value: Number, mode: String}, code: Number}>}
     */
    async getBrightness() {
        let resultError;
        const response = await this._get('led/out/brightness').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({bri: this.getObjectByArray('led/out/brightness', response, ['value', 'mode']), code: response['code']});
        });
    }

    /** Set brightness absolute
     * @param {Number} brightness brightness level in range of 0..100
     * @return {Promise<{code: Number}>}
     */
    async setBrightnessAbsolute(brightness) {
        let resultError;
        const response = await this._post('led/out/brightness', {value: brightness, mode: 'enabled', type: 'A'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Set brightness relative
     * @param {Number} brightness brightness level in range of -100..100
     * @return {Promise<{code: Number}>}
     */
    async setBrightnessRelative(brightness) {
        let resultError;
        const response = await this._post('led/out/brightness', {value: brightness, mode: 'enabled', type: 'R'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Set brightness disabled
     * @return {Promise<{code: Number}>}
     */
    async setBrightnessDisabled() {
        let resultError;
        const response = await this._post('led/out/brightness', {value: 0, mode: 'disabled', type: 'A'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Get saturation
     * @return {Promise<{sat: {value: Number, mode: String}, code: Number}>}
     */
    async getSaturation() {
        let resultError;
        const response = await this._get('led/out/saturation').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({sat: this.getObjectByArray('led/out/saturation', response, ['value', 'mode']), code: response['code']});
        });
    }

    /** Set saturation absolute
     * @param {Number} saturation saturation level in range of 0..100
     * @return {Promise<{code: Number}>}
     */
    async setSaturationAbsolute(saturation) {
        let resultError;
        const response = await this._post('led/out/saturation', {value: saturation, mode: 'enabled', type: 'A'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Set saturation relative
     * @param {Number} saturation saturation level in range of -100..100
     * @return {Promise<{code: Number}>}
     */
    async setSaturationRelative(saturation) {
        let resultError;
        const response = await this._post('led/out/saturation', {value: saturation, mode: 'enabled', type: 'R'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Set saturation disabled
     * @return {Promise<{code: Number}>}
     */
    async setSaturationDisabled() {
        let resultError;
        const response = await this._post('led/out/saturation', {value: 0, mode: 'disabled', type: 'A'})
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Reset
     * @return {Promise<{code: Number}>}
     */
    async reset() {
        let resultError;
        const response = await this._get('reset')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Get firmware version
     * @return {Promise<{version: {version: String}, code: Number}>}
     */
    async getFirmwareVersion() {
        let resultError;
        const response = await this._get('fw/version')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({version: this.getObjectByArray('fw/version', response, ['version']), code: response['code']});
        });
    }

    /** Get list of movies
     * @return {Promise<{movies: {movies: {id: Number, unique_id: String, name: String, descriptor_type: String, leds_per_frame: Number, frames_number: Number, fps: Number}[],
     *                            available_frames: Number, max_capacity: Number}, code: Number}>}
     */
    async getMovies() {
        let resultError;
        const response = await this._get('movies').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({movies: this.getObjectByArray('movies', response,
                    ['movies', 'available_frames', 'max_capacity']),
                code: response['code']});
        });
    }

    // Delete movies

    // Create new movie entry

    // Upload new movie to list of movies

    /** Get current movie
     * @return {Promise<{movie: {id: Number, unique_id: String, name: String}, code: Number}>}
     */
    async getCurrentMovie() {
        let resultError;
        const response = await this._get('movies/current').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({movie: this.getObjectByArray('movies/current', response,
                    ['id', 'unique_id', 'name']),
                code: response['code']});
        });
    }

    /** Set current movie
     * @param {Number} movieId
     * @return {Promise<{code: Number}>}
     */
    async setCurrentMovie(movieId) {
        let resultError;
        const response = await this._post('movies/current', {'id': movieId}).catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: response['code']});
        });
    }

    /** Get network status
     * @return {Promise<{status: {}, code: Number}>}
     */
    async getNetworkStatus() {
        let resultError;
        const response = await this._get('network/status')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({status: this.getObjectByArray('network/status', response, ['mode', 'station', 'ap']), code: response['code']});
        });
    }

    /** Set network status
     *
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
     */
    async getMqtt() {
        let resultError;
        const response = await this._get('mqtt/config')
            .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({
                    mqtt: this.getObjectByArray('mqtt/config', response, [
                        'broker_host', 'broker_port', 'client_id', 'user', 'keep_alive_interval', 'encryption_key_set']), code: response['code']});
        });
    }

    /** Set MQTT configuration
     * @param {{broker_host: String, broker_port: Number, client_id: String, user: String, keep_alive_interval : Number, encryption_key_set: Boolean} | String} data
     * @return {Promise<{code: Number}>}
     */
    async setMqtt(data) {
        let result, resultError;
        try {
            data = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            resultError = e;
        }

        if (!resultError)
            result = await this._post('mqtt/config', data)
                .catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({code: result['code']});
        });
    }

    // Get playlist

    // Create playlist

    // Delete playlist

    // Get current playlist entry

    // Set current playlist entry


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
     * @param {string} url
     * @param {{}} headers
     * @return {Promise<string | {}>}
     */
    sendGetHTTP(url, headers = {}) {
        const oThis = this;
        return new Promise((resolve, reject) => {
            request.sendGetHTTP(url, headers)
                .then(response => {
                    if (response) oThis.adapter.log.debug('[sendGetHTTP] ' + JSON.stringify(response));
                    resolve(response);
                })
                .catch(error => {
                    if (error && typeof error === 'string' && String(error).includes(HTTPCodes.INVALID_TOKEN))
                        reject(HTTPCodes.INVALID_TOKEN);
                    else
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
    sendPostHTTP(url, body, headers = {}) {
        const oThis = this;
        return new Promise((resolve, reject) => {
            request.sendPostHTTP(url, body, headers)
                .then(response => {
                    if (response) oThis.adapter.log.debug('[sendPostHTTP] ' + JSON.stringify(response));
                    resolve(response);
                })
                .catch(error => {
                    if (error && typeof error === 'string' && String(error).includes(HTTPCodes.INVALID_TOKEN))
                        reject(HTTPCodes.INVALID_TOKEN);
                    else
                        reject(error);
                });
        });
    }
}

module.exports = {
    Connection,
    HTTPCodes,
    lightModes
};