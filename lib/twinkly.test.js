const { expect } = require('chai');
const { isNoContentError } = require('./twinkly');

describe('lib/twinkly isNoContentError', () => {
    it('accepts the answers of devices without movie or playlist', () => {
        expect(isNoContentError(new Error('Parse Error: Data after `Connection: close`'))).to.equal(true);
        expect(isNoContentError(new Error('HTTP Error (204) No Content: {"code":1102}'))).to.equal(true);
        expect(isNoContentError(new Error('read ECONNRESET'))).to.equal(true);
    });

    it('rejects other errors', () => {
        expect(isNoContentError(new Error('timeout of 10000ms exceeded'))).to.equal(false);
        expect(isNoContentError(undefined)).to.equal(false);
    });
});

describe('lib/tools isNetworkError', () => {
    const { isNetworkError } = require('./tools');

    it('detects connection problems', () => {
        expect(isNetworkError(new Error('read ECONNRESET'))).to.equal(true);
        expect(isNetworkError(new Error('connect ETIMEDOUT 192.168.1.5:80'))).to.equal(true);
        expect(isNetworkError(new Error('connect EHOSTUNREACH 192.168.1.5:80'))).to.equal(true);
        expect(isNetworkError(new Error('timeout of 10000ms exceeded'))).to.equal(true);
        expect(isNetworkError(new Error('wrapped', { cause: { code: 'ECONNABORTED' } }))).to.equal(true);
    });

    it('does not hide other errors', () => {
        expect(isNetworkError(new Error('HTTP Error (401) Unauthorized'))).to.equal(false);
        expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).to.equal(false);
        expect(isNetworkError(undefined)).to.equal(false);
    });
});
