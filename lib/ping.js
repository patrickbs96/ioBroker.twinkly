const cp = require('child_process');
const p  = require('os').platform().toLowerCase();

/**
 * Ping ausführen
 * @param {String} addr
 * @param {{}} config
 * @return {Promise<{host: String, alive: Boolean, ms: Number}>}
 */
async function probe(addr, config) {
    const ERROR_MESSAGE = '[ping.probe] there was an error while executing the ping program. check the path or permissions...: ';

    return new Promise((resolve, reject) => {
        config = config || {};

        let ls  = null;
        const log = config.log || console.log;

        config = {
            numeric : config.numeric  === undefined ? true : config.numeric,
            timeout : config.timeout  === undefined ? 2    : config.timeout,
            minReply: config.minReply === undefined ? 1    : config.minReply,
            extra   : config.extra || []
        };

        const args    = [];
        const xFamily = ['linux', 'sunos', 'unix'];
        const regex   = /=.*[<|=]([0-9]*).*TTL|ttl..*=([0-9.]*)/;

        try {
            if (xFamily.includes(p)) {
                //linux
                if (config.numeric !== false) {
                    args.push('-n');
                }

                if (config.timeout !== false) {
                    args.push('-w', config.timeout);
                }

                if (config.minReply !== false) {
                    args.push('-c', config.minReply);
                }

                if (config.extra !== false) {
                    for (const arg of config.extra)
                        args.push(arg);
                }

                args.push(addr);
                log('[ping.probe] System command: /bin/ping ' + args.join(' '));
                ls = cp.spawn('/bin/ping', args);
            } else if (p.match(/^win/)) {
                //windows
                if (config.minReply !== false) {
                    args.push('-n ' + config.minReply);
                }

                if (config.timeout !== false) {
                    args.push('-w ' + config.timeout * 1000);
                }

                if (config.extra !== false) {
                    for (const arg of config.extra)
                        args.push(arg);
                }

                args.push(addr);

                const allArgs = [
                    '/s', // leave quotes as they are
                    '/c', // run and exit
                    // !!! order of c and s is important - c must come last!!!
                    '"', // enforce starting quote
                    process.env.SystemRoot + '\\system32\\ping.exe' // command itself. Notice that you'll have to pass it quoted if it contains spaces
                ].concat(args)
                    .concat('"'); // enforce closing quote

                log('[ping.probe] System command: ' + (process.env.comspec || 'cmd.exe') + ' ' + allArgs.join(' '));
                // switch the command to cmd shell instead of the original command
                ls = cp.spawn(process.env.comspec || 'cmd.exe', allArgs, {windowsVerbatimArguments: true});
            } else if (p === 'darwin' || p === 'freebsd') {
                //mac osx or freebsd
                if (config.numeric !== false) {
                    args.push('-n');
                }

                if (config.timeout !== false) {
                    args.push('-t ' + config.timeout);
                }

                if (config.minReply !== false) {
                    args.push('-c ' + config.minReply);
                }

                if (config.extra !== false) {
                    for (const arg of config.extra)
                        args.push(arg);
                }

                args.push(addr);
                log('[ping.probe] System command: /sbin/ping ' + args.join(' '));
                ls = cp.spawn('/sbin/ping', args);
            } else {
                reject('[ping.probe] Your platform "' + p + '" is not supported');
                return;
            }
        } catch (e) {
            reject(ERROR_MESSAGE + e);
            return;
        }

        if (ls === null) {
            reject(ERROR_MESSAGE + 'No object available!');
            return;
        }

        ls.on('error', e => reject(ERROR_MESSAGE + e));

        if (ls.stderr) {
            ls.stderr.on('data', data => reject(ERROR_MESSAGE + data));
            ls.stderr.on('error', e   => reject(ERROR_MESSAGE + e));
        }

        let outString = '';
        if (ls.stdout) {
            ls.stdout.on('data', data => outString += String(data));
            ls.stdout.on('error', e   => reject(ERROR_MESSAGE + e));
        }

        ls.on('exit', code => {
            const result = {host: addr, alive: false, ms: -1};

            const lines = outString.split('\n');
            for (let t = 0; t < lines.length; t++) {
                const m = regex.exec(lines[t]) || '';
                if (m !== '') {
                    result.ms = m[1] || m[2] || -1;
                    break;
                }
            }

            if (p.match(/^win/)) {
                result.alive = result.ms !== -1;
            } else {
                result.alive = !code;
            }

            resolve(result);
        });
    });
}

exports.probe = probe;