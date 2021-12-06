const axios = require('axios');

/**
 * Tests whether the given variable is a real object and not an Array
 * @param {any} it The variable to test
 * @returns {Boolean}
 */
function isObject(it) {
    // This is necessary because:
    // typeof null === 'object'
    // typeof [] === 'object'
    // [] instanceof Object === true
    return Object.prototype.toString.call(it) === '[object Object]';
}

/**
 * Tests whether the given variable is really an Array
 * @param {any} it The variable to test
 * @returns {Boolean}
 */
function isArray(it) {
    if (typeof Array.isArray === 'function') return Array.isArray(it);
    return Object.prototype.toString.call(it) === '[object Array]';
}

/**
 * Translates text to the target language. Automatically chooses the right translation API.
 * @param {string} text The text to translate
 * @param {string} targetLang The target languate
 * @param {string} [yandexApiKey] The yandex API key. You can create one for free at https://translate.yandex.com/developers
 * @returns {Promise<string>}
 */
async function translateText(text, targetLang, yandexApiKey) {
    if (targetLang === 'en') {
        return text;
    } else if (!text) {
        return '';
    }
    if (yandexApiKey) {
        return await translateYandex(text, targetLang, yandexApiKey);
    } else {
        return await translateGoogle(text, targetLang);
    }
}

/**
 * Translates text with Yandex API
 * @param {string} text The text to translate
 * @param {string} targetLang The target languate
 * @param {string} apiKey The yandex API key. You can create one for free at https://translate.yandex.com/developers
 * @returns {Promise<string>}
 */
async function translateYandex(text, targetLang, apiKey) {
    if (targetLang === 'zh-cn') targetLang = 'zh';

    const url = `https://translate.yandex.net/api/v1.5/tr.json/translate?key=${apiKey}&text=${encodeURIComponent(text)}&lang=en-${targetLang}`;
    await axios({url, timeout: 15000})
        .then(response => {
            if (response.data && response.data.text && isArray(response.data.text)) {
                return response.data.text[0];
            } else
                throw new Error('Invalid response for translate request');
        })
        .catch(error => {
            if (error.response && error.response.status === 429) {
                throw new Error(`Could not translate to "${targetLang}": Rate-limited by Google Translate`);
            } else {
                throw new Error(`Could not translate to "${targetLang}": ${error}`);
            }
        });
}

/**
 * Translates text with Google API
 * @param {string} text The text to translate
 * @param {string} targetLang The target languate
 * @returns {Promise<string>}
 */
async function translateGoogle(text, targetLang) {
    const url = `http://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}&ie=UTF-8&oe=UTF-8`;
    await axios({url, timeout: 15000})
        .then(response => {
            if (isArray(response.data)) {
                // we got a valid response
                return response.data[0][0][0];
            } else
                throw Error('Invalid response for translate request');
        })
        .catch(error => {
            if (error.response && error.response.status === 429) {
                throw Error(`Could not translate to "${targetLang}": Rate-limited by Google Translate`);
            } else {
                throw Error(`Could not translate to "${targetLang}": ${error}`);
            }
        });
}

/**
 * Hex to RGB
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
function hexToRgb(hex) {
    // Expand shorthand form (e.g. '03F') to full form (e.g. '0033FF')
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
        return r + r + g + g + b + b;
    });

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : {r: 0, g: 0, b: 0};
}

/**
 * RGB to Hex
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {String}
 */
function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * @param {String} version1
 * @param {String} version2
 * @returns {'lower'|'equal'|'higher'}
 */
function compareVersions(version1, version2) {
    const version1Arr = version1.split('.');
    const version2Arr = version2.split('.');

    /**
     * @param {String[]} version1
     * @param {String[]} version2
     * @param {'lower'|'higher'} result1
     * @param {'lower'|'higher'} result2
     * @returns {'lower'|'equal'|'higher'}
     */
    function compareVersionsArr(version1, version2, result1, result2) {
        for (let index = 0; index < version1.length; index++) {
            const version1Val = version1[index];
            const version2Val = index < version2.length ? version2[index] : '0';

            if (version1Val > version2Val)
                return result1;
            if (version1Val < version2Val)
                return result2;
        }

        return 'equal';
    }

    let result = compareVersionsArr(version1Arr, version2Arr, 'lower', 'higher');
    if (result === 'equal')
        result = compareVersionsArr(version2Arr, version1Arr, 'higher', 'lower');

    return result;
}

/**
 * @param {String} version1
 * @param {String} version2
 * @returns {Boolean}
 */
function versionGreaterEqual(version1, version2) {
    const versionDiff = compareVersions(version1, version2);
    return versionDiff === 'equal' || versionDiff === 'higher';
}

/**
 * @param {String} version1
 * @param {String} version2
 * @returns {Boolean}
 */
function versionsEqual(version1, version2) {
    const versionDiff = compareVersions(version1, version2);
    return versionDiff === 'equal';
}

/**
 * @param {String} version1
 * @param {String} version2
 * @returns {Boolean}
 */
function versionLower(version1, version2) {
    const versionDiff = compareVersions(version1, version2);
    return versionDiff === 'lower';
}

/**
 * areStatesEqual
 * @param {{common: {}, native: {}}} rhs
 * @param {{common: {}, native: {}}} lhs
 * @param {String[]} exclude
 * @returns {boolean}
 */
function areStatesEqual(rhs, lhs, exclude) {
    return areObjectsEqual(rhs.common, lhs.common, exclude) &&
        areObjectsEqual(rhs.native, lhs.native, exclude);
}

/**
 * Check if two Objects are identical
 * @param {{}} aObj
 * @param {{}} bObj
 * @param {String[]} exclude
 * @returns {boolean}
 */
function areObjectsEqual(aObj, bObj, exclude) {
    function doCheck(aObj, bObj) {
        let result = typeof aObj !== 'undefined' && typeof bObj !== 'undefined';

        if (result)
            for (const key of Object.keys(aObj)) {
                if (exclude && exclude.length > 0 && exclude.includes(key))
                    continue;

                let equal = Object.keys(bObj).includes(key);
                if (equal) {
                    if (typeof aObj[key] === 'object' && typeof bObj[key] === 'object')
                        equal = areObjectsEqual(aObj[key], bObj[key], exclude);
                    else
                        equal = aObj[key] === bObj[key];
                }

                if (!equal) {
                    result = false;
                    break;
                }
            }

        return result;
    }

    return doCheck(aObj, bObj) && doCheck(bObj, aObj);
}

/**
 * Sleep to pause execution
 * @param ms
 * @return {Promise<unknown>}
 */
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

module.exports = {
    isArray,
    isObject,
    translateText,
    hexToRgb,
    rgbToHex,
    compareVersions,
    versionGreaterEqual,
    versionsEqual,
    versionLower,
    areStatesEqual,
    areObjectsEqual,
    sleep
};
