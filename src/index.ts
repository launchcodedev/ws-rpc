import { Json } from '@lcdev/ts';
import WS from 'ws';
import uuid from 'uuid/v4';

type MessageType = string;
type EventType = string;

type Fn<Arg, Ret = void> = (arg: Arg) => Promise<Ret> | Ret;

if (typeof WebSocket === 'undefined') {
  global.WebSocket = WS as any;
}

/** Canonical type for requests and responses */
export type MessageVariants<MessageTypes extends MessageType> = {
  [T in MessageTypes]: MessageVariant<T, Json | void, Json | void>;
};

/** Canonical type for all events that can occur */
export type EventVariants<EventTypes extends EventType> = {
  [T in EventTypes]: EventVariant<T, Json | void>;
};

export type MessageVariant<
  T extends MessageType,
  Data extends Json | void,
  ResponseData extends Json | void
> = {
  request: {
    /** The MessageType, which describes what to expect from the message */
    mt: T;
    /** A unique UUID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes with the message */
    data: Data;
  };
  response: {
    /** The MessageType, which describes what to expect from the message */
    mt: T;
    /** A unique UUID, to identify messages (to correspond request & response) */
    mid: string;
    /** What data comes back from the message */
    data: ResponseData;
  };
  error: {
    err: true;
    /** A unique UUID, to identify messages (to correspond request & response) */
    mid: string;
    /** Error description */
    message: string;
    /** Identifier of the error */
    code?: number;
  };
};

export type EventVariant<T extends EventType, Data extends Json | void> = {
  ev: T;
  data: Data;
};

class RPCError extends Error {
  constructor(message: string, private code?: number) {
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
      this.close();
    });

    this.connecting = new Promise((resolve, reject) => {
      this.websocket.addEventListener('open', () => resolve());
      this.websocket.addEventListener('error', (err) => reject(err));

      this.websocket.addEventListener('message', async ({ data }: { data: string }) => {
        if (typeof data === 'string') {
          if (data.length === 0) return;
          const parsed = JSON.parse(data);

          if (parsed.err) {
            const { message, code, mid }: H[MessageTypes]['error'] = parsed;

            this.waitingForResponse[mid]?.(Promise.reject(new RPCError(message, code)));
            delete this.waitingForResponse[mid];

            return;
          }

          if (parsed.mt) {
            const response: H[MessageTypes]['response'] = parsed;
            this.waitingForResponse[response.mid]?.(Promise.resolve(response));
            delete this.waitingForResponse[response.mid];

            return;
          }

          if (parsed.ev) {
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

            return;
          }
        }
      });
    });
  }

  static async connect<
    MessageTypes extends MessageType,
    EventTypes extends EventType,
    H extends MessageVariants<MessageTypes>,
    E extends EventVariants<EventTypes>
  >(host: string, port: number) {
    const client = new Client<MessageTypes, EventTypes, H, E>(host, port);
    await client.connecting;
    return client;
  }

  async callRaw<T extends MessageTypes>(
    req: H[T]['request'],
    timeoutMS = 15000,
  ): Promise<H[T]['response']> {
    await this.connecting;

    const response = new Promise<H[T]['response']>((resolve, reject) => {
      this.waitingForResponse[req.mid] = (res) => res.then(resolve, reject);
      this.websocket.send(JSON.stringify(req));
    });

    return Promise.race([
      response,
      new Promise<any>((_, reject) =>
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
    timeoutMS?: number,
  ): Promise<H[T]['response']['data']> {
    const fullRequest = {
      mt: name,
      mid: uuid(),
      data: req,
    } as H[T]['request'];

    const { data } = await this.callRaw<T>(fullRequest, timeoutMS);

    return data;
  }

  async sendEventRaw<T extends EventTypes>(event: E[T]) {
    await this.connecting;
    this.websocket.send(JSON.stringify(event));
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

      ws.on('message', async (data) => {
        if (typeof data === 'string') {
          if (data.length === 0) return;
          const parsed = JSON.parse(data);

          if (parsed.mt) {
            const { mt, mid, data }: H[MessageTypes]['request'] = parsed;

            const handler = this.handlers[mt as MessageTypes];

            if (handler) {
              try {
                const responseData = await handler(data);
                ws.send(JSON.stringify({ mt, mid, data: responseData }));
              } catch (err) {
                ws.send(
                  JSON.stringify({ err: true, mid, message: err.toString(), code: err.code }),
                );
              }
            }

            return;
          }

          if (parsed.ev) {
            const event: E[EventTypes] = parsed;
            const eventType: EventTypes = parsed.ev;

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

            return;
          }
        }
      });
    });
  }

  registerHandler<T extends MessageTypes>(
    name: T,
    handler: Fn<H[T]['request']['data'], H[T]['response']['data']>,
  ) {
    if (this.handlers[name]) throw new RPCError(`Handler ${name} was already registered`);
    this.handlers[name] = handler;
  }

  async sendEventRaw<T extends EventTypes>(event: E[T]) {
    const msg = JSON.stringify(event);

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
