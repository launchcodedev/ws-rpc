import getPort from 'get-port';
import { EventVariant, MessageVariant, Server, Client } from './index';

describe('server', () => {
  test('start', async () => {
    const server = new Server(await getPort());

    await server.close();
  });
});
