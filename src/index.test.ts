import getPort from 'get-port';
import { jsonSerialization, build, Builder } from './index';
import bsonSerialization from './bson';

const setupClientAndServer = async <B extends Builder<any>>(
  builder: B,
  handlers: B['FunctionHandlers'],
): Promise<[B['Connection'], B['Connection']]> => {
  const port = await getPort();
  const server = await builder.server(handlers).listen(port);
  const client = await builder.client().connect(port);

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
      expect.assertions(2);

      client.on('test', (data) => expect(data).toBeUndefined());
      server.on('test', (data) => expect(data).toBeUndefined());

      await client.sendEvent('test');
      await server.sendEvent('test');

      // TODO: close() should finish propagation
      await delay(10);
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
});

describe('reconnecting-websocket', () => {});

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
