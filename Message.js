class Message {

    constructor(destination, payload, options = {}) {
        if(typeof options !== 'object' || Array.isArray(options)) {
            throw 'options must be an object';
        }
        this.ref = options.ref;
        this.type = options.type;
        this.destination = destination;
        this.echo = options.echo;
        this.ackRequired = options.ackRequired;
        this.payload = payload;
    }

    toString() {
        return JSON.stringify(this);
    }
}

module.exports = Message;
