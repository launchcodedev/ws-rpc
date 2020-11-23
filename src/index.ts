import type WS from 'ws';
import type ReconnectingWS from 'reconnecting-websocket';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Json } from '@lcdev/ts';
import { nanoid } from 'nanoid';

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

// helper type
type AddFunctionVariant<
  Name extends FunctionName,
  RequestData extends Serializable | void,
  ResponseData extends Serializable | void,
  Serializable
> = {
  [k in Name]: FunctionVariant<Name, RequestData, ResponseData, Serializable>;
};

// helper type
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

  /** Unregister an event handler */
  off<T extends keyof Events>(name: T, callback?: (data: Events[T]['data']) => void): void;

  /** Send an event to peer (server or client) */
  sendEvent<T extends keyof Events>(
    ...args: Events[T]['data'] extends void ? [T] : [T, Events[T]['data']]
  ): Promise<void>;
}

/** Callable function that proxies to a specific RPC call */
export type FunctionHandler<Function extends FunctionVariant<string, any, any, any>> = {
  (args: Function['request']['data']): Promise<Function['response']['data']>;
};

/** Callable functions that proxy to RPC calls. Available on client (calls server) and server (calls itself). */
export type FunctionHandlers<Functions extends FunctionVariants<FunctionName>> = {
  [F in keyof Functions]: FunctionHandler<Functions[F]>;
};

/** Common interface for websocket client (Browser, Node, etc), to avoid hard dependency on ws library */
export interface WebSocketClient {
  binaryType?: string;

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

/** Common interface for websocket server, to avoid hard dependency on ws library */
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

/** Common bidirectional type of a connected client or server - servers call their own functions */
export type Connection<
  Functions extends FunctionVariants<FunctionName>,
  Events extends EventVariants<EventName>
> = EventHandlers<Events> &
  FunctionHandlers<Functions> & {
    ping(): Promise<void>;
    close(): Promise<void>;
  };

// TODO: sendEvent to specific clients
// TODO: onClientConnect event

/** Intermediate representation of a client type, that can connect to a server */
export type Client<
  Functions extends FunctionVariants<FunctionName>,
  Events extends EventVariants<EventName>
> = {
  connect(port: number, secure?: boolean): Promise<Connection<Functions, Events>>;
  connect(host: string, port: number, secure?: boolean): Promise<Connection<Functions, Events>>;
  connect(client: WebSocketClient): Promise<Connection<Functions, Events>>;
};

/** Intermediate representation of a server type, that can listen for connections */
export type Server<Functions extends FunctionVariants, Events extends EventVariants> = {
  listen(port: number): Promise<Connection<Functions, Events>>;
  listen(host: string, port: number): Promise<Connection<Functions, Events>>;
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

/** Basic JSON wire format */
export const jsonSerialization: DataSerialization<Json> = {
  serialize: JSON.stringify,
  deserialize: JSON.parse,
};

/** Builder for Client/Server pair */
export function build<Serializable>(
  serializer: DataSerialization<Serializable>,
): Builder<Serializable> {
  return {
    // Associated types
    Client: undefined as any,
    Server: undefined as any,
    Connection: undefined as any,
    Functions: undefined as any,
    Events: undefined as any,
    FunctionHandlers: undefined as any,

    // just cheat the type system, since constraints are enforce in the Builder type
    // the nice thing is that there is no runtime behavior here (downside is no request validation, of course)
    func() {
      return build(serializer) as any;
    },
    event() {
      return build(serializer) as any;
    },

    // build up a Client type that'll connect lazily
    client() {
      async function connect(
        ...args: unknown[]
      ): Promise<Connection<FunctionVariants, EventVariants>> {
        let connection: WebSocketClient;

        // resolve to the WebSocket client library - use the global and avoid 'ws' if possible
        const getWebSocket = () => {
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
        };

        // see the Client::connect function for overloads
        if (typeof args[0] === 'number') {
          const [port, secure] = args as [number, boolean | undefined];

          return connect('127.0.0.1', port, secure);
        }
        if (typeof args[0] === 'string') {
          const [host, port, secure] = args as [string, number, boolean | undefined];
          const WebSocket = await getWebSocket();

          if (secure === true) {
            connection = new WebSocket(`wss://${host}:${port}`);
          } else {
            connection = new WebSocket(`ws://${host}:${port}`);
          }
        } else {
          const [client] = args as [WebSocketClient];

          connection = client;
        }

        // TODO: connection timeouts
        await new Promise<void>((resolve, reject) => {
          connection.addEventListener('open', () => resolve());
          connection.addEventListener('error', (err) => reject(err));
        });

        return setupClient(connection, serializer);
      }

      return { connect };
    },

    // build up a Server type that'll listen lazily
    server(handlers) {
      async function listen(...args: unknown[]) {
        let connection: WebSocketServer;

        // see the Server::listen function for overloads
        if (typeof args[0] === 'number') {
          const [port] = args as [number];
          const { Server: WebSocketServer } = await import('ws');

          connection = new WebSocketServer({ port });
        } else if (typeof args[0] === 'string') {
          const [host, port] = args as [string, number];
          const { Server: WebSocketServer } = await import('ws');

          connection = new WebSocketServer({ host, port });
        } else if (args[0] instanceof (await import('http')).Server) {
          const { Server: WebSocketServer } = await import('ws');

          // TODO: closing the server when closing
          connection = new WebSocketServer({ server: args[0] });
        } else if (args[0] instanceof (await import('https')).Server) {
          const { Server: WebSocketServer } = await import('ws');

          // TODO: closing the server when closing
          connection = new WebSocketServer({ server: args[0] });
        } else {
          connection = args[0] as WebSocketServer;
        }

        return setupServer(connection, handlers, serializer);
      }

      return { listen };
    },
  };
}

/** Builder for Client/Server pair */
export type Builder<
  Serializable,
  Functions extends FunctionVariants<FunctionName, Serializable> = FunctionVariants<
    never,
    Serializable
  >,
  Events extends EventVariants<EventName, Serializable> = EventVariants<never, Serializable>
> = {
  /** Adds a function type that can be called */
  func: <
    Name extends FunctionName = never,
    Request extends Serializable | void = void,
    Response extends Serializable | void = void
  >() => Builder<
    Serializable,
    Functions & AddFunctionVariant<Name, Request, Response, Serializable>,
    Events
  >;

  /** Adds an event type that can be triggered from either side */
  event: <Name extends EventName = never, Data extends Serializable | void = void>() => Builder<
    Serializable,
    Functions,
    Events & AddEventVariant<Name, Data, Serializable>
  >;

  /** Create a client with the built up types */
  client(): Client<Functions, Events>;
  /** Create a server with the built up types */
  server(handlers: FunctionHandlers<Functions>): Server<Functions, Events>;

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

function setupClient<
  Functions extends FunctionVariants<string>,
  Events extends EventVariants<string>
>(
  conn: WebSocketClient,
  { deserialize, serialize }: DataSerialization<any>,
): Connection<Functions, Events> {
  if ('binaryType' in conn) {
    conn.binaryType = 'arraybuffer';
  }

  type EventHandler = {
    once?: boolean;
    (res: Events[string]['data']): void;
  };

  type WaitingForResponse = (res: Promise<Functions[string]['response']['data']>) => void;

  interface State {
    eventHandlers: Map<keyof Events, Set<EventHandler>>;
    waitingForResponse: Map<string, WaitingForResponse>;
  }

  const state: State = {
    eventHandlers: new Map(),
    waitingForResponse: new Map(),
  };

  const on: WebSocketClient['addEventListener'] = conn.addEventListener.bind(conn);
  const off: WebSocketClient['removeEventListener'] = conn.removeEventListener.bind(conn);

  const messageHandler = async ({ data }: { data: Serialized }) => {
    const parsed:
      | Events[string]
      | Functions[string]['request']
      | Functions[string]['response']
      | Functions[string]['error'] = await deserialize(data);

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }

    if ('err' in parsed) {
      const { message, code, data, mid: messageID } = parsed;

      const error = Object.assign(new Error(message), { code, data });

      if (state.waitingForResponse.has(messageID)) {
        const notify = state.waitingForResponse.get(messageID)!;
        state.waitingForResponse.delete(messageID);
        notify(Promise.reject(error));
      }
    } else if ('mt' in parsed) {
      const { mid: messageID, data } = parsed as Functions[string]['response'];

      if (state.waitingForResponse.has(messageID)) {
        const notify = state.waitingForResponse.get(messageID)!;
        state.waitingForResponse.delete(messageID);
        notify(Promise.resolve(data));
      }
    } else if ('ev' in parsed) {
      const { ev: eventType, data } = parsed;
      const handlers = state.eventHandlers.get(eventType) ?? [];

      for (const handler of handlers) {
        if (handler.once) {
          state.eventHandlers.get(eventType)!.delete(handler);
        }

        // TODO: error handling
        handler(data);
      }
    }
  };

  on('message', messageHandler);

  on('open', () => {
    // re-register the message handler every 'open' event
    off('message', messageHandler);
    on('message', messageHandler);
  });

  // TODO: connection errors
  // TODO: connection closing

  const client = new Proxy<Connection<Functions, Events>>({} as any, {
    get(_, prop) {
      switch (prop) {
        case 'on':
          return (
            name: string,
            callback: (data: Events[string]['data']) => void,
          ): CancelEventListener => {
            if (!state.eventHandlers.has(name)) {
              state.eventHandlers.set(name, new Set());
            }

            state.eventHandlers.get(name)!.add(callback);

            return () => client.off(name, callback);
          };

        case 'once':
          return (
            name: string,
            callback: (data: Events[string]['data']) => void,
          ): CancelEventListener => {
            client.on(name, Object.assign(callback, { once: true }));

            return () => client.off(name, callback);
          };

        case 'off':
          return (name: string, callback?: (data: Events[string]['data']) => void) => {
            if (callback) {
              state.eventHandlers.get(name)?.delete(callback);
            } else {
              state.eventHandlers.get(name)?.clear();
            }
          };

        case 'sendEvent':
          return async (name: string, data: Events[string]['data']) => {
            conn.send(await serialize({ ev: name, data }));
          };

        case 'close':
          return async () => {
            // TODO: wait for events to propogate
            conn.close();
            // TODO: wait until connection is closed
          };

        case 'then':
          return undefined;

        // TODO: ping
        case 'ping':
        default:
          // all function calls go through here, it's why we set up a Proxy
          return async (data: unknown) => {
            const message = { mt: prop, data, mid: nanoid() };

            const response = new Promise((resolve, reject) => {
              state.waitingForResponse.set(message.mid, (response) =>
                response.then(resolve, reject),
              );
            });

            conn.send(await serialize(message));

            // TODO: timeouts
            return response;
          };
      }
    },
  });

  return client;
}

function setupServer<
  Functions extends FunctionVariants<string>,
  Events extends EventVariants<string>
>(
  conn: WebSocketServer,
  handlers: FunctionHandlers<Functions>,
  { deserialize, serialize }: DataSerialization<any>,
): Connection<Functions, Events> {
  if ('binaryType' in conn) {
    conn.binaryType = 'arraybuffer';
  }

  type EventHandler = {
    once?: boolean;
    (res: Events[string]['data']): void;
  };

  interface State {
    eventHandlers: Map<keyof Events, Set<EventHandler>>;
  }

  const state: State = {
    eventHandlers: new Map(),
  };

  let on: WebSocketServerInner<'on', never>['on'];
  let off: WebSocketServerInner<never, 'off'>['off'];

  if ('on' in conn) {
    on = conn.on.bind(conn);
    off = conn.off.bind(conn);
  } else if ('addEventListener' in conn) {
    on = conn.addEventListener.bind(conn);
    off = conn.removeEventListener.bind(conn);
  } else if ('addListener' in conn) {
    on = conn.addListener.bind(conn);
    off = conn.removeListener.bind(conn);
  } else {
    throw new Error('WebSocketServer did not have event bindings');
  }

  const messageHandler = (conn: WebSocketClient) => async ({ data }: { data: Serialized }) => {
    const parsed:
      | Events[string]
      | Functions[string]['request']
      | Functions[string]['response']
      | Functions[string]['error'] = await deserialize(data);

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }

    if ('err' in parsed) {
      const { message, code, data, mid: messageID } = parsed;
      const error = Object.assign(new Error(message), { code, data });

      // TODO: I think we just ignore these? Client shouldn't send errors.
    } else if ('mt' in parsed) {
      const { mt, mid, data } = parsed;

      if (mt === 'ping') {
        conn.send(await serialize({ mt, mid }));

        return;
      }

      if (!handlers[mt]) {
        conn.send(
          await serialize({
            mid,
            err: true,
            message: `Server had no registered handler for function '${mt}'`,
          }),
        );

        return;
      }

      await handlers[mt](data).then(
        async (response) => {
          conn.send(await serialize({ mt, mid, data: response }));
        },
        async (error) => {
          conn.send(await serialize({ mid, err: true, message: error.message }));
        },
      );
    } else if ('ev' in parsed) {
      const { ev: eventType, data } = parsed;
      const handlers = state.eventHandlers.get(eventType) ?? [];

      for (const handler of handlers) {
        // TODO: error handling
        handler(data);
      }
    }
  };

  const activeConnections = new Set<WebSocketClient>();

  on('connection', (client) => {
    activeConnections.add(client);
    client.addEventListener('message', messageHandler(client));

    client.addEventListener('close', () => {
      activeConnections.delete(client);
    });
  });

  // TODO: connection errors
  // TODO: connection closing

  const server = new Proxy<Connection<Functions, Events>>({} as any, {
    get(_, prop) {
      switch (prop) {
        case 'on':
          return (
            name: string,
            callback: (data: Events[string]['data']) => void,
          ): CancelEventListener => {
            if (!state.eventHandlers.has(name)) {
              state.eventHandlers.set(name, new Set());
            }

            state.eventHandlers.get(name)!.add(callback);

            return () => server.off(name, callback);
          };

        case 'once':
          return (
            name: string,
            callback: (data: Events[string]['data']) => void,
          ): CancelEventListener => {
            server.on(name, Object.assign(callback, { once: true }));

            return () => server.off(name, callback);
          };

        case 'off':
          return (name: string, callback?: (data: Events[string]['data']) => void) => {
            if (callback) {
              state.eventHandlers.get(name)?.delete(callback);
            } else {
              state.eventHandlers.get(name)?.clear();
            }
          };

        case 'sendEvent':
          return async (name: string, data: Events[string]['data']) => {
            const message = await serialize({ ev: name, data });

            for (const conn of activeConnections) {
              try {
                conn.send(message);
              } catch {}
            }
          };

        case 'close':
          return async () => {
            // TODO: wait for events to propogate
            conn.close();
            // TODO: wait until connection is closed
          };

        case 'ping':
          return async () => {
            for (const conn of activeConnections) {
              conn.send('"ping"');
            }
          };

        case 'then':
          return undefined;

        default:
          // a server can call itself
          return handlers[prop as keyof Functions];
      }
    },
  });

  return server;
}

// ts assertions

const _test1: WebSocketClient = (null as any) as WS;
const _test2: WebSocketClient = (null as any) as WebSocket;
const _test3: WebSocketServer = (null as any) as WS.Server;
const _test4: WebSocketServer = (null as any) as ReconnectingWS;
