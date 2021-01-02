import getPort from 'get-port';
import { unlinkSync } from 'fs';
import { resolve } from 'path';
import { jsonSerialization, build, Builder } from './index';
import bsonSerialization from './bson';

const setupClientAndServer = async <B extends Builder<any>>(
  builder: B,
  handlers: B['FunctionHandlers'],
  shouldValidate?: boolean,
): Promise<[B['Connection'], B['Connection']]> => {
  const port = await getPort();
  const server = await builder.server(handlers, shouldValidate).listen(port);
  const client = await builder.client(shouldValidate).connect(port);

  return [client, server];
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('server & client connection', () => {
  it('sends and receives ping', async () => {
    const common = build(jsonSerialization);
    const [client, server] = await setupClientAndServer(common, {});

    try {
      await client.ping();
      await server.ping();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('sends and receives a basic function', async () => {
    const common = build(jsonSerialization).func<'test'>();
    const [client, server] = await setupClientAndServer(common, { async test() {} });

    try {
      await client.test();
      await server.test();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('sends and receives a basic event', async () => {
    const common = build(jsonSerialization).event<'test'>();
    const [client, server] = await setupClientAndServer(common, {});

    try {
      const clientReceive = client.one('test');
      const serverReceive = server.one('test');

      await client.sendEvent('test');
      await server.sendEvent('test');

      await expect(clientReceive).resolves.toBeUndefined();
      await expect(serverReceive).resolves.toBeUndefined();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('removes all event listeners by name', async () => {
    const common = build(jsonSerialization).event<'test', 'data'>();
    const [client, server] = await setupClientAndServer(common, {});

    try {
      expect.assertions(10); // 5 events x 2 listeners

      client.on('test', (data) => expect(data).toBe('data'));
      client.on('test', (data) => expect(data).toBe('data'));

      for (const _ of new Array(5).fill(0)) {
        await server.sendEvent('test', 'data');
      }

      // wait for events to have been received
      await client.one('test');

      // after 'off', should have no event listeners
      client.off('test');

      await server.sendEvent('test', 'data');
      await server.sendEvent('test', 'data');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('removes all event listeners by callback', async () => {
    const common = build(jsonSerialization).event<'test', 'data'>();
    const [client, server] = await setupClientAndServer(common, {});

    try {
      expect.assertions(12); // 5 x 2 events + 2 events

      const callback1 = (data: 'data') => expect(data).toBe('data');
      const callback2 = (data: 'data') => expect(data).toBe('data');

      client.on('test', callback1);
      client.on('test', callback2);

      for (const _ of new Array(5).fill(0)) {
        await server.sendEvent('test', 'data');
      }

      // wait for events to have been received
      await client.one('test');

      // turn off callback1, callback2 should still be alive
      client.off('test', callback1);

      await server.sendEvent('test', 'data');
      await server.sendEvent('test', 'data');

      // wait for events to have been received
      await client.one('test');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('sets isClosed correctly', async () => {
    const common = build(jsonSerialization);
    const [client, server] = await setupClientAndServer(common, {});

    try {
      expect(client.isClosed()).toBe(false);
      expect(server.isClosed()).toBe(false);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    expect(client.isClosed()).toBe(true);
    expect(server.isClosed()).toBe(true);
  });
});

describe('validation', () => {
  it('validates a basic event', async () => {
    const common = build(jsonSerialization).event<'test'>(
      'test',
      () => new Error('Validation Error'),
    );

    const [client, server] = await setupClientAndServer(common, {});

    try {
      await expect(client.sendEvent('test')).rejects.toThrow();
      await expect(server.sendEvent('test')).rejects.toThrow();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("does't validate events when passed shouldValidate = false", async () => {
    const common = build(jsonSerialization).event<'test'>(
      'test',
      () => new Error('Validation Error'),
    );

    const [client, server] = await setupClientAndServer(common, {}, false);

    try {
      await client.sendEvent('test');
      await server.sendEvent('test');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('validates a basic function', async () => {
    const common = build(jsonSerialization).func<'test'>(
      'test',
      () => new Error('Validation Error'),
    );

    const [client, server] = await setupClientAndServer(common, { async test() {} });

    try {
      await expect(client.test()).rejects.toThrow();
      await expect(server.test()).rejects.toThrow();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("does't validate function when passed shouldValidate = false", async () => {
    const common = build(jsonSerialization).func<'test'>(
      'test',
      () => new Error('Validation Error'),
    );

    const [client, server] = await setupClientAndServer(common, { async test() {} }, false);

    try {
      await client.test();
      await server.test();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe('error conditions', () => {
  it('times out on function call', async () => {
    const common = build(jsonSerialization).func<'test'>();
    const [client, server] = await setupClientAndServer(common, {
      async test() {
        await delay(100);
      },
    });

    try {
      await expect(client.test(undefined, 10)).rejects.toThrow();
      await expect(client.test(undefined, 200)).resolves.toBeUndefined();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('fails to send ping when server is closed', async () => {
    const common = build(jsonSerialization);
    const [client, server] = await setupClientAndServer(common, {});

    try {
      await client.ping();
      await server.close();

      await expect(client.ping(10)).rejects.toThrow();
      await expect(client.ping(10)).rejects.toThrow();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('fails to send ping when client is closed', async () => {
    const common = build(jsonSerialization);
    const [client, server] = await setupClientAndServer(common, {});

    try {
      await server.ping();
      await client.close();

      await expect(server.ping(10)).rejects.toThrow();
      await expect(server.ping(10)).rejects.toThrow();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe('custom serialization formats', () => {
  it('uses bson format to serialize Dates', async () => {
    const common = build(bsonSerialization)
      .event<'test', { at: Date }>()
      .func<'test', { at: Date }, { ret: Date }>();

    const [client, server] = await setupClientAndServer(common, {
      async test({ at }) {
        expect(at).toBeInstanceOf(Date);

        return { ret: new Date() };
      },
    });

    try {
      // 2 in listeners, 2 in func handler, 2 of return values
      expect.assertions(6);

      client.on('test', ({ at }) => expect(at).toBeInstanceOf(Date));
      server.on('test', ({ at }) => expect(at).toBeInstanceOf(Date));

      await client.sendEvent('test', { at: new Date() });
      await server.sendEvent('test', { at: new Date() });

      expect(await client.test({ at: new Date() }).then((v) => v.ret)).toBeInstanceOf(Date);
      expect(await server.test({ at: new Date() }).then((v) => v.ret)).toBeInstanceOf(Date);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe('reconnecting-websocket', () => {});

describe('unix sockets', () => {
  it('connects and sends messages over unix socket', async () => {
    const common = build(jsonSerialization)
      .func<'test', { input: number }, { output: number }>()
      .event<'testing', { data: true }>();

    const temp = resolve('./tmp');
    const server = await common
      .server({
        async test({ input }) {
          return { output: input };
        },
      })
      .listen({ socket: temp });

    const client = await common.client().connect({ socket: temp });

    try {
      await client.ping();
      await server.ping();

      expect.assertions(3);

      client.on('testing', ({ data }) => expect(data).toBe(true));
      server.on('testing', ({ data }) => expect(data).toBe(true));

      await client.sendEvent('testing', { data: true });
      await server.sendEvent('testing', { data: true });

      expect(await client.test({ input: 88 })).toEqual({ output: 88 });
    } finally {
      unlinkSync(temp);
      await Promise.all([client.close(), server.close()]);
    }
  });
});
