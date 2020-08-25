import WS from 'ws';
import { Json } from '@lcdev/ts';
import { nanoid } from 'nanoid';

export type MessageType = string;
export type EventType = string;
export type Serializable = Json | object | void;
export type Deserializable = string | Buffer | ArrayBuffer;

type Fn<Arg, Ret = void> = (arg: Arg) => Promise<Ret> | Ret;

if (typeof WebSocket === 'undefined') {
  ((global.WebSocket as any) as typeof WS) = WS;
}

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
  websocket: WebSocket;
  connecting: Promise<void>;
  waitingForResponse: {
    [mid: string]: ((res: Promise<H[MessageTypes]['response']>) => void) | undefined;
  } = {};
  eventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};
  onceEventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};

  constructor(host: string, port: number) {
    this.websocket = new WebSocket(`ws://${host}:${port}`);

    this.websocket.addEventListener('error', (err) => {
      console.error(err);
      this.close().catch(() => {});
    });

    this.connecting = new Promise((resolve, reject) => {
      this.websocket.addEventListener('open', () => resolve());
      this.websocket.addEventListener('error', (err) => reject(err));

      const handleParsedMessage = async (parsed: H | E) => {
        if ('err' in parsed) {
          const { message, code, mid }: H[MessageTypes]['error'] = parsed;

          this.waitingForResponse[mid]?.(Promise.reject(new RPCError(message, code)));
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

      this.websocket.addEventListener('message', async ({ data }: { data: Deserializable }) => {
        const parsed = this.deserialize<H | E>(data);

        await handleParsedMessage(parsed);
      });
    });
  }

  protected serialize(data: Serializable): Deserializable {
    return JSON.stringify(data);
  }

  protected deserialize<Out extends Serializable>(data: Deserializable): Out {
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
    await this.connecting;

    const response = new Promise<H[T]['response']>((resolve, reject) => {
      this.waitingForResponse[req.mid] = (res) => res.then(resolve, reject);
      this.websocket.send(this.serialize(req));
    });

    return Promise.race([
      response,
      new Promise<H[T]['response']>((_, reject) =>
        setTimeout(() => {
          delete this.waitingForResponse[req.mid];
          reject(new RPCError(`Call to ${req.mt} failed because it timed out in ${timeoutMS}ms`));
        }, timeoutMS),
      ),
    ]);
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
    await this.connecting;
    this.websocket.send(this.serialize(event));
  }

  async sendEvent<T extends EventTypes>(event: T, data: E[T]['data']) {
    return this.sendEventRaw(({ ev: event, data } as unknown) as E[T]);
  }

  on<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e] ?? [];
    this.eventHandlers[e]!.push(handler);
  }

  once<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.onceEventHandlers[e] = this.onceEventHandlers[e] ?? [];
    this.onceEventHandlers[e]!.push(handler);
  }

  removeEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e]?.filter((v) => v !== handler);
  }

  async close() {
    this.websocket.close();
  }
}

export class Server<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> {
  websocket: WS.Server;
  connections: WS[] = [];

  handlers: {
    [T in MessageTypes]?: Fn<H[T]['request']['data'], H[T]['response']['data']>;
  } = {};

  eventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};
  onceEventHandlers: { [T in EventTypes]?: Fn<E[T]['data']>[] } = {};

  constructor(port: number) {
    this.websocket = new WS.Server({ port });

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

              ws.send(this.serialize({ mt, mid, data: responseData }));
            } catch (err) {
              if (err instanceof RPCError) {
                ws.send(
                  this.serialize({ err: true, mid, message: err.toString(), code: err.code }),
                );
              } else if (typeof err === 'object') {
                ws.send(this.serialize({ err: true, mid, message: err.toString() })); // eslint-disable-line
              } else {
                ws.send(this.serialize({ err: true, mid, message: 'An unkown error occured' }));
              }
            }
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
        const parsed = this.deserialize<H | E>(data);

        await handleParsedMessage(parsed);
      });
    });
  }

  protected serialize(data: Serializable): Deserializable {
    return JSON.stringify(data);
  }

  protected deserialize<Out extends Serializable>(data: Deserializable): Out {
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
    const msg = this.serialize(event);

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

  on<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e] ?? [];
    this.eventHandlers[e]!.push(handler);
  }

  once<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.onceEventHandlers[e] = this.onceEventHandlers[e] ?? [];
    this.onceEventHandlers[e]!.push(handler);
  }

  removeEventListener<T extends EventTypes>(e: T, handler: Fn<E[T]['data']>) {
    this.eventHandlers[e] = this.eventHandlers[e]?.filter((v) => v !== handler);
  }

  async close() {
    await new Promise((resolve, reject) =>
      this.websocket.close((err) => {
        if (err) reject(err);
        else resolve();
      }),
    );
  }
}
