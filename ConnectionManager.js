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