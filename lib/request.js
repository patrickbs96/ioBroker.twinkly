const axios = require('axios').default;

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function getRequest(adapter, url, headers = {}) {
    return await _sendRequest(adapter, url, null, 'GET', headers);
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {string | {}} body
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function postRequest(adapter, url, body, headers = {}) {
    return await _sendRequest(adapter, url, body, 'POST', headers);
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function deleteRequest(adapter, url, headers = {}) {
    return await _sendRequest(adapter, url, null, 'DELETE', headers);
}

/**
 * @param {ioBroker.Adapter} adapter
 * @param {string} url
 * @param {any} body
 * @param {axios.Method} method
 * @param {{}} headers
 * @return {Promise<string | {}>}
 */
async function _sendRequest(adapter, url, body, method, headers = {}) {
    // Content-Type ergänzen falls nicht vorhanden
    if (!Object.keys(headers).includes('Content-Type')) {
        headers['Content-Type'] = 'application/json';
    }

    adapter.log.debug(`[_sendRequest.${method}] url="${url}", body="${body !== undefined ? JSON.stringify(body) : 'null'}", headers="${JSON.stringify(headers)}"`);

    let response;
    try {
        response = await axios({url: url, method: method, headers: headers, data: body});
    } catch (/** @type {axios.AxiosError | Error} */ e) {
        // Logging
        let message = '';
        if (e instanceof axios.AxiosError) {
            message = `, code="${e.code}"`;
            if (e.response) {
                message += `, response={status="${e.response.status}", statusText="${e.response.statusText}", data="${JSON.stringify(e.response.data)}"}`;
            }
        }
        adapter.log.debug(`[_sendRequest.${method}] ${e.name}: "${e.message}"${message} - ${e.stack}`);

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
            adapter.log.debug(`[_sendRequest.${method}.response] ${JSON.stringify(response.data)}`);
        }
        return response.data;
    }
}

module.exports = {
    getRequest,
    postRequest,
    deleteRequest
};