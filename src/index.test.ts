import getPort from 'get-port';
import { Server, Client } from './index';

describe('server', () => {
  test('start', async () => {
    const server = new Server(await getPort());

    await server.close();
  });
});

describe('server and client', () => {
  test('basic message', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await Client.connect('localhost', port);

    server.registerHandler('foo', async () => {
      return { response: true };
    });

    await expect(client.call('foo', {})).resolves.toEqual({ response: true });
    await expect(client.call('bar', {}, 10)).rejects.toBeTruthy();

    await client.close();
    await server.close();
  });

  test('error in handler', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await Client.connect('localhost', port);

    server.registerHandler('foo', async () => {
      throw new Error('something went wrong');
    });

    await expect(client.call('foo', {})).rejects.toHaveProperty('message', 'Error: something went wrong')

    await client.close();
    await server.close();
  });

  test('on event', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await Client.connect('localhost', port);

    expect.assertions(2);

    client.on('foo', async (event) => {
      expect(event).toEqual({ ev: 'foo', data: 'bar' });
    });

    await server.sendEvent('foo', { data: 'bar' });
    await server.sendEvent('foo', { data: 'bar' });

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });

  test('once event', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await Client.connect('localhost', port);

    expect.assertions(1);

    client.once('foo', async (event) => {
      expect(event).toEqual({ ev: 'foo', data: 'bar' });
    });

    // trigger twice, but should only be seen once
    await server.sendEvent('foo', { data: 'bar' });
    await server.sendEvent('foo', { data: 'bar' });

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });

  test('remove listener', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await Client.connect('localhost', port);

    expect.assertions(1);

    const handler = async (ev: any) => expect(ev).toEqual({ ev: 'foo' });
    client.on('foo', handler);

    await server.sendEvent('foo', { data: undefined });
    await new Promise((r) => setTimeout(r, 100));
    client.removeEventListener('foo', handler);

    await server.sendEvent('foo', { data: undefined });

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });
});
