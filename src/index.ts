import WS from 'ws';
import type ReconnectingWS from 'reconnecting-websocket';
import type { Json } from '@lcdev/ts';
import { nanoid } from 'nanoid';

export type MessageType = string;
export type EventType = string;
export type Serializable = Json | object | void;
export type Deserializable = string | Buffer | ArrayBuffer | Blob;
export type CancelEventListener = () => void;

type Fn<Arg, Ret = void> = (arg: Arg) => Promise<Ret> | Ret;

/** Canonical type for requests and responses */
export type MessageVariants<MessageTypes extends MessageType> = {
  [T in MessageTypes]: MessageVariant<T, Serializable, Serializable>;
};

/** Canonical type for all events that can occur */
export type EventVariants<EventTypes extends EventType> = {
  [T in EventTypes]: EventVariant<T, Serializable>;
};

export type MessageVariant<
  T extends MessageType,
  Data extends Serializable,
  ResponseData extends Serializable
> = {
  request: {
    /** The MessageType, which describes what to expect from the message */
    mt: T;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes with the message */
    data: Data;
  };
  response: {
    /** The MessageType, which describes what to expect from the message */
    mt: T;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes back from the message */
    data: ResponseData;
  };
  error: {
    err: true;
    /** A unique ID, to identify messages (to correspond request & response) */
    mid: string;
    /** Error description */
    message: string;
    /** Identifier of the error */
    code?: number;
    /** Any extra data attached to the error  */
    data?: Serializable;
  };
};

export type EventVariant<T extends EventType, Data extends Serializable> = {
  ev: T;
  data: Data;
};

class RPCError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
  }

  toString() {
    return this.message;
  }
}

export class Client<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> {
  private readonly websocket: WebSocket;
  private connecting: Promise<void>;

  private waitingForResponse: {
    [mid: string]: ((res: Promise<H[MessageTypes]['response']>) => void) | undefined;
  } = {};

  private eventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};
  private onceEventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};

  constructor(websocket: WS);
  constructor(websocket: WebSocket);
  constructor(websocket: ReconnectingWS);
  constructor(host: string, port: number);

  constructor(hostOrWebsocket: string | WS | WebSocket | ReconnectingWS, port?: number) {
    if (typeof hostOrWebsocket === 'string' && port !== undefined) {
      const host = hostOrWebsocket;

      if (typeof WebSocket === 'undefined') {
        this.websocket = (new WS(`ws://${host}:${port}`) as unknown) as WebSocket;
      } else {
        this.websocket = new WebSocket(`ws://${host}:${port}`);
      }
    } else {
      this.websocket = hostOrWebsocket as WebSocket;
    }

    if ('binaryType' in this.websocket) {
      this.websocket.binaryType = 'arraybuffer';
    }

    const handleParsedMessage = async (parsed: H | E) => {
      if ('err' in parsed) {
        const { message, code, data, mid }: H[MessageTypes]['error'] = parsed;

        const error = Object.assign(new RPCError(message, code), data);
        this.waitingForResponse[mid]?.(Promise.reject(error));
        delete this.waitingForResponse[mid];

        return;
      }

      if ('mt' in parsed) {
        const response: H[MessageTypes]['response'] = parsed;
        this.waitingForResponse[response.mid]?.(Promise.resolve(response));
        delete this.waitingForResponse[response.mid];

        return;
      }

      if ('ev' in parsed) {
        const event: E[EventTypes] = parsed;
        const eventType = event.ev as EventTypes;

        // we reset onceEventHandlers right away, so that new messages don't hit them as well
        const onceHandlers = this.onceEventHandlers[eventType];
        this.onceEventHandlers[eventType] = [];

        if (onceHandlers) {
          await Promise.all(onceHandlers.map((handler) => handler(event.data)));
        }

        await Promise.all(
          this.eventHandlers[eventType]?.map((handler) => {
            return handler(event.data);
          }) ?? [],
        );
      }
    };

    // this can be reassigned, because it could re-open after the first rejection
    this.connecting = new Promise((resolve, reject) => {
      this.websocket.addEventListener('open', () => resolve());
      this.websocket.addEventListener('error', (err) => reject(err));
    });

    this.websocket.addEventListener('open', () => {
      // we reassign this promise, which could have been initial rejected
      this.connecting = Promise.resolve();

      // re-register the message handler every 'open' event, for reconnecting-websocket
      this.websocket.addEventListener('message', ({ data }: { data: Deserializable }) => {
        this.deserialize<H | E>(data).then(handleParsedMessage).catch(console.error);
      });
    });
  }

  protected async serialize(data: Serializable): Promise<Deserializable> {
    return JSON.stringify(data);
  }

  protected async deserialize<Out extends Serializable>(data: Deserializable): Promise<Out> {
    if (typeof data !== 'string') {
      throw new RPCError(
        'Tried to deserialize a non-string message! Use BJSONClient if you intend to send binary messages.',
      );
    }

    return JSON.parse(data) as Out;
  }

  async waitForConnection() {
    await this.connecting;

    return this;
  }

  async callRaw<T extends MessageTypes>(
    req: H[T]['request'],
    timeoutMS: number = 15000,
  ): Promise<H[T]['response']> {
    await this.waitForConnection();

    const response = new Promise<H[T]['response']>((resolve, reject) => {
      this.waitingForResponse[req.mid] = (res) => res.then(resolve, reject);
      this.serialize(req).then((msg) => this.websocket.send(msg), reject);
    });

    let timeoutId: NodeJS.Timeout;

    return Promise.race([
      response,
      new Promise<H[T]['response']>((_, reject) => {
        timeoutId = setTimeout(() => {
          delete this.waitingForResponse[req.mid];
          reject(new RPCError(`Call to ${req.mt} failed because it timed out in ${timeoutMS}ms`));
        }, timeoutMS);
      }),
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  async call<T extends MessageTypes>(
    name: T,
    req: H[T]['request']['data'],
    timeoutMS: number = 15000,
  ): Promise<H[T]['response']['data']> {
    const fullRequest = {
      mt: name,
      mid: nanoid(),
      data: req,
    } as H[T]['request'];

    const { data } = await this.callRaw<T>(fullRequest, timeoutMS);

    return data;
  }

  async sendEventRaw<T extends EventTypes>(event: E[T]) {
    await this.waitForConnection();
    this.websocket.send(await this.serialize(event));
  }

  async sendEvent<T extends EventTypes>(event: T, data: E[T]['data']) {
    return this.sendEventRaw(({ ev: event, data } as unknown) as E[T]);
  }

  on<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    this.eventHandlers[e] = this.eventHandlers[e] ?? [];
    this.eventHandlers[e]!.push(handler);
    return () => this.removeEventListener(e, handler);
  }

  once<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    this.onceEventHandlers[e] = this.onceEventHandlers[e] ?? [];
    this.onceEventHandlers[e]!.push(handler);
    return () => this.removeEventListener(e, handler);
  }

  addEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    return this.on(e, handler);
  }

  removeEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e]?.filter((v) => v !== handler);
    this.onceEventHandlers[e] = this.onceEventHandlers[e]?.filter((v) => v !== handler);
  }

  async close() {
    this.websocket.close();
  }

  onError(cb: (error: any) => void) {
    this.websocket.addEventListener('error', cb);
  }

  onClose(cb: () => void) {
    this.websocket.addEventListener('close', cb);
  }
}

export class Server<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> {
  private readonly websocket: WS.Server;
  private connections: WS[] = [];

  private handlers: {
    [T in MessageTypes]?: Fn<H[T]['request']['data'], H[T]['response']['data']>;
  } = {};

  private eventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};
  private onceEventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};

  constructor(port: number);
  constructor(server: WS.Server);

  constructor(portOrServer: WS.Server | number) {
    if (typeof portOrServer === 'number') {
      this.websocket = new WS.Server({ port: portOrServer });
    } else {
      this.websocket = portOrServer;
    }

    this.websocket.on('connection', async (ws) => {
      this.connections.push(ws);

      ws.on('close', () => {
        this.connections = this.connections.filter((c) => c !== ws);
      });

      const handleParsedMessage = async (parsed: H | E) => {
        if ('mt' in parsed) {
          const { mt, mid, data }: H[MessageTypes]['request'] = parsed;

          const handler = this.handlers[mt as MessageTypes];

          if (handler) {
            try {
              const responseData = await handler(data);

              ws.send(await this.serialize({ mt, mid, data: responseData }));
            } catch (err) {
              if (err instanceof RPCError) {
                ws.send(
                  await this.serialize({ err: true, mid, message: err.toString(), code: err.code }),
                );
              } else if (typeof err === 'object') {
                const { message, code, ...data } = err as { message?: string; code?: number };

                ws.send(
                  await this.serialize({
                    err: true,
                    mid,
                    // eslint-disable-next-line
                    message: message ?? err.toString(),
                    code,
                    data,
                  }),
                );
              } else {
                ws.send(
                  await this.serialize({ err: true, mid, message: 'An unkown error occured' }),
                );
              }
            }
          } else {
            ws.send(
              await this.serialize({
                err: true,
                mid,
                code: 404,
                message: `Function '${mt}' had no handlers in the server`,
              }),
            );
          }

          return;
        }

        if ('ev' in parsed) {
          const { ev, data }: E[EventTypes] = parsed;
          const eventType = ev as EventTypes;

          // we reset onceEventHandlers right away, so that new messages don't hit them as well
          const onceHandlers = this.onceEventHandlers[eventType];
          this.onceEventHandlers[eventType] = [];

          if (onceHandlers) {
            await Promise.all(onceHandlers.map((handler) => handler(data)));
          }

          await Promise.all(
            this.eventHandlers[eventType]?.map((handler) => {
              return handler(data);
            }) ?? [],
          );
        }
      };

      ws.on('message', async (data: Deserializable) => {
        const parsed = await this.deserialize<H | E>(data);

        await handleParsedMessage(parsed);
      });
    });
  }

  protected async serialize(data: Serializable): Promise<Deserializable> {
    return JSON.stringify(data);
  }

  protected async deserialize<Out extends Serializable>(data: Deserializable): Promise<Out> {
    if (typeof data !== 'string') {
      throw new RPCError(
        'Tried to deserialize a non-string message! Use BJSONClient if you intend to send binary messages.',
      );
    }

    return JSON.parse(data) as Out;
  }

  registerHandler<T extends MessageTypes>(
    name: T,
    handler: Fn<H[T]['request']['data'], H[T]['response']['data']>,
  ) {
    if (this.handlers[name]) throw new RPCError(`Handler ${name} was already registered`);
    this.handlers[name] = handler;
  }

  async sendEventRaw<T extends EventTypes>(event: E[T]) {
    const msg = await this.serialize(event);

    for (const ws of this.connections) {
      await new Promise((resolve, reject) =>
        ws.send(msg, (err) => {
          if (err) reject(err);
          else resolve();
        }),
      );
    }
  }

  async sendEvent<T extends EventTypes>(event: T, data: E[T]['data']) {
    return this.sendEventRaw(({ ev: event, data } as unknown) as E[T]);
  }

  on<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    this.eventHandlers[e] = this.eventHandlers[e] ?? [];
    this.eventHandlers[e]!.push(handler);
    return () => this.removeEventListener(e, handler);
  }

  once<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    this.onceEventHandlers[e] = this.onceEventHandlers[e] ?? [];
    this.onceEventHandlers[e]!.push(handler);
    return () => this.removeEventListener(e, handler);
  }

  addEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>): CancelEventListener {
    return this.on(e, handler);
  }

  removeEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e]?.filter((v) => v !== handler);
    this.onceEventHandlers[e] = this.onceEventHandlers[e]?.filter((v) => v !== handler);
  }

  async close() {
    await new Promise((resolve, reject) =>
      this.websocket.close((err) => {
        if (err) reject(err);
        else resolve();
      }),
    );
  }

  onError(cb: (error: any) => void) {
    this.websocket.on('error', cb);
  }

  onClose(cb: () => void) {
    this.websocket.on('close', cb);
  }
}
