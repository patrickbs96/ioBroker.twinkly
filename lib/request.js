const axios = require('axios');

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendGetHTTP(adapter, url, headers = {}) {
    try {
        return await sendHTTP(adapter, url, null, 'GET', headers);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {string | {}} body
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendPostHTTP(adapter, url, body, headers = {}) {
    try {
        return await sendHTTP(adapter, url, body, 'POST', headers);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendDeleteHTTP(adapter, url, headers = {}) {
    try {
        return await sendHTTP(adapter, url, null, 'DELETE', headers);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {any} body
 * @param {string} method
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function sendHTTP(adapter, url, body, method, headers = {}) {
    // Content-Type ergänzen falls nicht vorhanden
    if (!Object.keys(headers).includes('Content-Type'))
        headers['Content-Type'] = 'application/json';

    adapter.log.debug(`[sendHTTP.${method}] url="${url}", body="${body !== undefined ? JSON.stringify(body) : 'null'}", headers="${JSON.stringify(headers)}"`);

    let result, resultError;
    try {
        await axios({
            method: (method === 'POST' ? 'POST' : method === 'DELETE' ? 'DELETE' : 'GET'),
            url: url,
            data: body,
            headers: headers
        })
            .then(response => {
                if (response.status !== 200) {
                    resultError = `HTTP Error (${response.status}) ${response.statusText}${response.data ? ': ' + JSON.stringify(response.data) : ''}`;
                } else {
                    result = response.data;
                    if (result)
                        adapter.log.debug(`[sendHTTP.${method}.response] ${JSON.stringify(result)}`);
                }
            })
            .catch(error => {
                if (error.response && error.response.status !== 200)
                    resultError = `HTTP Error (${error.response.status}) ${error.response.statusText}${error.response.data ? ': ' + JSON.stringify(error.response.data) : ''}`;
                else
                    resultError = error.message ? error.message : error;
            });
    } catch (e) {
        resultError = e.message;
    }

    if (resultError)
        throw Error(resultError);

    return result;
}

module.exports = {
    sendHTTP,
    sendGetHTTP,
    sendPostHTTP,
    sendDeleteHTTP
};