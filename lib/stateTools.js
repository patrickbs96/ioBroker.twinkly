const tools = require('./tools');

const FORBIDDEN_CHARS = /[\][*,;'"`<>\\?]/g;

/**
 * Remove forbidden chars from string
 * @returns {string}
 */
function removeForbiddenChars(name) {
    return name.replace(FORBIDDEN_CHARS, '_');
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
    removeForbiddenChars,
    addStates2Object,
    updateObjectNative
};