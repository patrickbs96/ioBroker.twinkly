const axios = require('axios');

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
     * @param {Logger} log
     * @param {string} name
     * @param {string} host
     */
    constructor(log, name, host) {
        this.log     = log;
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
        if (!headers || Object.keys(headers).length === 0) headers = this.headers;

        this.log.debug(`[${this.name}._post] <${path}>, ${JSON.stringify(data)}, ${JSON.stringify(headers)}`);

        let result, resultError;
        await this.ensure_token(false).catch(error => {resultError = error;});

        if (!resultError) {
            // POST ausführen...
            await this._doPOST(path, data, headers).then(response => {result = response;}).catch(error => {resultError = error;});

            if (resultError && resultError === HTTPCodes.INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true).catch(error => {resultError = error;});

                // POST erneut ausführen...
                if (!resultError) {
                    await this._doPOST(path, data, headers).then(response => {result = response;}).catch(error => {resultError = error;});

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
        this.log.debug(`[${this.name}._get] <${path}>`);

        let result, resultError;
        await this.ensure_token(false).catch(error => {resultError = error;});

        if (!resultError) {
            // GET ausführen...
            await this._doGET(path).then(response => {result = response;}).catch(error => {resultError = error;});

            if (resultError && resultError === HTTPCodes.INVALID_TOKEN) {
                resultError = null;

                // Token erneuern
                await this.ensure_token(true).catch(error => {resultError = error;});

                // GET erneut ausführen...
                if (!resultError) {
                    await this._doGET(path).then(response => {result = response;}).catch(error => {resultError = error;});

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
        // const TWINKLY_OBJ = this;

        let resultError;
        if (force || (this.token === '' || this.expires <= Date.now())) {
            this.log.debug(`[${this.name}.ensure_token] Authentication token expired, will refresh`);

            await this.login().catch(error => {resultError = error;});
            if (!resultError)
                await this.verify_login().catch(error => {resultError = error;});

        } else
            this.log.debug(`[${this.name}.ensure_token] Authentication token still valid (${new Date(this.expires).toLocaleString()})`);

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
     * @return {Promise<{mode: String, mode: Number, code: Number}>}
     */
    async get_mode() {
        let resultError;
        const response = await this._get('led/mode').catch(error => {resultError = error;});

        return new Promise((resolve, reject) => {
            if (resultError)
                reject(resultError);
            else
                resolve({mode: response['mode'], shop_mode: response['shop_mode'], code: response['code']});
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
        const response = await this._post('mqtt/config', {
            broker_host         : broker_host,
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
            const response = await this.set_mqtt(
                json.broker_host,
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
                resolve({response, code: response['code']}); // TODO: Movie-Config
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
     * @param {string} url
     * @param {{}} headers
     * @return {Promise<string | {}>}
     */
    sendGetHTTP(url, headers = {}) {
        return new Promise((resolve, reject) => {
            this.sendHTTP(url, null, 'GET', headers)
                .then(response => {
                    if (response) this.log.debug('[sendGetHTTP] ' + JSON.stringify(response));
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
    sendPostHTTP(url, body, headers = {}) {
        return new Promise((resolve, reject) => {
            this.sendHTTP(url, body, 'POST', headers)
                .then(response => {
                    if (response) this.log.debug('[sendPostHTTP] ' + JSON.stringify(response));
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
    sendHTTP(url, body, method, headers = {}) {
        return new Promise((resolve, reject) => {
            // Content-Type ergänzen falls nicht vorhanden
            if (!Object.keys(headers).includes('Content-Type'))
                headers['Content-Type'] = 'application/json';

            try {
                axios({
                    method  : (method === 'POST' ? 'POST' : 'GET'),
                    url     : url,
                    data    : body,
                    headers : headers
                })
                    .then(response => {
                        if (response.status !== 200)
                            reject('HTTP Error ' + response.statusText);
                        else
                            resolve(response.data);
                    })
                    .catch(error => {
                        if (error.response      && error.response.status === 401 &&
                            error.response.data && error.response.data.includes(HTTPCodes.INVALID_TOKEN))
                            reject(HTTPCodes.INVALID_TOKEN);
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
}

module.exports = {
    Connection,
    HTTPCodes,
    lightModes
};