import type { ICompressor } from './compressor'
import { PakoCompressor } from './compressor'
import qs from 'query-string'

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
 * @interface
 *
 * Represents standard message for incoming and outgoing WebSocket messages.
 *
 * @property {string} timestamp - The timestamp of when the message was received, formatted as an ISO 8601 string.
 * @property {string} event - The event type associated with the message.
 * @property {any} [data] - The data payload of the message, which can be of any type. This property is optional.
 */

interface IMessage {
	timestamp: string
	event: string
	data?: any
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
 * @interface Options
 *
 * Represents the configuration options for the WebSocket client.
 *
 * @property {boolean} [reconnect] - Indicates whether the client should automatically reconnect
 *                                   to the server if the connection is lost. Defaults to false.
 * @property {number} [reconnectInterval] - The interval (in milliseconds) to wait before attempting
 *                                           to reconnect after a disconnection. Defaults to 1000.
 * @property {number} [reconnectAttempts] - The maximum number of reconnection attempts before giving up.
 *                                           Defaults to 5.
 * @property {boolean} useCompression - Whether to use compression for messages sent over the WebSocket.
 * @property {ICompressor} [compressor] - An optional custom compressor implementation to use for
 *                                          compressing and decompressing messages. By default, it uses
 *                                          a `pako` implementation.
 * @property {boolean} [heartbeat] - Indicates whether to enable heartbeat mechanism for detecting
 *                                   connection status. Defaults to false.
 * @property {number} [heartbeatInterval] - The interval (in milliseconds) for sending heartbeat
 *                                           messages. Defaults to 5000.
 * @property {Record<string, string | number | boolean>} [query] - An optional object containing query parameters to be
 *                                            appended to the URL of the WebSocket server.
 */
interface Options {
	reconnect?: boolean
	reconnectInterval?: number
	reconnectAttempts?: number
	useCompression?: boolean
	compressor?: ICompressor
	heartbeat?: boolean
	heartbeatInterval?: number
	query?: Record<string, string>
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
		heartbeat: false,
		heartbeatInterval: 10000,
		query: {},
	}

	/**
	 * If true, the client will attempt to reconnect to the server if the connection is lost.
	 * @type {boolean}
	 * @default false
	 */

	private shouldReconnect: boolean = true

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
	 * @type {IMessage[]}
	 * @default []
	 */

	private eventQueue: IMessage[] = []

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
	 *
	 * A set with the subscriptions that the client is currently subscribed to.
	 *
	 * @type {Set<string>}
	 *
	 * @default new Set()
	 */

	private subscriptions: Set<string> = new Set()

	/**
	 * Stores the timeout ID for the heartbeat interval, allowing it to be cleared later.
	 * This is used to periodically send heartbeat pings to the server.
	 *
	 * @type {NodeJS.Timeout}
	 */
	private heartbeatTimeout!: NodeJS.Timeout

	/**
	 * Tracks whether a 'pong' (heartbeat response) has been received from the server.
	 *
	 * - `true`: A pong response has been received.
	 * - `false`: No pong has been received yet after the last ping.
	 *
	 * This is reset to `false` after each ping and is set to `true` when a pong is received.
	 *
	 * @type {boolean}
	 */
	private heartbeatRecived: boolean = false

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
		this.options = { ...this.options, ...options }

		this.url = qs.stringifyUrl({ url, query: this.options.query })

		if (this.options.useCompression) {
			this.compressor = this.compressor || new PakoCompressor()
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
				if (this.options.heartbeat) {
					this.startHeartbeat()
				}
			})

			websocket.addEventListener('close', (event) => {
				this.isConnected = false
				this.status = ConnectionStatus.DISCONNECTED
				this.trigger('disconnect', event)
				if (this.options.reconnect && this.shouldReconnect) {
					this.reconnect()
				}
				if (this.options.heartbeat) {
					this.stopHeartbeat()
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

						if (this.options.useCompression && this.compressor) {
							messageData = this.compressor.decompress(
								new Uint8Array(arrayBuffer)
							)
						} else {
							messageData = new TextDecoder().decode(arrayBuffer)
						}
					} else {
						messageData = data
					}

					const parsedMessageData = JSON.parse(messageData) as IMessage

					if (this.options.heartbeat) {
						if (parsedMessageData.event === 'pong') {
							this.heartbeatRecived = true
						}
					}

					this.trigger('*', parsedMessageData)
					this.trigger(parsedMessageData.event, parsedMessageData)
				} catch (e) {
					console.error('Failed to parse WebSocket message:', data, e)
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
		if (
			this.status === ConnectionStatus.DISCONNECTED &&
			this.options.reconnect
		) {
			if (this.reconnectAttempts < this.options.reconnectAttempts!) {
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
	 * @param {(args: IMessage) => void} handler - A function that takes an
	 *                                                       `IMessage` as an argument.
	 *
	 * @param {string} eventName - A string representing the name of the event to listen to.
	 * @param {...any[]} handler - A function that takes any number of arguments.
	 *
	 * @returns {void}
	 */

	public on<K extends keyof EventMap>(eventName: K, handler: EventMap[K]): void
	public on(eventName: string, handler: (args: IMessage) => void): void
	public on(eventName: string, handler: (...args: any[]) => void) {
		if (!this.eventListeners[eventName]) {
			this.eventListeners[eventName] = []
		}
		this.eventListeners[eventName].push(handler)
	}

	/**
	 * Registers an event listener for any event.
	 *
	 * @param {function} handler - The function to be called when any event is emitted.
	 */
	public onAny(handler: (data: IMessage) => void): void {
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

	public emit(eventName: string, data: IMessage['data']): Promise<void> {
		let m: IMessage = {
			timestamp: new Date().toISOString(),
			event: eventName,
			data,
		} as IMessage

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
		this.shouldReconnect = false
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

	/**
	 * Subscribes the client to a specific topic.
	 *
	 * This method allows the client to receive messages sent to a
	 * particular topic. If the client is already subscribed to that
	 * topic, a warning will be displayed in the console.
	 *
	 * @param {string} topic - The name of the topic to subscribe to.
	 *
	 * @example
	 * // Subscribe to a topic
	 * ws.sub('chat/messages');
	 */
	public sub(topic: string) {
		if (this.subscriptions.has(topic)) {
			console.warn(`Subscription already exists: ${topic}`)
			return
		}
		this.emit('subscribe', { topic })
		this.subscriptions.add(topic)
	}

	/**
	 * Unsubscribes the client from a specific topic.
	 *
	 * This method allows the client to stop receiving messages from a
	 * particular topic. If the client is not subscribed to that topic,
	 * a warning will be displayed in the console.
	 *
	 * @param {string} topic - The name of the topic to unsubscribe from.
	 *
	 * @example
	 * // Unsubscribe from a topic
	 * ws.unsub('chat/messages');
	 */
	public unsub(topic: string) {
		if (!this.subscriptions.has(topic)) {
			console.warn(`Subscription not found: ${topic}`)
			return
		}
		this.subscriptions.delete(topic)
		this.emit('unsubscribe', { topic })
	}

	/**
	 * Publishes a message to a specific topic.
	 *
	 * This method sends a message to all clients subscribed to a
	 * particular topic. If there are no subscribers for the topic,
	 * a warning will be displayed in the console.
	 *
	 * @param {string} topic - The name of the topic to publish the message to.
	 * @param {IMessage['data']} data - The data of the message to be sent.
	 *
	 * @example
	 * // Publish a message to a topic
	 * ws.pub('chat/messages', { text: 'Hello, world!' });
	 */
	public pub(topic: string, data: IMessage['data']) {
		if (!this.subscriptions.has(topic)) {
			console.warn(`You are not subscribed: ${topic}`)
			return
		}
		this.emit('publish', { topic, data })
	}

	/**
	 * Returns the current list of subscriptions.
	 *
	 * This method retrieves all the topics that the client is currently
	 * subscribed to. It returns an array of topic names.
	 *
	 * @returns {string[]} An array of active subscription topics.
	 *
	 * @example
	 * // Get the current subscriptions
	 * const currentSubscriptions = ws.getSubscriptions();
	 * console.log(currentSubscriptions);
	 */

	public getCurrentSubscriptions(): string[] {
		return Array.from(this.subscriptions)
	}

	/**
	 * Starts the heartbeat mechanism to monitor the WebSocket connection.
	 * It sends a 'ping' (via the 'heartbeat' event) to the server at regular intervals.
	 * If a 'pong' (i.e., a response from the server) is not received within the expected time,
	 * the WebSocket connection is closed.
	 *
	 * - Emits the 'heartbeat' event when the WebSocket connection is open.
	 * - Resets the `heartbeatRecived` flag to `false` after each ping.
	 * - If no pong is received within the interval + 1 second, the connection is closed.
	 */
	private startHeartbeat(): void {
		const heartbeat = () => {
			if (this.ws.readyState === WebSocket.OPEN) {
				this.emit('ping', undefined)
				this.heartbeatRecived = false

				setTimeout(() => {
					if (!this.heartbeatRecived) {
						this.ws.close()
						this.stopHeartbeat()
					}
				}, this.options.heartbeatInterval! + 1000)
			}
		}

		this.heartbeatTimeout = setInterval(
			heartbeat,
			this.options.heartbeatInterval
		)
	}

	/**
	 * Stops the heartbeat mechanism.
	 * Clears the timeout for the heartbeat interval to stop sending pings.
	 */
	private stopHeartbeat(): void {
		clearInterval(this.heartbeatTimeout)
	}
}
