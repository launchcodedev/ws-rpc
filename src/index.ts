import { Json } from '@lcdev/ts';
import WebSocket from 'ws';
import uuid from 'uuid/v4';

type MessageType = string;
type EventType = string;

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
    type: T;
    /** A unique UUID, to identify messages (to correspond request & response) */
    messageID: string;
    /** What data comes with the message */
    data: Data;
  };
  response: {
    /** The MessageType, which describes what to expect from the message */
    type: T;
    /** A unique UUID, to identify messages (to correspond request & response) */
    messageID: string;
    /** What data comes back from the message */
    data: ResponseData;
  };
};

export type EventVariant<T extends EventType, Data extends Json | void> = {
  event: T;
  data: Data;
};

export class Client<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> {
  websocket: WebSocket;
  connecting: Promise<void>;

  constructor(host: string, port: number) {
    this.websocket = new WebSocket(`ws://${host}:${port}`);

    this.websocket.addEventListener('error', (err) => {
      console.error(err);
    });

    this.connecting = new Promise((resolve, reject) => {
      this.websocket.addEventListener('open', () => resolve());
      this.websocket.addEventListener('error', (err) => reject(err));
    });
  }

  async callRaw<T extends MessageTypes>(req: H[T]['request']): Promise<H[T]['response']> {
    await this.connecting;

    const response = new Promise<H[T]['response']>((resolve) => {
      const listener = ({ data }: { data: string }) => {
        if (typeof data === 'string') {
          const parsed = JSON.parse(data);

          // probably an event
          if (!parsed.type) return;

          const response: H[T]['response'] = parsed;

          if (response.messageID === req.messageID) {
            resolve(response);

            this.websocket.removeEventListener('message', listener);
          }
        }
      };

      // TODO: batch event listeners into one
      this.websocket.addEventListener('message', listener);
      this.websocket.send(JSON.stringify(req));
    });

    return Promise.race([
      response,
      new Promise<any>((_, reject) =>
        setTimeout(() => {
          // TODO: removeEventListener
          reject();
        }, 15000),
      ),
    ]);
  }

  async call<T extends MessageTypes>(
    name: T,
    req: H[T]['request']['data'],
  ): Promise<H[T]['response']['data']> {
    const fullRequest = {
      type: name,
      messageID: uuid(),
      data: req,
    } as H[T]['request'];

    const fullResponse = await this.callRaw<T>(fullRequest);

    return fullResponse.data;
  }

  async sendEvent<T extends EventTypes>(event: E[T]) {
    await this.connecting;
    this.websocket.send(JSON.stringify(event));
  }

  onEvent<T extends EventTypes>(e: T, handler: (event: E[T]) => void) {
    this.websocket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);

        if (parsed.type === e) {
          handler(parsed);
        }
      }
    });
  }

  async close() {
    this.websocket.close();
  }
}

type Fn<Arg, Ret = void> = (arg: Arg) => Promise<Ret>;

export class Server<
  MessageTypes extends MessageType,
  EventTypes extends EventType,
  H extends MessageVariants<MessageTypes>,
  E extends EventVariants<EventTypes>
> {
  websocket: WebSocket.Server;
  connections: WebSocket[] = [];

  handlers: {
    [T in MessageTypes]?: Fn<H[T]['request']['data'], H[T]['response']['data']>[];
  } = {};

  eventHandlers: { [T in EventTypes]?: Fn<E[T]>[] } = {};

  constructor(port: number) {
    this.websocket = new WebSocket.Server({ port });

    this.websocket.on('connection', async (ws) => {
      this.connections.push(ws);

      ws.on('close', () => {
        this.connections = this.connections.filter((c) => c !== ws);
      });

      ws.on('message', async (req) => {
        if (typeof req === 'string') {
          const parsed = JSON.parse(req);

          if (parsed.event) {
            const event: E[EventTypes] = parsed;
            const eventType: EventTypes = parsed.event;

            for (const handler of this.eventHandlers[eventType] ?? []) {
              await handler(event);
            }
          } else if (parsed.type) {
            const { type, messageID, data }: H[MessageTypes]['request'] = parsed;

            for (const handler of this.handlers[type as MessageTypes] ?? []) {
              const responseData = await handler(data);
              ws.send(JSON.stringify({ type, messageID, data: responseData }));
            }
          }
        }
      });
    });
  }

  registerHandler<T extends MessageTypes>(
    name: T,
    handler: Fn<H[T]['request']['data'], H[T]['response']['data']>,
  ) {
    this.handlers[name] = this.handlers[name] || [];
    this.handlers[name]!.push(handler);
  }

  async sendEvent<T extends EventTypes>(event: E[T]) {
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

  onEvent<T extends EventTypes>(e: T, handler: (event: E[T]) => Promise<void>) {
    this.eventHandlers[e] = this.eventHandlers[e] ?? [];
    this.eventHandlers[e]!.push(handler);
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
