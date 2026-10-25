const { expect } = require('chai');
const { probe, buildCommand, isPermissionError } = require('./ping');

describe('lib/ping', () => {
    describe('buildCommand', () => {
        const findBinary = () => '/usr/bin/ping';

        it('linux: separate arguments, binary from lookup', () => {
            expect(buildCommand('linux', '192.168.1.5', {}, findBinary)).to.deep.equal({
                command: '/usr/bin/ping',
                args: ['-n', '-w', '2', '-c', '1', '192.168.1.5'],
            });
        });

        it('darwin: -t and -c are separate arguments', () => {
            expect(buildCommand('darwin', 'twinkly-1', { timeout: 3, minReply: 2 }, findBinary)).to.deep.equal({
                command: '/usr/bin/ping',
                args: ['-n', '-t', '3', '-c', '2', 'twinkly-1'],
            });
        });

        it('windows: ping.exe is called directly, timeout in ms, no shell', () => {
            expect(buildCommand('win32', '192.168.1.5', {})).to.deep.equal({
                command: 'ping.exe',
                args: ['-n', '1', '-w', '2000', '192.168.1.5'],
            });
        });

        it('options can be switched off, extra arguments are kept in front of the address', () => {
            expect(
                buildCommand(
                    'linux',
                    '10.0.0.1',
                    { numeric: false, timeout: false, minReply: false, extra: ['-4'] },
                    findBinary,
                ),
            ).to.deep.equal({ command: '/usr/bin/ping', args: ['-4', '10.0.0.1'] });
        });

        it('returns null for unsupported platforms', () => {
            expect(buildCommand('aix', '10.0.0.1', {}, findBinary)).to.equal(null);
        });
    });

    describe('isPermissionError', () => {
        it('detects missing ICMP permissions', () => {
            expect(isPermissionError('ping: socket: Operation not permitted')).to.equal(true);
            expect(isPermissionError('ping: Lacking privilege for raw socket.')).to.equal(true);
        });

        it('ignores other output', () => {
            expect(isPermissionError('')).to.equal(false);
            expect(isPermissionError(undefined)).to.equal(false);
            expect(isPermissionError('ping: unknown host foo')).to.equal(false);
        });
    });

    describe('probe', () => {
        for (const addr of ['--help', '-n', '1.2.3.4 & calc', 'a b', '', '$(id)']) {
            it(`rejects the invalid address ${JSON.stringify(addr)}`, async () => {
                let error;
                try {
                    await probe(addr, { log: () => {} });
                } catch (e) {
                    error = e;
                }
                expect(error, 'probe should have thrown').to.be.an('error');
                expect(error.message).to.contain('invalid address');
            });
        }

        it('finds localhost alive', async function () {
            this.timeout(15000);
            let result;
            try {
                result = await probe('127.0.0.1', { log: () => {} });
            } catch {
                // no ping program on this machine
                return this.skip();
            }
            if (result.denied) {
                // not allowed to send ICMP on this machine
                return this.skip();
            }
            expect(result.alive).to.equal(true);
            expect(result.host).to.equal('127.0.0.1');
        });
    });
});
