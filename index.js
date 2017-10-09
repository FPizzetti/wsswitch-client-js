const Client = require('./Client');
const Message = require('./Message');
const ConnectionManager = require('./ConnectionManager');

if (window) {
    window.WSSWITCH = {
        Client,
        Message,
        ConnectionManager
    };
}

exports.Client = Client;
exports.Message = Message;
exports.ConnectionManager = ConnectionManager;