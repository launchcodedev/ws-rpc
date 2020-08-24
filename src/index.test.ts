import getPort from 'get-port';
import { EventVariant, MessageVariant, Server, Client } from './index';

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

    expect(await client.call('foo', {})).toEqual({ response: true });

    await client.close();
    await server.close();
  });
});
