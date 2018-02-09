# wsswitch-client-js

## Classes

### Client

This class allow user to connect with a wsswitch server.

#### Constructor

```javascript
let client = new Client(wsswitch_url) // default "wsswitch_url" value: wss://wsswitch.com
```

#### Methods

##### connect

```javascript
// pass entity login ans password as parameters
// connect returns a promise that will resolve if connection succeed or reject of the connection fail
// connect throws an exception if connection is already open
let connectPromise = client.connect(login, password); 
```

##### disconnect

```javascript
// disconnect throws an exception if connection is closed
client.disconnect(); 
```
