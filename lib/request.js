const axios = require('axios');

/**
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
function sendGetHTTP(url, headers = {}) {
    return new Promise((resolve, reject) => {
        sendHTTP(url, null, 'GET', headers)
            .then(response => {
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
                        reject('HTTP Error ' + response.statusText + (response.data ? ': ' + response.data : ''));
                    else
                        resolve(response.data);
                })
                .catch(error => {
                    if (error.response && error.response.status !== 200)
                        reject('HTTP Error ' + error.response.status + (error.response.data ? ': ' + error.response.data : ''));
                    else
                        reject(error);
                });
        } catch (e) {
            reject(e.message);
        }
    });
}

module.exports = {
    sendHTTP,
    sendGetHTTP,
    sendPostHTTP
};