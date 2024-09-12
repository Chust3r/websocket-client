import type { ICompressor } from './compressor'
import { PakoCompressor } from './compressor'

/**
 * @interface
 *
 * Represents the mapping of event names to their corresponding event handler functions
 * for the WebSocket client.
 *
 * @property {function(data: Event): void} connect - Handler called when the client successfully
 *                                                    connects to the WebSocket server.
 * @property {function(data: CloseEvent): void} disconnect - Handler called when the client
 *                                                          disconnects from the WebSocket server.
 * @property {function(data: Error): void} error - Handler called when an error occurs during
 *                                                  the WebSocket connection.
 * @property {function(data: number): void} reconnect_attempt - Handler called when a reconnection
 *                                                             attempt is made, providing the attempt
 *                                                             count.
 * @property {function(data: number): void} reconnect_failed - Handler called when reconnection
 *                                                             attempts fail, providing the total
 *                                                             attempts made.
 */

interface EventMap {
	connect: (data: Event) => void
	disconnect: (data: CloseEvent) => void
	error: (data: Error) => void
	reconnect_attempt: (data: number) => void
	reconnect_failed: (data: number) => void
}

/**
 * @enum {string}
 * @readonly
 * Represents the connection status of the WebSocket client.
 */

enum ConnectionStatus {
	CONNECTED = 'connected',
	DISCONNECTED = 'disconnected',
	RECONNECTING = 'reconnecting',
}

/**
 * @interface
 *
 * Represents the configuration options for the WebSocket client.
 *
 * @property {boolean} [reconnect] - Indicates whether the client should automatically reconnect
 *                                   to the server if the connection is lost. Defaults to false.
 * @property {number} [reconnectInterval] - The interval (in milliseconds) to wait before attempting
 *                                           to reconnect after a disconnection. Defaults to 1000.
 * @property {number} [reconnectAttempts] - The maximum number of reconnection attempts before giving up.
 *                                           Defaults to 5.
 * @property {boolean} useCompression - Whether to use compression or not.
 */

interface Options {
	reconnect?: boolean
	reconnectInterval?: number
	reconnectAttempts?: number
	useCompression: boolean
}

/**
 * @interface
 *
 * Represents an incoming message from the WebSocket server.
 *
 * @property {string} timestamp - The timestamp of when the message was received, formatted as an ISO 8601 string.
 * @property {string} event - The event type associated with the message.
 * @property {any} [data] - The data payload of the message, which can be of any type. This property is optional.
 */

interface IncommingMessage {
	timestamp: string
	event: string
	data?: any
}

/**
 * @class
 *
 * Represents a WebSocket client for connecting to a WebSocket server.
 * This client handles connection management, event listening,
 * message queuing, and reconnection strategies.
 *
 * @example
 * const client = new WebSocketClient('ws://example.com', {
 *     reconnect: true,
 *     reconnectAttempts: 10,
 *     reconnectInterval: 2000,
 * });
 *
 * client.on('message', (msg) => {
 *     console.log('Received message:', msg);
 * });
 *
 * client.connect();
 */

export class WebSocketClient {
	/**
	 * The WebSocket connection instance.
	 * @type {WebSocket}
	 * @private
	 */

	private ws!: WebSocket

	/**
	 * The URL of the WebSocket server to connect to.
	 * @type {string}
	 */

	private url: string

	/**
	 * Indicates whether the client is currently connected to the server.
	 * @type {boolean}
	 * @default false
	 */

	private isConnected: boolean = false

	/**
	 * Represents the current connection status of the WebSocket client.
	 *
	 * @type {ConnectionStatus}
	 * @default ConnectionStatus.DISCONNECTED
	 */

	private status: ConnectionStatus = ConnectionStatus.DISCONNECTED

	/**
	 * Configuration options for the WebSocket connection.
	 * @type {Options}
	 * @default { reconnect: false, reconnectAttempts: 5, reconnectInterval: 1000 }
	 */

	private options: Options = {
		reconnect: false,
		reconnectAttempts: 5,
		reconnectInterval: 1000,
		useCompression: false,
	}

	/**
	 * The compressor used for message compression.
	 * @type {ICompressor}
	 * @private
	 * @description This property holds an instance of the compressor that implements the ICompressor interface.
	 * It is used to compress messages before they are sent over the WebSocket connection when compression is enabled.
	 */

	private compressor!: ICompressor

	/**
	 * A queue for incoming messages that are waiting to be sent.
	 * @type {IncommingMessage[]}
	 * @default []
	 */

	private eventQueue: IncommingMessage[] = []

	/**
	 * A map of event listeners for various events.
	 * @type {Object<string, Function[]>}
	 * @default {}
	 */

	private eventListeners: { [key: string]: Function[] } = {}

	/**
	 * The number of attempts to reconnect to the server.
	 * @type {number}
	 * @default 0
	 */

	private reconnectAttempts: number = 0

	/**
	 * Creates an instance of the class and initializes the WebSocket connection.
	 *
	 * The constructor accepts a WebSocket URL and optional configuration options.
	 * It sets up the WebSocket connection and merges any provided options with the default options.
	 *
	 * @param {string} url - The URL of the WebSocket server to connect to.
	 * @param {Options} [options] - Optional configuration settings for the WebSocket connection.
	 *
	 * @property {string} url - The WebSocket server URL.
	 * @property {Options} options - Configuration options for the WebSocket connection.
	 */

	constructor(url: string, options?: Options) {
		this.url = url
		this.options = { ...this.options, ...options }

		if (this.options.useCompression) {
			this.compressor = new PakoCompressor()
		}

		this.setup()
	}

	/**
	 * Initializes the WebSocket connection.
	 *
	 * This method is responsible for setting up the initial connection to the
	 * WebSocket server by calling the `connection` method. It is typically
	 * invoked during the instance initialization process.
	 *
	 * @returns {void}
	 */

	private setup(): void {
		this.connection()
	}

	/**
	 * Flushes the event queue by sending all queued messages over the WebSocket connection.
	 *
	 * This method checks if the WebSocket is connected before attempting to send messages.
	 * If compression is enabled, messages will be compressed before sending.
	 * Any errors that occur during the sending process will be logged to the console.
	 *
	 * @returns {void}
	 *
	 * @throws {Error} Throws an error if sending messages fails.
	 */

	private flushQueue(): void {
		if (!this.isConnected) {
			console.warn('Cannot flush queue: WebSocket is not connected.')
			return
		}

		const sendPromises = this.eventQueue.map((m) => {
			let msg: string | Uint8Array = JSON.stringify(m)

			if (this.options.useCompression && this.compressor) {
				msg = this.compressor.compress(msg)
			}

			return new Promise<void>((resolve, reject) => {
				try {
					this.ws.send(msg)
					resolve()
				} catch (error) {
					reject(error)
				}
			})
		})

		Promise.all(sendPromises)
			.then(() => {})
			.catch((error) => {
				console.error('Error sending messages:', error)
			})

		this.eventQueue = []
	}

	/**
	 * Establishes a WebSocket connection to the specified URL.
	 *
	 * This method initiates a WebSocket connection. If an existing connection is present, it will be closed
	 * before creating a new one. It sets up event listeners for connection, disconnection, errors, and incoming messages.
	 *
	 * When the connection is successfully opened, it triggers the 'connect' event and flushes any queued messages.
	 * If the connection is closed, it triggers the 'disconnect' event and initiates reconnection logic if enabled.
	 *
	 * @returns {void}
	 */

	private connection(): void {
		if (this.ws) {
			this.ws.close()
		}

		try {
			const websocket = new WebSocket(this.url)
			this.ws = websocket

			websocket.addEventListener('open', (event) => {
				this.isConnected = true
				this.status = ConnectionStatus.CONNECTED
				this.reconnectAttempts = 0
				this.trigger('connect', event)
				this.flushQueue()
			})

			websocket.addEventListener('close', (event) => {
				this.isConnected = false
				this.status = ConnectionStatus.DISCONNECTED
				this.trigger('disconnect', event)
				if (this.options.reconnect) {
					this.reconnect()
				}
			})

			websocket.addEventListener('error', (event) => {
				this.trigger('error', event)
			})

			websocket.addEventListener('message', async ({ data }) => {
				try {
					let messageData

					if (data instanceof Blob) {
						const arrayBuffer = await new Promise<ArrayBuffer>(
							(resolve, reject) => {
								const reader = new FileReader()
								reader.onload = () =>
									resolve(reader.result as ArrayBuffer)
								reader.onerror = reject
								reader.readAsArrayBuffer(data)
							}
						)

						messageData =
							this.options.useCompression && this.compressor
								? this.compressor.decompress(
										new Uint8Array(arrayBuffer)
								  )
								: new TextDecoder().decode(arrayBuffer)
					} else {
						messageData = data
					}

					const parsedMessageData = JSON.parse(
						messageData
					) as IncommingMessage
					this.trigger('*', parsedMessageData)
					this.trigger(parsedMessageData.event, parsedMessageData)
				} catch (e) {
					this.trigger('error', {
						message: 'Failed to parse message',
						error: e,
					})
				}
			})
		} catch (e) {
			this.trigger('error', e)
		}
	}

	/**
	 * Attempts to reconnect to the server after a connection failure.
	 *
	 * This method implements the reconnection logic, incrementing the number of
	 * attempts and triggering relevant events. It will keep trying to reconnect
	 * until it either successfully establishes a connection or reaches the
	 * maximum number of allowed attempts.
	 *
	 * If the maximum number of reconnection attempts is reached, it triggers the
	 * 'reconnect_failed' event.
	 *
	 * @returns {void}
	 */

	private reconnect(): void {
		if (this.status === ConnectionStatus.DISCONNECTED) {
			if (this.reconnectAttempts < (this.options.reconnectAttempts || 5)) {
				this.reconnectAttempts++
				this.status = ConnectionStatus.RECONNECTING
				this.trigger('reconnect_attempt', this.reconnectAttempts)
				setTimeout(() => this.connection(), this.options.reconnectInterval)
			} else {
				this.trigger('reconnect_failed', this.reconnectAttempts)
			}
		}
	}

	/**
	 * Triggers an event, invoking all registered handlers for that event.
	 *
	 * This method calls all event listeners associated with the specified event name,
	 * passing any additional arguments to the handler functions.
	 *
	 * @param {string} eventName - The name of the event to trigger.
	 * @param {...any[]} args - Additional arguments to pass to the event handlers when the event is triggered.
	 *
	 * @returns {void}
	 */

	private trigger(eventName: string, ...args: any[]): void {
		if (!this.eventListeners[eventName]) return

		this.eventListeners[eventName].forEach((handler) => {
			handler(...args)
		})
	}

	/**
	 * Registers an event listener for the specified event.
	 *
	 * This method allows you to attach a handler function to an event, which will be invoked
	 * whenever the event is emitted. It supports multiple signatures to handle different
	 * types of event handlers.
	 *
	 * @template K - The type of the event name, extending from the keys of EventMap.
	 * @param {K} eventName - The name of the event to listen for.
	 * @param {EventMap[K]} handler - The function to be called when the event is emitted.
	 *                                It receives parameters based on the event type defined in EventMap.
	 *
	 * @param {string} eventName - A string representing the name of the event to listen to.
	 * @param {(args: IncommingMessage) => void} handler - A function that takes an
	 *                                                       `IncommingMessage` as an argument.
	 *
	 * @param {string} eventName - A string representing the name of the event to listen to.
	 * @param {...any[]} handler - A function that takes any number of arguments.
	 *
	 * @returns {void}
	 */

	public on<K extends keyof EventMap>(eventName: K, handler: EventMap[K]): void
	public on(eventName: string, handler: (args: IncommingMessage) => void): void
	public on(eventName: string, handler: (...args: any[]) => void) {
		if (!this.eventListeners[eventName]) {
			this.eventListeners[eventName] = []
		}
		this.eventListeners[eventName].push(handler)
	}

	/**
	 * Registra un manejador que se ejecutará para cualquier evento.
	 *
	 * @param {function} handler - La función que se ejecutará cuando ocurra un evento.
	 * Recibe un objeto `IncommingMessage` como argumento.
	 */
	public onAny(handler: (data: IncommingMessage) => void): void {
		let eventName = '*'
		if (!this.eventListeners[eventName]) {
			this.eventListeners[eventName] = []
		}
		this.eventListeners[eventName].push(handler)
	}

	/**
	 * Emits an event with the specified name and data to the WebSocket server.
	 *
	 * This method creates a message object containing the event name,
	 * a timestamp, and the provided data. If the WebSocket is not connected,
	 * the message is queued for later transmission. Otherwise, the message
	 * is sent immediately.
	 *
	 * @param {string} eventName - The name of the event to emit.
	 * @param {T} data - The data associated with the event.
	 * @returns {Promise<void>} A promise that resolves when the message is sent,
	 *                          or is queued if the socket is not connected.
	 * @throws {Error} If there is an error during message sending.
	 */

	public emit(
		eventName: string,
		data: IncommingMessage['data']
	): Promise<void> {
		let m: IncommingMessage = {
			timestamp: new Date().toISOString(),
			event: eventName,
			data,
		} as IncommingMessage

		if (!this.isConnected) {
			this.eventQueue.push(m)
			return Promise.resolve()
		}

		return new Promise((resolve, reject) => {
			try {
				let msg: string | Uint8Array = JSON.stringify(m)

				if (this.options.useCompression && this.compressor) {
					msg = this.compressor.compress(msg)
				}

				this.ws.send(msg)

				resolve()
			} catch (error) {
				reject(error)
			}
		})
	}

	/**
	 * Retrieves the underlying WebSocket instance.
	 *
	 * This method returns the raw WebSocket object used for communication.
	 * It can be useful when you need direct access to the WebSocket instance
	 * for operations that are not abstracted by this client.
	 *
	 * @returns {WebSocket} The raw WebSocket instance.
	 */

	public getRawSocket(): WebSocket {
		return this.ws
	}

	/**
	 * Closes the WebSocket connection and marks the client as disconnected.
	 *
	 * This method will set the `isConnected` flag to `false` and close the active WebSocket connection.
	 * It can be used to gracefully disconnect the client from the server.
	 */

	public disconnect() {
		this.isConnected = false
		this.status = ConnectionStatus.DISCONNECTED
		this.ws.close()
	}

	/**
	 * Removes a specific event handler for the given event.
	 *
	 * This method will unregister a handler that was previously added for a specific event.
	 * If the event or handler doesn't exist, it simply returns without doing anything.
	 *
	 * @template K - Event type, must be one of the keys of the EventMap.
	 * @param {K} eventName - The name of the event from which to remove the handler.
	 * @param {EventMap[K]} handler - The event handler to remove.
	 *
	 * @private
	 */

	private off<K extends keyof EventMap>(
		eventName: K,
		handler: EventMap[K]
	): void {
		if (!this.eventListeners[eventName]) return

		this.eventListeners[eventName] = this.eventListeners[eventName].filter(
			(h) => h !== handler
		)
	}

	/**
	 * Registers an event handler that will be executed only once for a specific event.
	 *
	 * This method allows the provided `handler` to be executed only the first time
	 * the specified event is triggered, and then automatically removes the handler.
	 *
	 * @template K - Event type, must be a key of the `EventMap` interface.
	 * @param {K} eventName - The name of the event to listen for.
	 * @param {EventMap[K]} handler - The function to be called when the event is triggered.
	 */

	public once<K extends keyof EventMap>(
		eventName: K,
		handler: EventMap[K]
	): void {
		const wrappedHandler = (...args: any[]) => {
			// @ts-ignore
			handler(...args)
			this.off(eventName, wrappedHandler)
		}

		this.on(eventName, wrappedHandler)
	}

	/**
	 * Get the current connection status.
	 *
	 * @returns {ConnectionStatus} The current connection status.
	 */
	public getStatus(): ConnectionStatus {
		return this.status
	}
}
