const axios = require('axios');

/**
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendGetHTTP(url, headers = {}) {
    try {
        return await sendHTTP(url, null, 'GET', headers);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * @param {string} url
 * @param {string | {}} body
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendPostHTTP(url, body, headers = {}) {
    try {
        return await sendHTTP(url, body, 'POST', headers);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * @param {string} url
 * @param {any} body
 * @param {string} method
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendHTTP(url, body, method, headers = {}) {
    // Content-Type ergänzen falls nicht vorhanden
    if (!Object.keys(headers).includes('Content-Type'))
        headers['Content-Type'] = 'application/json';

    let result, resultError;
    await axios({
        method  : (method === 'POST' ? 'POST' : 'GET'),
        url     : url,
        data    : body,
        headers : headers
    })
        .then(response => {
            if (response.status !== 200)
                resultError = 'HTTP Error ' + response.statusText + (response.data ? ': ' + JSON.stringify(response.data) : '');
            else
                result = response.data;
        })
        .catch(error => {
            if (error.response && error.response.status !== 200)
                resultError = 'HTTP Error ' + error.response.status + (error.response.data ? ': ' + JSON.stringify(error.response.data) : '');
            else
                resultError = error;
        });

    if (resultError)
        throw Error(resultError);
    return result;
}

module.exports = {
    sendHTTP,
    sendGetHTTP,
    sendPostHTTP
};