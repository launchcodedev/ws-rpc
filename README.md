## Simple Websocket RPC
This package provides the minimal set of boilerplate that's normally needed when setting up a client-server websocket.

It's a really lightweight alternative to socket.io and similar systems. The big benefit is that it's fully type-safe,
and you can read all of the source code in 10 minutes. Don't build giant systems on this - it's meant for small
communication layers between software, usually in single-tenant systems.

```
yarn add @lcdev/ws-rpc@VERSION
```

## Quickstart
Normally, you'd have some shared code between server and client (backend and frontend). It would look like this:

```typescript
import { Server as BaseServer, Client as BaseClient, MessageVariant, EventVariant } from 'ws-rpc';

export enum MessageType {
  Ping = 'Ping',
  DoSomething = 'DoSomething',
}

export enum EventType {
  SomethingInterestingHappened = 'SomethingInterestingHappened',
}

export type Messages = {
  [MessageType.Ping]: MessageVariant<MessageType.Ping, void, 'pong'>;
  [MessageType.DoSomething]: MessageVariant<MessageType.DoSomething, { input: string }, { output: string }>;
};

export type Events = {
  [EventType.SomethingInterestingHappened]: EventVariant<EventType.SomethingInterestingHappened, { attachedData: string }>;
};

export class Client extends BaseClient<MessageType, EventType, Messages, Events> {}
export class Server extends BaseServer<MessageType, EventType, Messages, Events> {}
```

Now you have a `Client` and `Server`, who know how to talk to each other.

On the server side, you'd register function handlers and listen for events.

```typescript
const server = new Server(port);

server.registerHandler(MessageType.Ping, () => {
  return 'pong';
});

server.registerHandler(MessageType.DoSomething, ({ input }) => {
  return { output: 'out' + input };
});
```

On the client side, you can call those functions.


```typescript
const client = new Client('localhost', port);

const pong = await client.call(MessageType.Ping, undefined);
const something = await client.call(MessageType.DoSomething, { input: 'in' });
```

Most importantly, this is **type safe**. Function calls and handlers are constrained by typescript and the types you've given.

### Events
Both servers and clients can send or receive 'events'. These are assumed to be bidirectional - they could be sent either direction.

```typescript
server.on(EventType.SomethingInterestingHappened, ({ attachedData }) => {
  console.log(`Something happened! ${attachedData}`)
});

await client.sendEvent(EventType.SomethingInterestingHappened, { attachedData: 'foobar' });
```

Both sides can send, or receive events.
