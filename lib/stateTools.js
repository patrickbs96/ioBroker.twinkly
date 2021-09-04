const FORBIDDEN_CHARS = /[\][*,;'"`<>\\?]/g;

/**
 *
 * @param  {ioBroker.Adapter} adapter
 * @param  {{device: String, channel: String, state: String}} id
 * @param  {{}} common
 * @param  {{}} native
 * @returns Promise<Boolean>
 */
async function createDevice(adapter, id, common, native) {
    let resultError;
    if (!id.device)
        resultError = 'Cannot create a device without a name!';

    if (!resultError) {
        const deviceName = buildId(id, null);
        await adapter.setObjectNotExistsAsync(deviceName, {type: 'device', common: common, native: native ? native : {}})
            .catch(error => {
                resultError = error;
            });
    }

    return new Promise((resolve, reject) => {
        if (resultError)
            reject(resultError);
        else
            resolve(true);
    });
}

/**
 *
 * @param  {ioBroker.Adapter} adapter
 * @param  {{device: String, channel: String, state: String}} id
 * @param  {{}} common
 * @param  {{}} native
 * @return Promise<Boolean>
 */
async function createChannel(adapter, id, common, native) {
    let resultError;
    if (!id.channel)
        resultError = 'Cannot create a channel without a name!';

    if (!resultError) {
        const deviceName = buildId(id, null);
        await adapter.setObjectNotExistsAsync(deviceName, {type: 'channel', common: common, native: native ? native : {}})
            .catch(error => {
                resultError = error;
            });
    }

    return new Promise((resolve, reject) => {
        if (resultError)
            reject(resultError);
        else
            resolve(true);
    });
}

/**
 *
 * @param  {ioBroker.Adapter} adapter
 * @param  {{device: String, channel: String, state: String}} id
 * @param  {{}} common
 * @param  {{}} native
 * @return Promise<Boolean>
 */
async function createState(adapter, id, common, native) {
    let resultError;
    if (!id.state)
        resultError = 'Cannot create a state without a name!';

    if (!resultError) {
        const deviceName = buildId(id, null);
        await adapter.setObjectNotExistsAsync(deviceName, {type: 'state', common: common, native: native ? native : {}})
            .then(() => {
                if (common.def !== undefined)
                    adapter.setState(id, common.def, true);
                else
                    adapter.setState(id, null, true);
            })
            .catch(error => {
                resultError = error;
            });
    }

    return new Promise((resolve, reject) => {
        if (resultError)
            reject(resultError);
        else
            resolve(true);
    });
}

/**
 * buildId
 * @param {{device: String, channel: String, state: String} | String} id
 * @param {ioBroker.Adapter} adapter
 * @returns {string}
 */
function buildId(id, adapter) {
    if (typeof id === 'object') {
        let result = (adapter ? adapter.namespace : '');
        result +=  (id.device  ? (result !== '' ? '.' : '') + id.device .replace(FORBIDDEN_CHARS, '_') : '');
        result +=  (id.channel ? (result !== '' ? '.' : '') + id.channel.replace(FORBIDDEN_CHARS, '_') : '');
        result +=  (id.state   ? (result !== '' ? '.' : '') + id.state  .replace(FORBIDDEN_CHARS, '_') : '');
        return result;
    }
    else
        return id;
}

module.exports = {
    FORBIDDEN_CHARS,
    createState,
    createChannel,
    createDevice,
    buildId
};