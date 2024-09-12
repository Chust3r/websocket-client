# WebSocket Client

This project provides a WebSocket client for managing WebSocket connections, handling events, and enabling reconnection strategies with optional message compression. It serves as an abstraction over the native WebSocket API and ensures compatibility across different environments.

## Table of Contents

-  [Features](#features)
-  [Installation](#installation)
-  [Usage](#usage)
-  [API Reference](#api-reference)
   -  [Constructor](#constructor)
   -  [Message Structure](#structure)
   -  [Methods](#methods)
-  [License](#license)
-  [Contributing](#contributing)

## Features

-  Automatic reconnection with configurable retry options
-  Event handling for connection, disconnection, and errors
-  Message queuing during reconnection
-  Optional message compression using a simple implementation of [pako](https://github.com/nodeca/pako)
-  Customizable WebSocket configuration

## Installation

To install and use the WebSocket client in your project, run the following command:

```bash
npm install @chust3r/websocket-client
```

## Usage

To use the WebSocketClient in your application, import it and create an instance by providing the WebSocket server URL and optional configuration options.

```ts
import { WebSocketClient } from '@chust3r/websocket-client'

const ws = new WebSocketClient('ws://example.com')

// Listen for connection events
ws.on('connect', () => {
	console.log('Connected')

	// Listen for message events
	ws.on('message', (data) => {
		console.log('Message received:', data)
	})
})

// Listen for error events
ws.on('error', (error) => {
	console.error('Error:', error)
})

// Listen for disconnection events
ws.on('disconnect', () => {
	console.log('Disconnected')
})
```

## API Reference

### Constructor

```ts
constructor(url: string, options?: Options)
```

### Parameters

`url`: `string`
The WebSocket server URL to connect to. This is a mandatory parameter that specifies the location of the WebSocket server.

`options`: `Options` (optional)
An optional configuration object for the WebSocket connection. It can include:

-  **`reconnect`**: `boolean` (default: `false`)  
   Indicates whether the client should automatically reconnect to the server if the connection is lost.

-  **`reconnectInterval`**: `number` (default: `1000`)  
   The interval (in milliseconds) to wait before attempting to reconnect after a disconnection.

-  **`reconnectAttempts`**: `number` (default: `5`)  
   The maximum number of reconnection attempts before giving up.

-  **`useCompression`**: `boolean`  
   Whether to use compression for the messages sent over the WebSocket connection.

## Message Structure

### `IncommingMessage`

The structure used for managing incoming and outgoing messages is defined as follows:

```ts
interface IncommingMessage {
	timestamp: string //→ Timestamp in formatted ISO 8601 string
	event: string //→ Used to identify the type of event
	data?: any //→ The data payload of the message
}
```

#### Description

-  **`timestamp`: `string`**  
   This property holds the timestamp of the message in ISO 8601 format (e.g., `2024-09-12T12:34:56Z`). This format is widely used for date and time representation and ensures consistency across different systems and languages.

-  **`event`: `string`**  
   The event property is crucial for filtering handlers in the WebSocket client. When sending or receiving messages, the event property specifies the type of action or information being conveyed. Handlers can listen for specific events, allowing for more organized and manageable event handling. For example, if an event is related to a user connection, handlers can be set up to respond only to that particular event.

-  **`data?`: `any`**  
   The data property is optional and can contain any additional information related to the event. It can be of any type, such as a string, number, object, or array. This flexibility allows developers to pass custom data along with the event, facilitating rich communication between the client and server.

## Methods

### Listen to events with `on`

This method is used to register event listeners for the WebSocket connection events.

Default event listeners include:

-  **`connect`**: Triggered when the WebSocket connection is established.
-  **`disconnect`**: Triggered when the WebSocket connection is disconnected.
-  **`error`**: Triggered when there is an error in the WebSocket connection.
-  **`reconnect_attempt`**: Triggered when the WebSocket client attempts to reconnect to the server.
-  **`reconnect_failed`**: Triggered when the WebSocket client fails to reconnect after reaching the maximum number of attempts.

```ts
ws.on('connect', () => {
	console.log('Connected')
})

ws.on('disconnect', () => {
	console.log('Disconnected')
})

ws.on('error', (error) => {
	console.error('Error:', error)
})

ws.on('reconnect_attempt', () => {
	console.log('Reconnecting...')
})

ws.on('reconnect_failed', () => {
	console.log('Reconnection failed')
})
```

You can also register custom event listeners.

```ts
ws.on('connect', () => {
	ws.on('message', (data) => {
		console.log('Message received:', data)
	})
})
```

### Listen events with `once`

This method is used to register an event listener that will be triggered only once.

```ts
ws.once('connect', () => {
	console.log('Connected')
})
```

### Listen all events with `onAny`

This method is used to register an event listener that will be triggered for all events except events in the EventMap interface as `connect`, `disconnect`,`reconnect_attempt`, `reconnect_failed`,and `error`.

```ts
ws.onAny((event, data) => {
	console.log(event, data)
})
```

### Emit events with `emit`

This method is used to emit events to the WebSocket server.

```ts
ws.on('connect', () => {
	ws.emit('message', 'Hello, server!')

	ws.emit('test', {
		foo: 'bar',
		quux: 'baz',
	})
})
```

If the client is not connected, the message is queued for later transmission. Otherwise, it is sent immediately.

### Close the WebSocket connection with `disconnect`

This method is used to close the WebSocket connection.

```ts
ws.on('connect', () => {
	ws.disconnect()
})
```

### Get raw WebSocket instance with `getRawSocket`

This method is used to get the raw WebSocket instance.

```ts
ws.getRawSocket()
```

### Get the WebSocket Connection State with `getStatus`

This method is used to retrieve the current state of the WebSocket connection. It returns the status of the connection, which can help you manage your application’s behavior based on the connection state.

```ts
ws.getStatus()
```

#### There are three possible connection states:

-  **`connected`**: The WebSocket client is connected to the server.
-  **`disconnected`**: The WebSocket client is disconnected from the server.
-  **`reconnecting`**: The WebSocket client is reconnecting to the server.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/Chust3r/websocket-client/blob/main/LICENSE) file for more details.

## Contributing

Contributions are welcome! Here are some guidelines to help you get started:

### How to Contribute

1. **Fork the repository**: Click the "Fork" button in the top right corner of the repository page to create a copy in your GitHub account.

2. **Clone your fork**: Clone your fork to your local machine using the following command:

```bash
   git clone https://github.com/your-username/repository-name.git
```

3. **Create a new branch**: Before making changes, create a new branch for your feature or bug fix:

```bash
git checkout -b my-new-feature
```

4. **Add your changes**: Make your changes: Make the necessary changes and be sure to test them.

5. **Commit your changes**: Commit your changes using the following command:

```bash
git add .
git commit -m "Description of the changes"
```

6. **Push your changes**: Push your changes to your fork using the following command:

```bash
git push origin my-new-feature
```

7. **Create a pull request**: Go to your fork's page on GitHub and click on "New Pull Request." Then, choose the branch you created and follow the instructions to submit your Pull Request.

## Contributors

<a href="https://github.com/Chust3r/websocket-client/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Chust3r/websocket-client" />
</a>
