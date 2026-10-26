const http = require('node:http');

/**
 * A minimal Twinkly device for tests: answers login/verify and everything that is registered with `on`
 */
class FakeTwinkly {
    constructor() {
        /** @type {Record<string, (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void>} */
        this.routes = {};
        /** @type {{method: string, path: string, body: any}[]} */
        this.requests = [];
        this.server = http.createServer((req, res) => this._handle(req, res));
        this.host = '';

        this.on('POST', 'login', () => ({
            body: {
                authentication_token: 'token',
                authentication_token_expires_in: 14400,
                'challenge-response': 'response',
                code: 1000,
            },
        }));
        this.on('POST', 'verify', () => ({ body: { code: 1000 } }));
    }

    /**
     * @param {string} method
     * @param {string} path path behind /xled/v1/
     * @param {(req: http.IncomingMessage, res: http.ServerResponse, body: any) => ({status?: number, body?: any} | void)} handler
     * a returned object is sent as JSON, otherwise the handler answers on its own
     * @returns {this}
     */
    on(method, path, handler) {
        this.routes[`${method} ${path}`] = handler;
        return this;
    }

    /**
     * @param {string} method
     * @param {string} path
     * @returns {{method: string, path: string, body: any}[]}
     */
    requestsTo(method, path) {
        return this.requests.filter(r => r.method === method && r.path === path);
    }

    _handle(req, res) {
        let raw = '';
        req.on('data', chunk => (raw += chunk));
        req.on('end', () => {
            const path = (req.url || '').replace(/^\/xled\/v1\//, '');
            let body = raw;
            try {
                body = raw ? JSON.parse(raw) : undefined;
            } catch {
                // binary or plain text
            }
            this.requests.push({ method: req.method || '', path, body });

            const handler = this.routes[`${req.method} ${path}`];
            if (!handler) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 1000 }));
                return;
            }

            const answer = handler(req, res, body);
            if (answer) {
                res.writeHead(answer.status || 200, { 'Content-Type': 'application/json' });
                res.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
            }
        });
    }

    /** @returns {Promise<string>} host with port for the adapter, e.g. 127.0.0.1:34567 */
    async start() {
        await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve));
        // @ts-expect-error address() is an object for a TCP server
        this.host = `127.0.0.1:${this.server.address().port}`;
        return this.host;
    }

    async stop() {
        this.server.closeAllConnections();
        await new Promise(resolve => this.server.close(resolve));
    }
}

/** Adapter replacement that keeps the log */
function createFakeAdapter() {
    const messages = [];
    const log = {};
    for (const level of ['silly', 'debug', 'info', 'warn', 'error']) {
        log[level] = text => messages.push({ level, text: String(text) });
    }
    return { log, messages };
}

module.exports = { FakeTwinkly, createFakeAdapter };
