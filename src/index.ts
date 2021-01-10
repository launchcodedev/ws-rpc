import type WS from 'ws';
import type ReconnectingWS from 'reconnecting-websocket';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Json } from '@lcdev/ts';
import { nanoid } from 'nanoid';
import { logger } from './logging';
import { RpcError, ErrorType } from './errors';

export { LogLevel, setLogLevel } from './logging';
export * from './errors';

export type FunctionName = string;
export type EventName = string;

/** Correlated types for a function/RPC call */
export type FunctionVariant<
  T extends FunctionName,
  Data extends Serializable | void = void,
  ResponseData extends Serializable | void = void,
  Serializable = never
> = {
  request: {
    /** The FunctionName, which describes what kind of message it is */
    mt: T;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes with the message */
    data: Data;
  };
  response: {
    /** The FunctionName, which describes what kind of message it is */
    mt: T;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes back from the message */
    data: ResponseData;
  };
  error: {
    /** Marked for errors */
    err: true;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** Error description */
    message: string;
    /** Identifier of the error */
    code?: number | string;
    /** Any extra data attached to the error  */
    data?: Serializable;
  };
};

/** Correlated types for a bidirectional event */
export type EventVariant<
  T extends EventName,
  Data extends Serializable | void = void,
  Serializable = never
> = {
  /** The EventName, which describes what kind of event it is */
  ev: T;
  /** The data associated with the event (can be void) */
  data: Data;
};

/** Canonical type representing all request -> response types (client to server) */
export type FunctionVariants<FunctionTypes extends FunctionName = never, Serializable = unknown> = {
  [T in FunctionTypes]: FunctionVariant<T, Serializable, Serializable, Serializable>;
};

/** Canonical type for all events that can occur (bidirectional) */
export type EventVariants<EventTypes extends EventName = never, Serializable = unknown> = {
  [T in EventTypes]: EventVariant<T, Serializable, Serializable>;
};

// helper type for FunctionVariants
type AddFunctionVariant<
  Name extends FunctionName,
  RequestData extends Serializable | void,
  ResponseData extends Serializable | void,
  Serializable
> = {
  [k in Name]: FunctionVariant<Name, RequestData, ResponseData, Serializable>;
};

// helper type for EventVariants
type AddEventVariant<Name extends EventName, Data extends Serializable | void, Serializable> = {
  [k in Name]: EventVariant<Name, Data, Serializable>;
};

/** Callback returned that will cancel the registered listener */
export type CancelEventListener = () => void;

/** Common client/server functions to handle pub/sub of events */
export interface EventHandlers<Events extends EventVariants<EventName>> {
  /** Register an event handler */
  on<T extends keyof Events>(
    name: T,
    callback: (data: Events[T]['data']) => void,
  ): CancelEventListener;

  /** Register an event handler, only triggered once */
  once<T extends keyof Events>(
    name: T,
    callback: (data: Events[T]['data']) => void,
  ): CancelEventListener;

  /** Waits until an event is called once */
  one<T extends keyof Events>(name: T): Promise<Events[T]['data']>;

  /** Unregister an event handler */
  off<T extends keyof Events>(name: T, callback?: (data: Events[T]['data']) => void): void;

  /** Send an event to peer (server or client) */
  sendEvent<T extends keyof Events>(
    ...args: Events[T]['data'] extends void ? [T] : [T, Events[T]['data']]
  ): Promise<void>;
}

/** Callable function that proxies to a specific RPC call */
export type FunctionHandler<Function extends FunctionVariant<string, any, any, any>> = {
  (args: Function['request']['data'], timeoutMS?: number): Promise<Function['response']['data']>;
};

/** Callable functions that proxy to RPC calls. Available on client (calls server) and server (calls itself). */
export type FunctionHandlers<Functions extends FunctionVariants<FunctionName>> = {
  [F in keyof Functions]: FunctionHandler<Functions[F]>;
};

/** Common interface for websocket client (Browser, Node, etc), to avoid hard dependency on 'ws' library */
export interface WebSocketClient {
  binaryType?: string;
  readyState: number;

  addEventListener: {
    (method: 'open', cb: (event: {}) => void): void;
    (method: 'close', cb: (event: { code: number; reason: string }) => void): void;
    (method: 'error', cb: (event: { error: any; message: any; type: string }) => void): void;
    (method: 'message', cb: (event: { data: any; type: string }) => void): void;
  };

  removeEventListener: {
    (method: 'open', cb: (event: {}) => void): void;
    (method: 'close', cb: (event: { code: number; reason: string }) => void): void;
    (method: 'error', cb: (event: { error: any; message: any; type: string }) => void): void;
    (method: 'message', cb: (event: { data: any; type: string }) => void): void;
  };

  send(data: Serialized): void;
  close(): void;
}

/** Common interface for websocket server, to avoid hard dependency on 'ws' library */
export type WebSocketServer =
  | WebSocketServerInner<'addListener', 'removeListener'>
  | WebSocketServerInner<'addEventListener', 'removeEventListener'>
  | WebSocketServerInner<'on', 'off'>;

type WebSocketServerInner<AddListener extends string, RemoveListener extends string> = {
  binaryType?: string;

  close(): void;
} & {
  [A in AddListener]: {
    (event: 'connection', cb: (connection: WebSocketClient) => void): void;
    (event: 'close', cb: () => void): void;
    (event: 'error', cb: (error: Error) => void): void;
  };
} &
  {
    [R in RemoveListener]: {
      (event: 'connection', cb: (connection: WebSocketClient) => void): void;
      (event: 'close', cb: () => void): void;
      (event: 'error', cb: (error: Error) => void): void;
    };
  };

/** Common bidirectional type of a connected client or server (servers will call their own functions) */
export type Connection<
  Functions extends FunctionVariants<FunctionName>,
  Events extends EventVariants<EventName>
> = EventHandlers<Events> &
  FunctionHandlers<Functions> & {
    ping(timeoutMS?: number): Promise<void>;
    onError(cb: (error: Error) => void): CancelEventListener;
    onClose(cb: () => void): CancelEventListener;
    isClosed(): boolean;
    close(): Promise<void>;
  };

/** Configuration for using unix domain sockets */
export type UnixSocket = { socket: string };

/** Intermediate representation of a client type, that can connect to a server */
export type Client<
  Functions extends FunctionVariants<FunctionName>,
  Events extends EventVariants<EventName>
> = {
  connect(port: number, secure?: boolean): Promise<Connection<Functions, Events>>;
  connect(host: string, port: number, secure?: boolean): Promise<Connection<Functions, Events>>;
  connect(socket: UnixSocket): Promise<Connection<Functions, Events>>;
  connect(client: WebSocketClient): Promise<Connection<Functions, Events>>;
};

/** Intermediate representation of a server type, that can listen for connections */
export type Server<Functions extends FunctionVariants, Events extends EventVariants> = {
  listen(port: number): Promise<Connection<Functions, Events>>;
  listen(host: string, port: number): Promise<Connection<Functions, Events>>;
  listen(socket: UnixSocket): Promise<Connection<Functions, Events>>;
  listen(server: WebSocketServer): Promise<Connection<Functions, Events>>;
  listen(server: HttpServer): Promise<Connection<Functions, Events>>;
  listen(server: HttpsServer): Promise<Connection<Functions, Events>>;
};

/** Data type across the wire */
export type Serialized = string | ArrayBuffer;

/** Abstraction for data serialization (JSON, BSON, etc.) */
export interface DataSerialization<Serializable> {
  serialize(data: Serializable): Serialized | Promise<Serialized>;
  deserialize(data: Serialized): Serializable | Promise<Serializable>;
}

/** Basic JSON wire format (de)serialization */
export const jsonSerialization: DataSerialization<Json> = {
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

/** Function that validates incoming or outgoing data */
export type ValidationFunction<Data> = (data: Data) => (Error & { code?: number | string }) | false;

/** Common isomorphic builder type for a Client/Server pair */
export type Builder<
  Serializable,
  Functions extends FunctionVariants<FunctionName, Serializable> = FunctionVariants<
    never,
    Serializable
  >,
  Events extends EventVariants<EventName, Serializable> = EventVariants<never, Serializable>
> = {
  /** Adds a function type that can be called. Request validation is optional. */
  func: {
    <
      Name extends FunctionName = never,
      Request extends Serializable | void = void,
      Response extends Serializable | void = void
    >(): Builder<
      Serializable,
      Functions & AddFunctionVariant<Name, Request, Response, Serializable>,
      Events
    >;

    <
      Name extends FunctionName = never,
      Request extends Serializable | void = void,
      Response extends Serializable | void = void
    >(
      name: Name,
      validation: ValidationFunction<Request>,
    ): Builder<
      Serializable,
      Functions & AddFunctionVariant<Name, Request, Response, Serializable>,
      Events
    >;
  };

  /** Adds an event type that can be triggered from either side. Data validation is optional. */
  event: {
    <Name extends EventName = never, Data extends Serializable | void = void>(): Builder<
      Serializable,
      Functions,
      Events & AddEventVariant<Name, Data, Serializable>
    >;

    <Name extends EventName = never, Data extends Serializable | void = void>(
      name: Name,
      validation: ValidationFunction<Data>,
    ): Builder<Serializable, Functions, Events & AddEventVariant<Name, Data, Serializable>>;
  };

  /** Create a client with the built up types */
  client(shouldValidate?: boolean): Client<Functions, Events>;

  /** Create a server with the built up types */
  server(
    handlers: FunctionHandlers<Functions>,
    shouldValidate?: boolean,
  ): Server<Functions, Events>;

  /** Associated type representing the client() return value */
  Client: Client<Functions, Events>;
  /** Associated type representing the server() return value */
  Server: Server<Functions, Events>;
  /** Associated type representing a connected client or server */
  Connection: Connection<Functions, Events>;
  /** Associated type representing FunctionVariants */
  Functions: Functions;
  /** Associated type representing EventVariants */
  Events: Events;
  /** Associated type representing server function handlers */
  FunctionHandlers: FunctionHandlers<Functions>;
};

/** Builder for Client/Server pair */
export function build<Serializable>(
  serializer: DataSerialization<Serializable>,
): Builder<Serializable> {
  return buildInner({}, {});

  function buildInner<Serializable>(
    functionValidation: { [k: string]: ValidationFunction<Serializable> },
    eventValidation: { [k: string]: ValidationFunction<Serializable> },
  ): Builder<Serializable> {
    return {
      // Associated types, only for Typescript
      Client: (undefined as unknown) as Builder<Serializable>['Client'],
      Server: (undefined as unknown) as Builder<Serializable>['Server'],
      Connection: (undefined as unknown) as Builder<Serializable>['Connection'],
      Functions: (undefined as unknown) as Builder<Serializable>['Functions'],
      Events: (undefined as unknown) as Builder<Serializable>['Events'],
      FunctionHandlers: (undefined as unknown) as Builder<Serializable>['FunctionHandlers'],

      func(name?: string, validation?: ValidationFunction<Serializable>) {
        if (!name || !validation) {
          return buildInner(functionValidation, eventValidation);
        }

        if (functionValidation[name]) {
          throw new RpcError(
            `Tried to call func() with validation, but a function named ${name} already exists.`,
            ErrorType.BuildError,
          );
        }

        return buildInner({ ...functionValidation, [name]: validation }, eventValidation);
      },

      event(name?: string, validation?: ValidationFunction<Serializable>) {
        if (!name || !validation) {
          return buildInner(functionValidation, eventValidation);
        }

        if (eventValidation[name]) {
          throw new RpcError(
            `Tried to call event() with validation, but an event named ${name} already exists.`,
            ErrorType.BuildError,
          );
        }

        return buildInner(functionValidation, {
          ...eventValidation,
          [name]: validation,
        });
      },

      // build up a Client type that'll connect lazily
      client(shouldValidate = true) {
        if (shouldValidate) {
          logger.verbose(`Setting up a Client that should validate data`);
        } else {
          logger.verbose(`Setting up a Client that should not validate data`);
        }

        async function connect(
          ...args: unknown[]
        ): Promise<Connection<FunctionVariants, EventVariants>> {
          let connection: WebSocketClient;

          // see the Client::connect function for all overload types
          if (typeof args[0] === 'number') {
            const [port, secure] = args as [number, boolean | undefined];

            return connect('127.0.0.1', port, secure);
          }

          if (args[0] && typeof args[0] === 'object' && 'socket' in args[0]) {
            const [{ socket }] = args as [UnixSocket];
            const WebSocket = await getWebSocket();

            logger.info(`Connecting to 'ws+unix://${socket}'`);
            connection = new WebSocket(`ws+unix://${socket}`);
          } else if (typeof args[0] === 'string') {
            const [host, port, secure] = args as [string, number, boolean | undefined];
            const WebSocket = await getWebSocket();

            if (secure === true) {
              logger.info(`Connecting to 'wss://${host}:${port}'`);
              connection = new WebSocket(`wss://${host}:${port}`);
            } else {
              logger.info(`Connecting to 'ws://${host}:${port}'`);
              connection = new WebSocket(`ws://${host}:${port}`);
            }
          } else {
            const [client] = args as [WebSocketClient];

            logger.info(`Connecting using a provided WebSocket`);
            connection = client;
          }

          const [timeout, clearTimeout] = createTimeout(
            10000,
            new RpcError('Connecting to WebSocket server timed out', ErrorType.Timeout),
          );

          const connecting = new Promise<void>((resolve, reject) => {
            connection.addEventListener('open', () => resolve());
            connection.addEventListener('error', (err) => reject(err));
          });

          await Promise.race([connecting, timeout]).finally(clearTimeout);

          logger.info(`WebSocket client connection opened`);

          return setupClient(
            connection,
            serializer,
            functionValidation,
            eventValidation,
            shouldValidate,
          );
        }

        return { connect };
      },

      // build up a Server type that'll listen lazily
      server(handlers, shouldValidate = true) {
        if (shouldValidate) {
          logger.verbose(`Setting up a Server that should validate data`);
        } else {
          logger.verbose(`Setting up a Server that should not validate data`);
        }

        async function listen(
          ...args: unknown[]
        ): Promise<Connection<FunctionVariants, EventVariants>> {
          let connection: WebSocketServer;

          // we need the inner type, so that an explicit HTTP server is closed as well
          let inner: { close(cb: (err?: Error) => void): void } | undefined;

          // see the Server::listen function for overloads
          if (args[0] && typeof args[0] === 'object' && 'socket' in args[0]) {
            const { Server } = await import('http');
            const [{ socket }] = args as [UnixSocket];

            const server = new Server();
            server.listen(socket);

            return listen(server);
          }

          if (typeof args[0] === 'number') {
            const [port] = args as [number];
            const { Server: WebSocketServer } = await import('ws');

            logger.info(`Creating a WebSocket server on localhost:${port}`);
            connection = new WebSocketServer({ port });
          } else if (typeof args[0] === 'string') {
            const [host, port] = args as [string, number];
            const { Server: WebSocketServer } = await import('ws');

            logger.info(`Creating a WebSocket server on ${host}:${port}`);
            connection = new WebSocketServer({ host, port });
          } else if (args[0] instanceof (await import('http')).Server) {
            const { Server: WebSocketServer } = await import('ws');

            logger.info(`Creating a WebSocket server with a HTTP server`);
            const [server] = args as [HttpServer];
            inner = server;
            connection = new WebSocketServer({ server });
          } else if (args[0] instanceof (await import('https')).Server) {
            const { Server: WebSocketServer } = await import('ws');

            logger.info(`Creating a WebSocket server with a HTTPS server`);
            const [server] = args as [HttpsServer];
            inner = server;
            connection = new WebSocketServer({ server });
          } else {
            [connection] = args as [WebSocketServer];
          }

          return setupServer(
            connection,
            inner,
            handlers,
            serializer,
            functionValidation,
            eventValidation,
            shouldValidate,
          );
        }

        return { listen };
      },
    };
  }
}

function setupClient<
  Functions extends FunctionVariants<string>,
  Events extends EventVariants<string>
>(
  conn: WebSocketClient,
  { deserialize, serialize }: DataSerialization<any>,
  functionValidation: { [k: string]: ValidationFunction<any> },
  eventValidation: { [k: string]: ValidationFunction<any> },
  shouldValidate: boolean,
): Connection<Functions, Events> {
  if ('binaryType' in conn) {
    conn.binaryType = 'arraybuffer';
  }

  const on: WebSocketClient['addEventListener'] = conn.addEventListener.bind(conn);
  const off: WebSocketClient['removeEventListener'] = conn.removeEventListener.bind(conn);

  on('message', messageHandler);

  on('open', () => {
    logger.info(`Open event triggered: re-registering message handlers`);

    // re-register the message handler every 'open' event
    off('message', messageHandler);
    on('message', messageHandler);
  });

  type WaitingForResponse = (res: Promise<Functions[string]['response']['data']>) => void;

  // client state
  const waitingForResponse = new Map<string, WaitingForResponse>();
  const connectionHandling = setupConnectionEventHandling(on);
  const eventHandling = setupEventHandling(eventValidation, shouldValidate);

  function assertConnectionOpen() {
    switch (conn.readyState) {
      case 1:
        return;
      case 0:
        throw new RpcError(
          'WebSocket connection is CONNECTING, cannot perform operation',
          ErrorType.ConnectionNotOpen,
        );
      case 2:
        throw new RpcError(
          'WebSocket connection is CLOSING, cannot perform operation',
          ErrorType.ConnectionNotOpen,
        );
      default:
        throw new RpcError(
          'WebSocket connection is CLOSED, cannot perform operation',
          ErrorType.ConnectionNotOpen,
        );
    }
  }

  async function messageHandler({ data: msg }: { data: Serialized }) {
    if (msg === 'ping') {
      logger.verbose('Received a ping! Responding with pong.');
      conn.send('pong');
      return;
    }

    type Parsed =
      | Events[string]
      | Functions[string]['request']
      | Functions[string]['response']
      | Functions[string]['error'];

    const parsed = (await deserialize(msg)) as Parsed;

    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn(
        `Received an unexpected message - deserialized as non-object. (${parsed as string})`,
      );

      return;
    }

    if ('err' in parsed) {
      const { message, code, data, mid: messageID } = parsed;
      const error = Object.assign(
        new RpcError(message, code ? (code as ErrorType) : ErrorType.Response),
        { code, data },
      );
      const respond = waitingForResponse.get(messageID);

      waitingForResponse.delete(messageID);

      if (respond) {
        respond(Promise.reject(error));
      } else {
        logger.warn(`Received an error response for a message we did not anticipate.`);
      }
    } else if ('mt' in parsed) {
      const { mt, mid: messageID, data } = parsed as Functions[string]['response'];
      const respond = waitingForResponse.get(messageID);

      waitingForResponse.delete(messageID);

      if (shouldValidate && functionValidation[mt] && respond) {
        const error = functionValidation[mt];

        if (error) {
          respond(Promise.reject(error));
          return;
        }
      }

      if (respond) {
        respond(Promise.resolve(data));
      } else {
        logger.warn(`Received a success response for a message we did not anticipate.`);
      }
    } else if ('ev' in parsed) {
      eventHandling.dispatch(parsed);
    }
  }

  return new Proxy<Connection<Functions, Events>>({} as any, {
    get(_, prop) {
      switch (prop) {
        case 'on':
        case 'once':
        case 'one':
        case 'off':
          return eventHandling[prop];

        case 'onError':
        case 'onClose':
          return connectionHandling[prop];

        case 'sendEvent':
          return async (name: string, data: Events[string]['data']) => {
            assertConnectionOpen();

            if (shouldValidate && eventValidation[name]) {
              const error = eventValidation[name](data);

              if (error) {
                throw error;
              }
            }

            logger.verbose(`Sending an event '${name}'`);

            conn.send(await serialize({ ev: name, data }));
          };

        case 'isClosed':
          return () => {
            return conn.readyState === 2 || conn.readyState === 3;
          };

        case 'close':
          return async () => {
            // TODO: wait for events to propogate and responses to come in

            switch (conn.readyState) {
              case 0:
              case 1: {
                logger.verbose(`Closing connection`);
                conn.close();
                break;
              }
              default: {
                logger.warn(`Connection was already closed, closing anyway`);
                conn.close();
                break;
              }
            }
          };

        case 'then':
          return undefined;

        case 'ping': // ping is just a builtin function type
        default: {
          if (typeof prop !== 'string') return undefined;

          // all function calls go through here, it's why we set up a Proxy
          return async (data: unknown, timeoutMS: number = 15000) => {
            assertConnectionOpen();

            const message = { mt: prop, data, mid: nanoid() };

            if (prop === 'ping') {
              // ping(timeoutMS)
              timeoutMS = (data as number) ?? 500;
              data = undefined;
            }

            if (shouldValidate && functionValidation[prop]) {
              const error = functionValidation[prop](data);

              if (error) {
                throw error;
              }
            }

            logger.verbose(`Calling remote function: ${prop} (messageID: ${message.mid})`);

            const response = new Promise((resolve, reject) => {
              waitingForResponse.set(message.mid, (respond) => respond.then(resolve, reject));
            });

            conn.send(await serialize(message));

            const [timeout, clearTimeout] = createTimeout(
              timeoutMS,
              new RpcError(
                `Call to '${prop}' failed because it timed out in ${timeoutMS}ms`,
                ErrorType.Timeout,
              ),
            );

            return Promise.race([
              response,
              timeout.then(() => waitingForResponse.delete(message.mid)),
            ]).finally(clearTimeout);
          };
        }
      }
    },
  });
}

function setupServer<
  Functions extends FunctionVariants<string>,
  Events extends EventVariants<string>
>(
  conn: WebSocketServer,
  inner: { close(cb: (err?: Error) => void): void } | undefined,
  handlers: FunctionHandlers<Functions>,
  { deserialize, serialize }: DataSerialization<any>,
  functionValidation: { [k: string]: ValidationFunction<any> },
  eventValidation: { [k: string]: ValidationFunction<any> },
  shouldValidate: boolean,
): Connection<Functions, Events> {
  if ('binaryType' in conn) {
    conn.binaryType = 'arraybuffer';
  }

  let on: WebSocketServerInner<'on', never>['on'];

  if ('on' in conn) {
    on = conn.on.bind(conn);
  } else if ('addEventListener' in conn) {
    on = conn.addEventListener.bind(conn);
  } else if ('addListener' in conn) {
    on = conn.addListener.bind(conn);
  } else {
    throw new RpcError('WebSocketServer did not have event bindings', ErrorType.InvalidWebsocket);
  }

  const activeConnections = new Set<WebSocketClient>();

  on('connection', (client) => {
    logger.info(`A new client has connected!`);

    activeConnections.add(client);
    client.addEventListener('close', () => activeConnections.delete(client));
    client.addEventListener('message', messageHandler(client));
  });

  // server state
  const eventHandling = setupEventHandling(eventValidation, shouldValidate);
  const connectionHandling = setupConnectionEventHandling(on);
  const incomingPongListeners = new Set<(client: WebSocketClient) => void>();
  let isClosed = false;

  function messageHandler(client: WebSocketClient) {
    return async ({ data: msg }: { data: Serialized }) => {
      if (msg === 'pong') {
        logger.verbose('Received a pong response!');

        for (const notify of incomingPongListeners) {
          notify(client);
        }

        return;
      }

      type Parsed =
        | Events[string]
        | Functions[string]['request']
        | Functions[string]['response']
        | Functions[string]['error'];

      const parsed = (await deserialize(msg)) as Parsed;

      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }

      if ('err' in parsed) {
        logger.warn(`Received an 'err' message, which clients should not send.`);
      } else if ('ev' in parsed) {
        logger.verbose(`Received a '${parsed.ev}' event`);
        eventHandling.dispatch(parsed);
      } else if ('mt' in parsed) {
        const { mt, mid, data } = parsed;

        if (mt === 'ping') {
          client.send(await serialize({ mt, mid }));

          return;
        }

        if (!handlers[mt]) {
          logger.error(`A function '${mt}' was attempted, but we had no valid handlers`);

          client.send(
            await serialize({
              mid,
              err: true,
              message: `Server had no registered handler for function '${mt}'`,
            }),
          );

          return;
        }

        if (shouldValidate && functionValidation[mt]) {
          const error = functionValidation[mt](data);

          if (error) {
            client.send(
              await serialize({ mid, err: true, message: error.message, code: error.code }),
            );

            return;
          }
        }

        logger.verbose(`Function '${mt}' was called`);
        await handlers[mt](data).then(
          async (response) => {
            client.send(await serialize({ mt, mid, data: response }));
          },
          async (error: Error & { code?: number | string }) => {
            client.send(
              await serialize({ mid, err: true, message: error.message, code: error.code }),
            );
          },
        );
      }
    };
  }

  return new Proxy<Connection<Functions, Events>>({} as any, {
    get(_, prop) {
      switch (prop) {
        case 'on':
        case 'once':
        case 'one':
        case 'off':
          return eventHandling[prop];

        case 'onError':
        case 'onClose':
          return connectionHandling[prop];

        case 'sendEvent':
          return async (name: string, data: Events[string]['data']) => {
            if (shouldValidate && eventValidation[name]) {
              const error = eventValidation[name](data);

              if (error) {
                throw error;
              }
            }

            logger.verbose(`Sending an event '${name}'`);

            const message = await serialize({ ev: name, data });

            for (const client of activeConnections) {
              try {
                client.send(message);
              } catch (err) {
                logger.error(`Failed to send event to a client: ${normalizeError(err).toString()}`);
              }
            }
          };

        case 'ping':
          return async (timeoutMS: number = 200) => {
            const waitingFor = new Set(activeConnections);

            logger.verbose(`Pinging ${waitingFor.size} connected clients`);

            for (const client of waitingFor) {
              client.send('ping');
            }

            const waitForPongs = new Promise<void>((resolve) => {
              const listenForPongs = (client: WebSocketClient) => {
                waitingFor.delete(client);

                if (waitingFor.size === 0) {
                  incomingPongListeners.delete(listenForPongs);
                  resolve();
                }
              };

              incomingPongListeners.add(listenForPongs);
            });

            const [timeout, clearTimeout] = createTimeout(
              timeoutMS,
              new RpcError(
                `Pinging all clients exceeded timeout ${timeoutMS}ms`,
                ErrorType.Timeout,
              ),
            );

            await Promise.race([waitForPongs, timeout]).finally(clearTimeout);
          };

        case 'isClosed':
          return () => {
            return isClosed;
          };

        case 'close':
          return async () => {
            // TODO: wait for events to propogate and responses to be sent

            logger.verbose(`Closing connection`);
            isClosed = true;
            conn.close();

            if (inner) {
              await new Promise<void>((resolve, reject) => {
                inner.close((err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            }
          };

        case 'then':
          return undefined;

        default: {
          if (typeof prop !== 'string') return undefined;

          // a server calls itself
          const handler = handlers[prop as keyof Functions];

          return async (data: unknown, timeoutMS: number = 15000) => {
            if (shouldValidate && functionValidation[prop]) {
              const error = functionValidation[prop](data);

              if (error) {
                throw error;
              }
            }

            const response = handler(data);

            const [timeout, clearTimeout] = createTimeout(
              timeoutMS,
              new RpcError(
                `Call to '${prop}' failed because it timed out in ${timeoutMS}ms`,
                ErrorType.Timeout,
              ),
            );

            return Promise.race([response, timeout]).finally(clearTimeout);
          };
        }
      }
    },
  });
}

interface EventHandler<Events extends EventVariants<string>> {
  once?: boolean;
  (res: Events[string]['data']): void;
}

function setupConnectionEventHandling(on: {
  (event: 'close', cb: () => void): void;
  (event: 'error', cb: (error: any) => void): void;
}) {
  const onClose = new Set<() => void>();
  const onError = new Set<(error: any) => void>();

  on('close', () => {
    if (onClose.size === 0) {
      logger.warn('Connection was closed');
    }

    for (const callback of onClose) {
      callback();
    }
  });

  on('error', (error) => {
    const normalized = normalizeError(error);

    if (onError.size === 0) {
      logger.warn(`Connection error: ${normalized.toString()}`);
    }

    for (const callback of onError) {
      callback(normalized);
    }
  });

  return {
    onClose(cb: () => void) {
      onClose.add(cb);

      return () => onClose.delete(cb);
    },
    onError(cb: (error: any) => void) {
      onError.add(cb);

      return () => onError.delete(cb);
    },
  };
}

function setupEventHandling<Events extends EventVariants<string>>(
  eventValidation: { [k: string]: ValidationFunction<any> },
  shouldValidate: boolean,
) {
  const eventHandlers = new Map<keyof Events, Set<EventHandler<Events>>>();

  function dispatch(parsed: Events[string]) {
    const { ev: eventType, data } = parsed;
    const handlers = eventHandlers.get(eventType) ?? [];

    if (shouldValidate && eventValidation[eventType]) {
      const error = eventValidation[eventType](data);

      if (error) {
        throw error;
      }
    }

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        logger.error(
          `An event handler for ${eventType} failed: ${normalizeError(error).toString()}`,
        );
      }
    }
  }

  function on(name: string, callback: (data: Events[string]['data']) => void): CancelEventListener {
    if (!eventHandlers.has(name)) {
      eventHandlers.set(name, new Set());
    }

    eventHandlers.get(name)!.add(callback);

    return () => off(name, callback);
  }

  function once(
    name: string,
    callback: (data: Events[string]['data']) => void,
  ): CancelEventListener {
    on(name, Object.assign(callback, { once: true }));

    return () => off(name, callback);
  }

  function one(name: string) {
    return new Promise((resolve) => once(name, resolve));
  }

  function off(name: string, callback?: (data: Events[string]['data']) => void) {
    if (callback) {
      eventHandlers.get(name)?.delete(callback);
    } else {
      eventHandlers.get(name)?.clear();
    }
  }

  return {
    on,
    once,
    one,
    off,
    dispatch,
  };
}

function createTimeout(ms: number, error: Error): [Promise<void>, () => void] {
  let timeoutId: NodeJS.Timeout;

  const promise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(error);
    }, ms);
  });

  return [
    promise,
    () => {
      clearTimeout(timeoutId);
    },
  ];
}

function normalizeError(error: any) {
  let normalized: Error;

  if (error instanceof Error) {
    normalized = error;
  } else if (typeof error !== 'object' || error === null) {
    normalized = new RpcError(`Unknown error: ${(error as object)?.toString()}`, ErrorType.Unknown);
  } else if ('error' in error && (error as { error: any }).error instanceof Error) {
    normalized = (error as { error: any }).error as Error;
  } else {
    normalized = new RpcError(`Unknown error: ${(error as object)?.toString()}`, ErrorType.Unknown);
  }

  return normalized;
}

// resolve to the WebSocket client library - use the global and avoid 'ws' if possible
function getWebSocket() {
  if (typeof globalThis !== 'undefined' && 'WebSocket' in globalThis) {
    return Promise.resolve(globalThis.WebSocket);
  }

  if (typeof window !== 'undefined' && 'WebSocket' in window) {
    return Promise.resolve(window.WebSocket);
  }

  if (typeof global !== 'undefined' && 'WebSocket' in global) {
    return Promise.resolve(global.WebSocket);
  }

  return import('ws').then((ws) => ws.default);
}

// ts assertions to ensure compatibility
/* eslint-disable */

const _test1: WebSocketClient = (null as any) as WS;
const _test2: WebSocketClient = (null as any) as WebSocket;
const _test3: WebSocketClient = (null as any) as ReconnectingWS;
const _test4: WebSocketServer = (null as any) as WS.Server;
