import getPort from 'get-port';
import { Client, Server } from './bson';

describe('server and client', () => {
  it('serializes dates', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = new Client('localhost', port);

    const now = new Date();

    server.registerHandler('foo', async () => {
      return { now };
    });

    await expect(client.call('foo', {})).resolves.toEqual({ now });

    await client.close();
    await server.close();
  });

  it('uses bson for events', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = new Client('localhost', port);

    expect.assertions(2);

    const data = Buffer.from([1, 2, 3, 4]);

    server.once('bar', async (res) => {
      expect((res as Buffer).equals(data)).toBe(true);
    });

    client.once('bar', async (res) => {
      expect((res as Buffer).equals(data)).toBe(true);
    });

    await client.sendEvent('bar', data);
    await client.sendEvent('bar', data);
    await server.sendEvent('bar', data);
    await server.sendEvent('bar', data);

    await new Promise((r) => setTimeout(r, 1000));

    await client.close();
    await server.close();
  });
});
