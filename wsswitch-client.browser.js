(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
const WebsocketClient = require('websocket');
const Message = require('./Message');
const uuid = require('uuid');

class Client {

    constructor(url = 'wss://wsswitch.com') {
        this.type = WebsocketClient.client ? 'node' : 'web';
        let WSC = WebsocketClient.client || WebsocketClient.w3cwebsocket;
        this.messageMap = {};
        this.url = url;
        this.websocketClient = this.type === 'node' ? new WSC() : WSC;
        this.connection = {connected: false};
        this.arMessageTimeout = 60000;
        this.ffMessageTimeout = 2000;
        this.onMessageCallback = null;
        this.onErrorCallback = null;
        this.onCloseCallback = null;
    }

    connect(login, password) {
        if (!login || !password) {
            throw new Error('missing login or password');
        }

        if(this.connection.connected) {
            throw new Error('already connected');
        }

        let WSC = this.websocketClient;

        return new Promise((resolve, reject) => {
            let onConnectFail = (error) => {
                if (this.type === 'node') {
                    this.websocketClient.removeListener('connect', onConnect);
                } else {
                    this.websocketClient = WSC;
                    this.connection.connected = false;
                }
                reject(error ? error.toString(): null);
            };
            let onConnect = (connection) => {
                this.connection = connection;
                connection.on('close', this._onClose.bind(this, onConnectFail));
                connection.on('message', this._onMessage.bind(this));
                if (this.type === 'node') {
                    connection.on('error', this._onError.bind(this));
                    this.websocketClient.removeListener('connectFailed', onConnectFail);
                    resolve();
                } else {
                    connection.on('error', onConnectFail);
                    connection.on('open', resolve);
                    this.connection.connected = true;
                    this.connection.sendUTF = this.websocketClient.send;
                }
            };
            if (this.type === 'node') {
                this.websocketClient.once('connectFailed', onConnectFail);
                this.websocketClient.once('connect', onConnect);
                this.websocketClient.connect(`${this.url}?login=${login}&password=${password}`);
            } else {
                try {
                    this.websocketClient = new this.websocketClient(`${this.url}?login=${login}&password=${password}`);
                    this.websocketClient.on = (event, cb) => {
                        this.websocketClient[`on${event}`] = cb;
                    };
                    onConnect(this.websocketClient);
                } catch (e) {
                    onConnectFail(e);
                }
            }
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
        for (let ref in messageMap) {
            if (messageMap.hasOwnProperty(ref)) {
                let m = messageMap[ref];
                m.reject('forced rejection by client');
                delete this.messageMap[ref];
            }
        }
    }

    resolveAllPendingMessages() {
        let messageMap = Object.assign({}, this.messageMap);
        for (let ref in messageMap) {
            if (messageMap.hasOwnProperty(ref)) {
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
        if (this.type !== 'node') {
            this.connection.connected = false;
        }
        if (this.onErrorCallback) {
            this.onErrorCallback(error);
        }
    }

    _onClose(onConnectionFail) {
        if (this.type !== 'node') {
            onConnectionFail();
        }
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    _onMessage(message) {
        if (this.type === 'node') {
            if (message.type === 'utf8') {
                message = message.utf8Data;
            } else {
                console.error('unsupported message format');
                console.error(message);
                return;
            }
        } else {
            message = message.data;
        }
        let err = message.match(/^ERROR:(.*):(.*)$/);
        if (err) {
            let ref = err[1];
            let payload = err[2];
            if (ref) {
                let m = this.messageMap[ref];
                if (m) {
                    clearTimeout(m.timeoutId);
                    m.reject(payload);
                }
            }
            return;
        }
        let ack = message.match(/^ACK:(.*)$/);
        if (ack) {
            let ref = ack[1];
            if (ref) {
                let m = this.messageMap[ref];
                if (m) {
                    clearTimeout(m.timeoutId);
                    m.resolve();
                }
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
},{"./Message":3,"uuid":5,"websocket":10}],2:[function(require,module,exports){
const MAX_TRIES = 'MAX_TRIES';
const FIXED_INTERVAL_RETRY = 'FIXED_INTERVAL_RETRY';
const PROGRESSIVE_INTERVAL_RETRY = 'PROGRESSIVE_INTERVAL_RETRY';

const Client = require('./Client');

class ConnectionManager {
    constructor(client, strategy = MAX_TRIES, options = {}) {
        if (!(client instanceof Client)) {
            throw new Error('client must be an instance of Client class');
        }
        this.strategies = ConnectionManager.getStrategies();
        if (Object.keys(this.strategies).indexOf(strategy) < 0) {
            throw new Error('invalid strategy');
        }
        this.client = client;
        this.strategy = strategy;
        this.counter = 0;
        this.sequence = 0;
        this.lastTry = null;
        this._connect = null;
        this.options = options;
        this.enableConsoleLog = false;
        this.onDisconnect = null;
    }

    connect(login, password) {
        this._connect = this.client.connect.bind(this.client, login, password);
        this.counter++;
        this.sequence++;
        this.lastTry = Date.now();
        this.client.on('error', this._onDisconnect.bind(this));
        if (this.client.type === 'node') {
            this.client.on('close', this._onDisconnect.bind(this));
        }
        return this._connect().then(() => {
            this.sequence = 1;
        }, (error) => {
            this._onDisconnect(error);
            throw error;
        });
    }

    static getStrategies() {
        return {MAX_TRIES, FIXED_INTERVAL_RETRY, PROGRESSIVE_INTERVAL_RETRY};

    }

    getConnectionSummary() {
        return {
            counter: this.counter,
            sequence: this.sequence,
            lastTry: this.lastTry,
            strategy: this.strategy,
            options: this.options,
            enableConsoleLog: this.enableConsoleLog
        }
    }

    setEnableConsoleLog(enable) {
        this.enableConsoleLog = enable;
    }

    forceReconnect() {
        if (this.client.connection.connected) {
            return Promise.reject('already connected');
        } else {
            return this._connReset();
        }
    }

    setDisconnectedListener(cb) {
        if (typeof cb !== 'function') {
            throw new Error('callback must be a function');
        }
        this.onDisconnect = cb;
    }


    _execConnectionManagerStrategy(error) {
        switch (this.strategy) {
            case MAX_TRIES:
                return this._maxTriesAction(error);
            case FIXED_INTERVAL_RETRY:
                return this._fixedIntervalRetry(error);
            case PROGRESSIVE_INTERVAL_RETRY:
                return this._progressiveIntervalRetry(error);
        }
    }

    _onDisconnect(error) {
        if (this._execConnectionManagerStrategy) {
            setTimeout(this._execConnectionManagerStrategy.bind(this, error));
        }
        if (this.onDisconnect) {
            setTimeout(this.onDisconnect.bind(this, error));
        }
    }

    _maxTriesAction(error) {
        this._logError(error);
        let tries = this._getOption('maxTries') || 3;
        if (this.sequence < tries) {
            this._connReset();
        } else {
            throw new Error(`fail to connect, max retries (${tries}) is reached`);
        }
    }

    _fixedIntervalRetry(error) {
        this._logError(error);
        let interval = this._getOption('fixedInterval') || 10000;
        setTimeout(this._connReset.bind(this), interval);
    }

    _progressiveIntervalRetry(error) {
        this._logError(error);
        let initialInterval = this._getOption('initialProgressiveInterval') || 10000;
        let maxInterval = this._getOption('maxProgressiveInterval') || 3600000;
        let intervalProgression = this._getOption('intervalProgression') || 2;
        let progressionType = this._getOption('progressionType') || 'arithmetic';
        let interval = initialInterval;
        if (progressionType === 'geometric') {
            interval = initialInterval * Math.pow(intervalProgression, this.sequence - 1);
        } else if (progressionType === 'arithmetic') {
            interval = initialInterval + (this.sequence - 1) * (initialInterval * intervalProgression);
        }
        if (isNaN(interval)) {
            interval = initialInterval;
        }
        if (interval > maxInterval) {
            interval = maxInterval;
        }
        setTimeout(this._connReset.bind(this), interval);
    }

    _connReset() {
        this.counter++;
        this.sequence++;
        this.lastTry = Date.now();
        return this._connect().then(() => {
            this.sequence = 1;
        }, (error) => {
            this._onDisconnect(error);
            throw error;
        });
    }

    _logError(error) {
        if (this.enableConsoleLog) {
            console.error(error);
        }
    }

    _getOption(optionName) {
        if (this.options) {
            return this.options[optionName];
        }
        return undefined;
    }
}

module.exports = ConnectionManager;
},{"./Client":1}],3:[function(require,module,exports){
class Message {

    constructor(destination, payload, options = {}) {
        if(typeof options !== 'object' || Array.isArray(options)) {
            throw 'options must be an object';
        }
        this.ref = options.ref;
        this.type = options.type;
        this.destination = destination;
        this.echo = options.echo;
        this.fullResponse = options.fullResponse;
        this.ackRequired = options.ackRequired;
        this.payload = payload;
    }

    toString() {
        return JSON.stringify(this);
    }
}

module.exports = Message;
},{}],4:[function(require,module,exports){
const Client = require('./Client');
const Message = require('./Message');
const ConnectionManager = require('./ConnectionManager');

if (typeof window !== 'undefined') {
    window.WSSWITCH = {
        Client,
        Message,
        ConnectionManager
    };
}

exports.Client = Client;
exports.Message = Message;
exports.ConnectionManager = ConnectionManager;
},{"./Client":1,"./ConnectionManager":2,"./Message":3}],5:[function(require,module,exports){
var v1 = require('./v1');
var v4 = require('./v4');

var uuid = v4;
uuid.v1 = v1;
uuid.v4 = v4;

module.exports = uuid;

},{"./v1":8,"./v4":9}],6:[function(require,module,exports){
/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
var byteToHex = [];
for (var i = 0; i < 256; ++i) {
  byteToHex[i] = (i + 0x100).toString(16).substr(1);
}

function bytesToUuid(buf, offset) {
  var i = offset || 0;
  var bth = byteToHex;
  return bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]];
}

module.exports = bytesToUuid;

},{}],7:[function(require,module,exports){
(function (global){
// Unique ID creation requires a high quality random # generator.  In the
// browser this is a little complicated due to unknown quality of Math.random()
// and inconsistent support for the `crypto` API.  We do the best we can via
// feature-detection
var rng;

var crypto = global.crypto || global.msCrypto; // for IE 11
if (crypto && crypto.getRandomValues) {
  // WHATWG crypto RNG - http://wiki.whatwg.org/wiki/Crypto
  var rnds8 = new Uint8Array(16); // eslint-disable-line no-undef
  rng = function whatwgRNG() {
    crypto.getRandomValues(rnds8);
    return rnds8;
  };
}

if (!rng) {
  // Math.random()-based (RNG)
  //
  // If all else fails, use Math.random().  It's fast, but is of unspecified
  // quality.
  var rnds = new Array(16);
  rng = function() {
    for (var i = 0, r; i < 16; i++) {
      if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
      rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
    }

    return rnds;
  };
}

module.exports = rng;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],8:[function(require,module,exports){
var rng = require('./lib/rng');
var bytesToUuid = require('./lib/bytesToUuid');

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

// random #'s we need to init node and clockseq
var _seedBytes = rng();

// Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
var _nodeId = [
  _seedBytes[0] | 0x01,
  _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
];

// Per 4.2.2, randomize (14 bit) clockseq
var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

// Previous uuid creation time
var _lastMSecs = 0, _lastNSecs = 0;

// See https://github.com/broofa/node-uuid for API details
function v1(options, buf, offset) {
  var i = buf && offset || 0;
  var b = buf || [];

  options = options || {};

  var clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq;

  // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
  var msecs = options.msecs !== undefined ? options.msecs : new Date().getTime();

  // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock
  var nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1;

  // Time since last uuid creation (in msecs)
  var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

  // Per 4.2.1.2, Bump clockseq on clock regression
  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  }

  // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval
  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  }

  // Per 4.2.1.2 Throw error if too many uuids are requested
  if (nsecs >= 10000) {
    throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq;

  // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
  msecs += 12219292800000;

  // `time_low`
  var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff;

  // `time_mid`
  var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff;

  // `time_high_and_version`
  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
  b[i++] = tmh >>> 16 & 0xff;

  // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
  b[i++] = clockseq >>> 8 | 0x80;

  // `clock_seq_low`
  b[i++] = clockseq & 0xff;

  // `node`
  var node = options.node || _nodeId;
  for (var n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf ? buf : bytesToUuid(b);
}

module.exports = v1;

},{"./lib/bytesToUuid":6,"./lib/rng":7}],9:[function(require,module,exports){
var rng = require('./lib/rng');
var bytesToUuid = require('./lib/bytesToUuid');

function v4(options, buf, offset) {
  var i = buf && offset || 0;

  if (typeof(options) == 'string') {
    buf = options == 'binary' ? new Array(16) : null;
    options = null;
  }
  options = options || {};

  var rnds = options.random || (options.rng || rng)();

  // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;

  // Copy bytes to buffer, if provided
  if (buf) {
    for (var ii = 0; ii < 16; ++ii) {
      buf[i + ii] = rnds[ii];
    }
  }

  return buf || bytesToUuid(rnds);
}

module.exports = v4;

},{"./lib/bytesToUuid":6,"./lib/rng":7}],10:[function(require,module,exports){
var _global = (function() { return this; })();
var NativeWebSocket = _global.WebSocket || _global.MozWebSocket;
var websocket_version = require('./version');


/**
 * Expose a W3C WebSocket class with just one or two arguments.
 */
function W3CWebSocket(uri, protocols) {
	var native_instance;

	if (protocols) {
		native_instance = new NativeWebSocket(uri, protocols);
	}
	else {
		native_instance = new NativeWebSocket(uri);
	}

	/**
	 * 'native_instance' is an instance of nativeWebSocket (the browser's WebSocket
	 * class). Since it is an Object it will be returned as it is when creating an
	 * instance of W3CWebSocket via 'new W3CWebSocket()'.
	 *
	 * ECMAScript 5: http://bclary.com/2004/11/07/#a-13.2.2
	 */
	return native_instance;
}


/**
 * Module exports.
 */
module.exports = {
    'w3cwebsocket' : NativeWebSocket ? W3CWebSocket : null,
    'version'      : websocket_version
};

},{"./version":11}],11:[function(require,module,exports){
module.exports = require('../package.json').version;

},{"../package.json":12}],12:[function(require,module,exports){
module.exports={
  "_args": [
    [
      {
        "raw": "websocket",
        "scope": null,
        "escapedName": "websocket",
        "name": "websocket",
        "rawSpec": "",
        "spec": "latest",
        "type": "tag"
      },
      "/Users/murilo/WebstormProjects/wsswitch-client-js"
    ]
  ],
  "_from": "websocket@latest",
  "_id": "websocket@1.0.24",
  "_inCache": true,
  "_installable": true,
  "_location": "/websocket",
  "_nodeVersion": "7.3.0",
  "_npmOperationalInternal": {
    "host": "packages-12-west.internal.npmjs.com",
    "tmp": "tmp/websocket-1.0.24.tgz_1482977757939_0.1858439394272864"
  },
  "_npmUser": {
    "name": "theturtle32",
    "email": "brian@worlize.com"
  },
  "_npmVersion": "3.10.10",
  "_phantomChildren": {},
  "_requested": {
    "raw": "websocket",
    "scope": null,
    "escapedName": "websocket",
    "name": "websocket",
    "rawSpec": "",
    "spec": "latest",
    "type": "tag"
  },
  "_requiredBy": [
    "#USER",
    "/"
  ],
  "_resolved": "https://registry.npmjs.org/websocket/-/websocket-1.0.24.tgz",
  "_shasum": "74903e75f2545b6b2e1de1425bc1c905917a1890",
  "_shrinkwrap": null,
  "_spec": "websocket",
  "_where": "/Users/murilo/WebstormProjects/wsswitch-client-js",
  "author": {
    "name": "Brian McKelvey",
    "email": "brian@worlize.com",
    "url": "https://www.worlize.com/"
  },
  "browser": "lib/browser.js",
  "bugs": {
    "url": "https://github.com/theturtle32/WebSocket-Node/issues"
  },
  "config": {
    "verbose": false
  },
  "contributors": [
    {
      "name": "Iñaki Baz Castillo",
      "email": "ibc@aliax.net",
      "url": "http://dev.sipdoc.net"
    }
  ],
  "dependencies": {
    "debug": "^2.2.0",
    "nan": "^2.3.3",
    "typedarray-to-buffer": "^3.1.2",
    "yaeti": "^0.0.6"
  },
  "description": "Websocket Client & Server Library implementing the WebSocket protocol as specified in RFC 6455.",
  "devDependencies": {
    "buffer-equal": "^1.0.0",
    "faucet": "^0.0.1",
    "gulp": "git+https://github.com/gulpjs/gulp.git#4.0",
    "gulp-jshint": "^2.0.4",
    "jshint": "^2.0.0",
    "jshint-stylish": "^2.2.1",
    "tape": "^4.0.1"
  },
  "directories": {
    "lib": "./lib"
  },
  "dist": {
    "shasum": "74903e75f2545b6b2e1de1425bc1c905917a1890",
    "tarball": "https://registry.npmjs.org/websocket/-/websocket-1.0.24.tgz"
  },
  "engines": {
    "node": ">=0.8.0"
  },
  "gitHead": "0e15f9445953927c39ce84a232cb7dd6e3adf12e",
  "homepage": "https://github.com/theturtle32/WebSocket-Node",
  "keywords": [
    "websocket",
    "websockets",
    "socket",
    "networking",
    "comet",
    "push",
    "RFC-6455",
    "realtime",
    "server",
    "client"
  ],
  "license": "Apache-2.0",
  "main": "index",
  "maintainers": [
    {
      "name": "theturtle32",
      "email": "brian@worlize.com"
    }
  ],
  "name": "websocket",
  "optionalDependencies": {},
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/theturtle32/WebSocket-Node.git"
  },
  "scripts": {
    "gulp": "gulp",
    "install": "(node-gyp rebuild 2> builderror.log) || (exit 0)",
    "test": "faucet test/unit"
  },
  "version": "1.0.24"
}

},{}]},{},[4]);
