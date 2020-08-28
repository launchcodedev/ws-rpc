import getPort from 'get-port';
import ReconnectingWS from 'reconnecting-websocket';
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
    const client = new Client('localhost', port);

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
    const client = new Client('localhost', port);

    server.registerHandler('foo', async () => {
      throw new Error('something went wrong');
    });

    await expect(client.call('foo', {})).rejects.toHaveProperty(
      'message',
      'Error: something went wrong',
    );

    await client.close();
    await server.close();
  });

  test('on event', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await new Client('localhost', port).waitForConnection();

    expect.assertions(2);

    client.on('foo', async (event) => {
      expect(event).toEqual('bar');
    });

    await server.sendEvent('foo', 'bar');
    await server.sendEvent('foo', 'bar');

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });

  test('once event', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await new Client('localhost', port).waitForConnection();

    expect.assertions(1);

    client.once('foo', async (event) => {
      expect(event).toEqual('bar');
    });

    // trigger twice, but should only be seen once
    await server.sendEvent('foo', 'bar');
    await server.sendEvent('foo', 'bar');

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });

  test('remove listener', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await new Client('localhost', port).waitForConnection();

    expect.assertions(1);

    const handler = async () => expect(true).toBe(true);
    client.on('foo', handler);

    await server.sendEvent('foo');
    await new Promise((r) => setTimeout(r, 100));
    client.removeEventListener('foo', handler);

    await server.sendEvent('foo');

    await new Promise((r) => setTimeout(r, 100));

    await client.close();
    await server.close();
  });

  test('unimplemented function', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await new Client('localhost', port).waitForConnection();

    await expect(client.call('foo', undefined)).rejects.toThrow(
      "Function 'foo' had no handlers in the server",
    );

    await client.close();
    await server.close();
  });
});

describe('reconnecting websocket', () => {
  test('disconnection', async () => {
    const port = await getPort();
    const server = new Server(port);
    const client = await new Client(
      new ReconnectingWS(`ws://localhost:${port}`, [], { connectionTimeout: 10 }),
    ).waitForConnection();

    // the server closed before trying to ping
    await server.close();

    await expect(client.call('ping', {}, 10)).rejects.toBeTruthy();

    // now there's a new server in its place
    const newServer = new Server(port);
    newServer.registerHandler('ping', () => 'pong');

    await expect(client.call('ping', {})).resolves.toEqual('pong');

    await client.close();
    await newServer.close();
  });
});
