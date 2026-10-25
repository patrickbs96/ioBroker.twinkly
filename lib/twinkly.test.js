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
