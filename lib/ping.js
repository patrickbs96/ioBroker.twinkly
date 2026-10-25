const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const ERROR_MESSAGE =
    '[ping.probe] there was an error while executing the ping program. check the path or permissions...: ';

const regex = /=.*[<|=]([0-9]*).*TTL|ttl.+=([0-9.]*)/;

/** Everything ping writes to stderr when it may not open an ICMP socket */
const deniedPatterns = [
    /operation not permitted/i,
    /permission denied/i,
    /are you root/i,
    /root privilege/i,
    /must be root/i,
    /cap_net_raw/i,
    /lacking privilege/i,
];

/**
 * Check if ping failed because it is not allowed to send ICMP (e.g. unprivileged container)
 *
 * @param {string | undefined | null} text stderr of the ping process
 * @returns {boolean}
 */
function isPermissionError(text) {
    return !!text && deniedPatterns.some(pattern => pattern.test(text));
}

/**
 * The ping binary of this host. Not every system keeps it in /bin, the bare name lets PATH decide.
 *
 * @returns {string}
 */
function findPingBinary() {
    for (const candidate of ['/bin/ping', '/usr/bin/ping', '/sbin/ping', '/usr/sbin/ping']) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return 'ping';
}

/**
 * Build command and arguments of the ping call (an argument list, no shell is involved)
 *
 * @param {string} platform os.platform()
 * @param {string} addr host name or IP address
 * @param {{numeric?: boolean, timeout?: number | false, minReply?: number | false, extra?: string[]}} config
 * @param {() => string} [findBinary] lookup of the ping binary (unix-like systems)
 * @returns {{command: string, args: string[]} | null} null if the platform is not supported
 */
function buildCommand(platform, addr, config, findBinary = findPingBinary) {
    const numeric = config.numeric === undefined ? true : config.numeric;
    const timeout = config.timeout === undefined ? 2 : config.timeout;
    const minReply = config.minReply === undefined ? 1 : config.minReply;
    const extra = config.extra || [];
    const args = [];

    if (['linux', 'sunos', 'unix'].includes(platform)) {
        if (numeric !== false) {
            args.push('-n');
        }
        if (timeout !== false) {
            args.push('-w', String(parseInt(timeout, 10)));
        }
        if (minReply !== false) {
            args.push('-c', String(parseInt(minReply, 10)));
        }
        args.push(...extra, addr);
        return { command: findBinary(), args };
    }

    if (platform.startsWith('win')) {
        if (minReply !== false) {
            args.push('-n', String(parseInt(minReply, 10)));
        }
        if (timeout !== false) {
            args.push('-w', String(parseInt(timeout, 10) * 1000));
        }
        args.push(...extra, addr);
        // ping.exe is found via PATH, no cmd.exe needed
        return { command: 'ping.exe', args };
    }

    if (platform === 'darwin' || platform === 'freebsd') {
        if (numeric !== false) {
            args.push('-n');
        }
        if (timeout !== false) {
            args.push('-t', String(parseInt(timeout, 10)));
        }
        if (minReply !== false) {
            args.push('-c', String(parseInt(minReply, 10)));
        }
        args.push(...extra, addr);
        return { command: findBinary(), args };
    }

    return null;
}

/**
 * Execute ping
 *
 * @param {string} addr host name or IP address
 * @param {{log?: (msg: string) => void, numeric?: boolean, timeout?: number | false, minReply?: number | false, extra?: string[]}} [config]
 * @returns {Promise<{host: string, alive: boolean, ms: number | null, error?: string, denied?: boolean}>}
 */
async function probe(addr, config) {
    config = config || {};
    const log = config.log || console.log;
    const platform = os.platform().toLowerCase();

    // The address ends up as an argument of an external program: no options, no shell characters
    if (typeof addr !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.:_-]*$/.test(addr)) {
        throw new Error(`${ERROR_MESSAGE}invalid address "${addr}"`);
    }

    const cmd = buildCommand(platform, addr, config);
    if (!cmd) {
        throw new Error(`[ping.probe] Your platform "${platform}" is not supported`);
    }

    log(`[ping.probe] System command: ${cmd.command} ${cmd.args.join(' ')}`);

    return new Promise((resolve, reject) => {
        let ls;
        try {
            // Kill a hanging ping after the configured time plus some reserve
            const killAfter = ((parseInt(config.timeout, 10) || 2) * (parseInt(config.minReply, 10) || 1) + 5) * 1000;
            ls = cp.spawn(cmd.command, cmd.args, { timeout: killAfter, windowsHide: true });
        } catch (e) {
            reject(new Error(ERROR_MESSAGE + e));
            return;
        }

        let outString = '';
        let errString = '';
        let settled = false;
        const fail = e => {
            if (!settled) {
                settled = true;
                reject(new Error(ERROR_MESSAGE + e));
            }
        };

        ls.on('error', fail);
        ls.stderr.on('error', fail);
        ls.stdout.on('error', fail);
        ls.stderr.on('data', data => {
            errString += String(data);
            log(`[ping.probe] STDERR: ${String(data).trim()}`);
        });
        ls.stdout.on('data', data => (outString += String(data)));

        // 'close' (not 'exit'): all output has been read
        ls.on('close', code => {
            if (settled) {
                return;
            }
            settled = true;

            let ms = null;
            for (const line of outString.split('\n')) {
                const m = regex.exec(line);
                if (m) {
                    ms = parseFloat(m[1] || m[2]);
                    if (Number.isNaN(ms)) {
                        ms = null;
                    }
                    break;
                }
            }

            const error = errString.trim();
            resolve({
                host: addr,
                // Windows ping returns 0 even if the target was unreachable: only an answer counts
                alive: platform.startsWith('win') ? ms !== null : !code,
                ms,
                error: error || undefined,
                denied: isPermissionError(error),
            });
        });
    });
}

module.exports = {
    probe,
    buildCommand,
    isPermissionError,
};
