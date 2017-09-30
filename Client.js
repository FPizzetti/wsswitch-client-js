const WebsocketClient = require('websocket').client;
const Message = require('./Message');
const uuid = require('uuid');

class Client {

    constructor() {
        this.messageMap = {};
        this.url = 'wss://wsswitch.com';
        this.websocketClient = new WebsocketClient();
        this.connection = {connected: false};
        this.arMessageTimeout = 60000;
        this.ffMessageTimeout = 500;
        this.onMessageCallback = null;
        this.onErrorCallback = null;
        this.onCloseCallback = null;
    }

    connect(login, password) {
        if (!login || !password) {
            throw 'missing login or password';
        }

        return new Promise((resolve, reject) => {
            this.websocketClient.on('connectFailed', (error) => {
                reject(error.toString());
            });
            this.websocketClient.on('connect', (connection) => {
                this.connection = connection;
                connection.on('error', this._onError.bind(this));
                connection.on('close', this._onClose.bind(this));
                connection.on('message', this._onMessage.bind(this));
                resolve();
            });
            this.websocketClient.connect(`${this.url}?login=${login}&password=${password}`);
        });

    }

    on(event, callback) {
        if (typeof event !== 'string') {
            throw 'invalid listener. Use: message, close or error';
        }
        if (typeof callback !== 'function') {
            throw 'callback must be a function';
        }
        switch (event) {
            case 'message':
                this.onMessageCallback = callback;
                break;
            case 'close':
                this.onCloseCallback = callback;
                break;
            case 'error':
                this.onErrorCallback = callback;
                break;
            default:
                throw 'invalid listener. Use: message, close or error';
        }
    }

    sendMessage(message, protocol = 'sump', version = '1.0') {
        if (!(message instanceof Message)) {
            throw 'message parameter must be an instance of Message class';
        }
        return new Promise((resolve, reject) => {
            if (!this.connection.connected) {
                return reject('connection is closed');
            }
            if (typeof message.ref === 'undefined') {
                message.ref = uuid.v1();
            }
            if (message.ackRequired) {
                if (!message.ref) {
                    throw 'message must have a ref to use ack option';
                }
                this._setTimeout(message.ref, 'ar', resolve, reject);
            } else {
                if (message.ref) {
                    this._setTimeout(message.ref, 'ff', resolve, reject);
                }
            }
            this.connection.sendUTF(`${protocol}:${version};${message.toString()}`);
        });
    }

    countPendingMessages() {
        return Object.keys(this.messageMap).length;
    }

    rejectAllPendingMessages() {
        let messageMap = Object.assign({}, this.messageMap);
        for(let ref in messageMap) {
            if(messageMap.hasOwnProperty(ref)) {
                let m = messageMap[ref];
                m.reject('forced rejection by client');
                delete this.messageMap[ref];
            }
        }
    }

    resolveAllPendingMessages() {
        let messageMap = Object.assign({}, this.messageMap);
        for(let ref in messageMap) {
            if(messageMap.hasOwnProperty(ref)) {
                let m = messageMap[ref];
                m.resolve('forced resolution by client');
                delete this.messageMap[ref];
            }
        }
    }

    _setTimeout(ref, type, resolve, reject) {
        let timeout = type === 'ar' ? this.arMessageTimeout : this.ffMessageTimeout;
        this.messageMap[ref] = {
            timeoutId: setTimeout(() => {
                delete this.messageMap[ref];
                if (type === 'ar') {
                    reject('timeout');
                } else {
                    resolve('no error detected');
                }
            }, timeout),
            resolve,
            reject
        };
    }

    _onError(error) {
        if (this.onErrorCallback) {
            this.onErrorCallback(error);
        }
    }

    _onClose() {
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    _onMessage(message) {
        if(message.type === 'utf8') {
            message = message.utf8Data;
        } else {
            console.error('unsupported message format');
            console.error(message);
            return;
        }
        let err = message.match(/^ERROR:(.*):(.*)$/);
        if (err) {
            let ref = err[1];
            let payload = err[2];
            if (ref) {
                let m = this.messageMap[ref];
                clearTimeout(m.timeoutId);
                m.reject(payload);
            }
            return;
        }
        let ack = message.match(/^ACK:(.*)$/);
        if (ack) {
            let ref = err[1];
            if (ref) {
                let m = this.messageMap[ref];
                clearTimeout(m.timeoutId);
                m.resolve();
            }
            return;
        }
        if (message.startsWith('{')) {
            try {
                message = JOSN.parse(message);
            } catch (e) {
                //noop
            }
        }
        if (this.onMessageCallback) {
            this.onMessageCallback(message);
        }
    }

}

module.exports = Client;