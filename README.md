# wsswitch-client-js

## Classes

### Client

This class allow user to connect with a wsswitch server.

#### Constructor

```javascript
// url is 'wss://wsswitch.com' by default
let client = new Client(url);
```

#### Methods

##### connect

```javascript
// login is the wsswitch entity login
// password is the wsswitch entity password
// connect returns a promise that will resolve if connection succeed or reject if the connection fail
// connect throws an exception if connection is already open
let connectPromise = client.connect(login, password); 
```

##### disconnect

```javascript
// disconnect throws an exception if connection is closed
client.disconnect(); 
```

##### on

```javascript
// on can listen three events: message, close and error
// on message will fire the callback function with received message
// on error will fire the callback function with client connection error
// on close will fire the callback function when connection close
client.on(event, callback); 
```

##### sendMessage

```javascript
// message is a message instance
// protocol is 'sump' by default (only 'sump' is supported)
// version is '1.0' by default (only '1.0' is supported)
// sendMessage throws an exception if message is not a message instance
let messagePromise = client.sendMessage(message, protocol, version); 
```

##### countPendingMessages

```javascript
// return the number of pending messages (not resolved and not rejected yet)
let pendingMessagesQuantity = client.countPendingMessages(); 
```

##### rejectAllPendingMessages

```javascript
// force client rejects all pending messages with 'forced rejection by client'
client.rejectAllPendingMessages(); 
```


##### resolveAllPendingMessages

```javascript
// force client resolve all pending messages with 'forced resolution by client'
client.resolveAllPendingMessages(); 
```
