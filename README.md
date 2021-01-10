## Simple Websocket RPC

This package provides the minimal set of boilerplate that's normally needed when setting up a client-server websocket.

It's a really lightweight alternative to socket.io and similar systems. The
benefit is that it's fully type-safe, and you can read all of the source code
in about 10 minutes.

You probably shouldn't build giant systems on this (at least, talk to us first).
It's meant for small communication layers between software, usually in single-tenant systems.

[App Config](https://app-config.dev) uses this library internally, for it's "secret agent".

```
yarn add @lcdev/ws-rpc
```

## Quickstart

Normally, you'd have some shared code between server and client (backend and frontend). It would look like this:

```typescript
import { build } from '@lcdev/ws-rpc';

const common = build({ deserialize: JSON.parse, serialize: JSON.stringify })
  // functions are client -> server. input and outputs can be anything serializable.
  .func<'double', { num: number }, { doubled: number }>()
  .func<'triple', { num: number }, { tripled: number }>()
  // events are bi-directional, they can be sent or received on both sides.
  .event<'single'>()
  .event<'random', { rand: number }>()
  .event<'scheduled', { rand: number }>();
```

In a Node.js server, we can use the common code:

```typescript
import { common } from 'my-common-rpc';

common
  .server({
    async double({ num }) {
      return { doubled: num * 2 };
    },
    async triple({ num }) {
      return { tripled: num * 3 };
    },
  })
  // you can pass a host, port, a WS.Server, http(s) server
  .listen(3000)
  .then((server) => {
    setTimeout(() => {
      server.sendEvent('single');
    }, 500);

    const runRandom = () => {
      setTimeout(() => {
        // IMPORTANTLY, TypeScript knows the type of all events
        server.sendEvent('random', { rand: Math.random() });

        runRandom();
      }, Math.random() * 500);
    };

    runRandom();

    setInterval(() => {
      server.sendEvent('scheduled', { rand: Math.random() });
    }, 500);
  })
  .catch(console.error);
```

Then on the client side:

```typescript
import { common } from 'my-common-rpc';

common
  .client()
  .connect(3000)
  .then((client) => {
    client.on('single', () => {
      console.log('received single');
    });

    client.on('random', ({ rand }) => {
      console.log('received random', rand);
    });

    client.on('scheduled', ({ rand }) => {
      console.log('received scheduled', rand);
    });

    // just call functions like you would call a normal function
    // TypeScript also knows the type of all functions
    client.double({ num: 2 }).then(({ doubled }) => console.log('doubled to', doubled));
    client.triple({ num: 2 }).then(({ tripled }) => console.log('tripled to', tripled));
  })
  .catch(console.error);
```

## Features

- Custom data serialization support, use BSON via `@lcdev/ws-rpc/bson` export
- Custom client websocket library support by passing the client in `connect`
- Custom server support by passing the server in `listen` (including node `http` and `https` servers)
- Unix socket support, just pass `{ socket: 'filepath' }` in client & server
- Optional validation of function data using custom validation functions in `func` and `event` builders
- Lazy loading of modules, no special browser or server setup needed
- Exports `setLogLevel` function to help see what's happening internally
