const { expect } = require('chai');
const { Twinkly } = require('./twinkly');
const { FakeTwinkly, createFakeAdapter } = require('../test/fakeTwinkly');

describe('lib/twinkly against a fake device', () => {
    let device;
    let adapter;
    let twinkly;

    beforeEach(async () => {
        device = new FakeTwinkly();
        adapter = createFakeAdapter();
        twinkly = new Twinkly(adapter, 'Baum', await device.start(), () => {});
        // Requests are only sent for a connected device (see the tests of checkConnection)
        twinkly.connected = true;
    });

    afterEach(async () => {
        await device.stop();
    });

    describe('connection', () => {
        it('logs in, verifies the token and reads the firmware', async () => {
            device.on('GET', 'fw/version', () => ({ body: { version: '2.9.1', code: 1000 } }));
            device.on('GET', 'gestalt', () => ({ body: { device_name: 'Baum', code: 1000 } }));

            // without ping the first request has to work although the device is not connected yet
            twinkly.connected = false;
            expect(await twinkly.checkConnection(false)).to.equal(true);
            await twinkly.interview();

            expect(twinkly.firmware).to.equal('2.9.1');

            // writing needs a token
            device.on('POST', 'led/mode', () => ({ body: { code: 1000 } }));
            await twinkly.setLEDMode('off');
            expect(device.requestsTo('POST', 'login')).to.have.length(1);
            expect(device.requestsTo('POST', 'verify')[0].body).to.deep.equal({ 'challenge-response': 'response' });
        });

        it('reports an unreachable device as not connected', async () => {
            await device.stop();
            expect(await twinkly.checkConnection(false)).to.equal(false);
            expect(twinkly.connected).to.equal(false);
        });
    });

    describe('setLEDMode', () => {
        it('posts the mode', async () => {
            device.on('POST', 'led/mode', () => ({ body: { code: 1000 } }));
            await twinkly.setLEDMode('effect');
            expect(device.requestsTo('POST', 'led/mode')[0].body).to.deep.equal({ mode: 'effect' });
        });
    });

    describe('devices without movie or playlist (#486, #452, #357)', () => {
        it('204 No Content for the current movie', async () => {
            device.on('GET', 'movies/current', () => ({ status: 204 }));
            const movie = await twinkly.getCurrentMovie();
            expect(movie.id).to.equal(-1);
        });

        it('204 No Content for the current playlist entry', async () => {
            device.on('GET', 'playlist/current', () => ({ status: 204 }));
            const entry = await twinkly.getCurrentPlaylistEntry();
            expect(entry.id).to.equal(-1);
        });

        it('data behind "Connection: close"', async () => {
            device.on('GET', 'playlist/current', req => {
                req.socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n{"code":1102}');
                return undefined;
            });
            const entry = await twinkly.getCurrentPlaylistEntry();
            expect(entry.id).to.equal(-1);
        });

        it('connection reset by the device', async () => {
            device.on('GET', 'movies/current', req => {
                req.socket.resetAndDestroy();
                return undefined;
            });
            const movie = await twinkly.getCurrentMovie();
            expect(movie.id).to.equal(-1);
        });
    });

    describe('request timeout', () => {
        it('does not wait forever for a device that does not answer', async function () {
            this.timeout(5000);
            twinkly.axiosInstance.defaults.timeout = 150;
            device.on('GET', 'gestalt', () => undefined);

            let error;
            try {
                await twinkly.getDeviceDetails();
            } catch (e) {
                error = e;
            }
            expect(error, 'request should have failed').to.be.an('error');
            expect(error.message).to.match(/timeout of 150ms exceeded/);
        });
    });

    describe('prepareMovieMode (#368)', () => {
        const movies = {
            movies: [
                { id: 3, name: 'Advent' },
                { id: 7, name: 'Weihnachten' },
            ],
            code: 1000,
        };

        beforeEach(() => {
            device.on('POST', 'movies/current', () => ({ body: { code: 1000 } }));
        });

        it('selects the current movie again before switching on', async () => {
            device.on('GET', 'movies', () => ({ body: movies }));
            device.on('GET', 'movies/current', () => ({ body: { id: 7, name: 'Weihnachten', code: 1000 } }));

            expect(await twinkly.prepareMovieMode()).to.equal('movie');
            expect(device.requestsTo('POST', 'movies/current')[0].body).to.deep.equal({ id: 7 });
        });

        it('takes the first movie if none is selected', async () => {
            device.on('GET', 'movies', () => ({ body: movies }));
            device.on('GET', 'movies/current', () => ({ status: 204 }));

            expect(await twinkly.prepareMovieMode()).to.equal('movie');
            expect(device.requestsTo('POST', 'movies/current')[0].body).to.deep.equal({ id: 3 });
        });

        it('switches on in mode color if no movie is saved', async () => {
            device.on('GET', 'movies', () => ({ status: 204 }));

            expect(await twinkly.prepareMovieMode()).to.equal('color');
            expect(device.requestsTo('POST', 'movies/current')).to.have.length(0);
        });

        it('still switches on in mode movie if the movie cannot be selected', async () => {
            device.on('GET', 'movies', () => ({ body: movies }));
            device.on('GET', 'movies/current', () => ({ body: { id: 7, code: 1000 } }));
            device.on('POST', 'movies/current', () => ({ status: 500, body: { code: 1000 } }));

            expect(await twinkly.prepareMovieMode()).to.equal('movie');
        });
    });
});
