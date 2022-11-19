const tools = require('./tools');

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
    if (!id.device)
        throw Error('Cannot create a device without a name!');

    try {
        const stateId = buildId(id, null);
        await adapter.setObjectNotExistsAsync(stateId,
            {type: 'device', common: common, native: native ? native : {}});
    } catch (e) {
        throw Error(e.message);
    }
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
    if (!id.channel)
        throw Error('Cannot create a channel without a name!');

    try {
        const stateId = buildId(id, null);
        await adapter.setObjectNotExistsAsync(stateId,
            {type: 'channel', common: common, native: native ? native : {}});
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 *
 * @param  {ioBroker.Adapter} adapter
 * @param  {{device: String, channel: String, state: String}} id
 * @param  {{}} common
 * @param  {{}} native
 */
async function createState(adapter, id, common, native) {
    if (!id.state)
        throw Error('Cannot create a state without a name!');

    try {
        const stateId = buildId(id, null);
        await adapter.setObjectNotExistsAsync(stateId, {
            type: 'state', common: common, native: native ? native : {}});

        if (common.def !== undefined)
            await adapter.setStateAsync(stateId, common.def, true);
        else
            await adapter.setStateAsync(stateId, null, true);
    } catch (e) {
        throw Error(e.message);
    }
}

/**
 * buildId
 * @param {{device?: String, channel?: String, state?: String} | String} id
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
    } else
        return id;
}

/**
 * Add States to Object
 * @param  {ioBroker.Adapter} adapter
 * @param {String} stateId
 * @param {{[p: String]: String}} states
 * @return {Promise<void>}
 */
async function addStates2Object(adapter, stateId, states) {
    const obj = await adapter.getObjectAsync(stateId);
    if (obj) {
        if (!tools.areObjectsEqual(obj.common.states, states, [])) {
            obj.common.states = states;
            await adapter.setObjectAsync(stateId, obj);
        }
    } else {
        await adapter.extendObject(stateId, {common: {states: states}}, err => {
            if (err)
                throw Error(err.message);
        });
    }
}

/**
 * Update Object native
 * @param  {ioBroker.Adapter} adapter
 * @param {String} stateId
 * @param {{[p: String]: String}} native
 * @return {Promise<void>}
 */
async function updateObjectNative(adapter, stateId, native) {
    const obj = await adapter.getObjectAsync(stateId);
    if (obj) {
        if (!tools.areObjectsEqual(obj.native, native, [])) {
            obj.native = native;
            await adapter.setObjectAsync(stateId, obj);
        }
    } else {
        await adapter.extendObject(stateId, {native: native}, err => {
            if (err)
                throw Error(err.message);
        });
    }
}

module.exports = {
    FORBIDDEN_CHARS,
    createState,
    createChannel,
    createDevice,
    buildId,
    addStates2Object,
    updateObjectNative
};