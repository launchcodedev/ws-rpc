import getPort from 'get-port';
import { unlinkSync } from 'fs';
import { resolve } from 'path';
import WS from 'ws';
import ReconnectingWS from 'reconnecting-websocket';
import http from 'http';
import https from 'https';

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

describe('reconnecting-websocket', () => {
  const fastReconnectingWS = (port: number) =>
    new ReconnectingWS(`ws://localhost:${port}`, [], {
      connectionTimeout: 10,
      minReconnectionDelay: 10,
      maxReconnectionDelay: 10,
      WebSocket: WS,
    });

  it('reconnects after server disconnects', async () => {
    const common = build(jsonSerialization);

    const port = await getPort();
    const server = await common.server({}, false).listen(port);
    const client = await common.client(false).connect(fastReconnectingWS(port));

    await expect(client.ping()).resolves.toBeUndefined();

    // the first server was closed
    await server.close();

    // now there's a new server in its place
    const server2 = await common.server({}, false).listen(port);

    await new Promise((r) => setTimeout(r, 100));

    try {
      await expect(client.ping()).resolves.toBeUndefined();
    } finally {
      await server2.close();
      await client.close();
    }
  });

  it('connects to server after first rejection', async () => {
    const common = build(jsonSerialization);

    const port = await getPort();

    const ws = fastReconnectingWS(port);
    const clientBuilder = common.client(false);

    await expect(clientBuilder.connect(ws)).rejects.toBeTruthy();

    const server = await common.server({}, false).listen(port);
    const client = await clientBuilder.connect(ws);

    try {
      await expect(client.ping()).resolves.toBeUndefined();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

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

describe('http(s) servers', () => {
  it('connects using an http server', async () => {
    const port = await getPort();
    const httpServer = http.createServer();
    httpServer.listen(port);

    const common = build(jsonSerialization);
    const server = await common.server({}, false).listen(httpServer);
    const client = await common.client(false).connect(port);

    try {
      await client.ping();
      await server.ping();
    } finally {
      await server.close();
      await client.close();
    }
  });

  it('connects using an https server', async () => {
    const port = await getPort();
    const httpsServer = https.createServer({ cert: selfSignedCert, key: selfSignedKey });
    httpsServer.listen(port);

    const wsClient = new WS(`wss://localhost:${port}`, { ca: [selfSignedCert] });

    const common = build(jsonSerialization);
    const server = await common.server({}, false).listen(httpsServer);
    const client = await common.client(false).connect(wsClient);

    try {
      await client.ping();
      await server.ping();
    } finally {
      await server.close();
      await client.close();
    }
  });
});

const selfSignedCert = `
-----BEGIN CERTIFICATE-----
MIIDOzCCAiOgAwIBAgIJYhn5rcdHL6V/MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMTCWxvY2FsaG9zdDAeFw0yMTAxMDIwMzI1MDRaFw0zMDEyMzEwMzI1MDRaMBQx
EjAQBgNVBAMTCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBAPVv2uJZm8AVCmCT74x+1iLTGkGUqBevjWAIi/ynpDt6nESb6MjKpQV0zc8S
fbFJK/8PWMS7xlllRRrEYMbLWLE3CvobYPOMU83JgEBJpDT0lV74kOSzEdvpqnQA
EVpB0FEAQ1sZgo1YmrRq1mB/C/Vqs0JQH4NUwc46gjEN5B/EyuNMeQVoZpnJvPCv
3SgSU2X3vi+a6n/HaDMMH/cA5gp9USVBLGFDnuRxnNOumac7a3VvSjMrZqwEpRBC
tgMCvfkC8RfAzgyoh+xFjnb6aJwbEhLsxp7oTYDXyLP1FImVLyF5b6RM2Bd6VWmh
XFBTuuv8jD9VI0BmG7Lel6pOtAcCAwEAAaOBjzCBjDALBgNVHQ8EBAMCAvQwMQYD
VR0lBCowKAYIKwYBBQUHAwEGCCsGAQUFBwMCBggrBgEFBQcDAwYIKwYBBQUHAwgw
SgYDVR0RBEMwQYIJbG9jYWxob3N0ghVsb2NhbGhvc3QubG9jYWxkb21haW6CBVs6
OjFdhwR/AAABhxD+gAAAAAAAAAAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQCS
todGx7DaaYyGUsNX0l+mS9KBgf8GEbt0kvpu9lHKJfw5vvA2LnLEzrBCI3BO/b+Q
KBjAktkK84iPuSZ2OIpodr/z0yIyElBwLK3273ccinlXeEbrshBwFp8SFTf/SAcL
ZGTH5HGySZQM4Lel+XJ7VpDzAe2iqT1H/vRlV9l0t8srNOWQbOqhvg/NCREKYOWQ
mjpNj8QCSBuvQphH5GuNyNVA07G4hXOBezWwhEwcq1HJrDJnBF/jtSqTjpegeNqT
DyXMsoKTfPPzlV9dBNRmGcxF4r4Mus1/lDmhpTEpIg0YNfRFUKCSH7TWzRhN9LWP
Qmqe4aTR6sntE8otYLhE
-----END CERTIFICATE-----
`;

const selfSignedKey = `
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA9W/a4lmbwBUKYJPvjH7WItMaQZSoF6+NYAiL/KekO3qcRJvo
yMqlBXTNzxJ9sUkr/w9YxLvGWWVFGsRgxstYsTcK+htg84xTzcmAQEmkNPSVXviQ
5LMR2+mqdAARWkHQUQBDWxmCjViatGrWYH8L9WqzQlAfg1TBzjqCMQ3kH8TK40x5
BWhmmcm88K/dKBJTZfe+L5rqf8doMwwf9wDmCn1RJUEsYUOe5HGc066ZpztrdW9K
MytmrASlEEK2AwK9+QLxF8DODKiH7EWOdvponBsSEuzGnuhNgNfIs/UUiZUvIXlv
pEzYF3pVaaFcUFO66/yMP1UjQGYbst6Xqk60BwIDAQABAoIBAAMV/PKLneG0YgUE
1yY1EgwuC053yAVEN8rVUK1EjlQRHpXeP/cGVTzUUyIfYWUxPlRepQcUNVI6a7wC
bBUTyXGw93pdjcKCKSuVNP+Z7W6dBKPFDE1T0w2oynPa7FzuJuhd0Hr8vx931boe
/cMI1eWoCcjzqPHFxwoIwkpLmmqr0HOTUF0C7Z2RIo7zNQoh9OLhaC/6pZ7JhAtt
J4+GCZPEIVrqVKtmBaHJiN+xtmR+eOMp3s3pjBbwfzwPGPrwEicgMmqgfghpRTMP
4RxlqgcAuKrBv94mKMuwCbm37Mkkx9DlOLFioqQ0d8m9CGV1qN5Stg/thVIe66h6
Xr2nr0ECgYEA+7KfFm+tbTFalw2mB4zEmTB4l2SrcRtqUzKTsKoOBDcCqenCVuGE
6lBrmREic2DTlWGbfp9dJzhu1px1r/T24VWKzFRlX2e2TLdMpba9PrUmRk13iWQY
csFyIYckBImF2MLpBhV3FIZIrSQocT+pjzBaIIaix1Vq4X65xu8BMm0CgYEA+aHW
afCrPtiqwnFnCqCWHB+oc2kfcX18g0+hwlofRysuf8MMogKjC6C1p2rA8CcRqNTV
q1WPfW+svh/Qbc+Vdvw3CwgLsXhswo9bB7umCqCCkYaSP78nLDF32tLUAz21kEGo
xfO0M8WqNANabgTXbZo2L0BIVw7x+cTpaFXjl8MCgYEA2H7MziyjHMAN7s3jmKzh
Ue7aW0ZRHQn6y7M+TAAJ7GAw31vdOIPkovMnidKuMlX/yIbbi++h3aFx3RFZPU9U
p3+/0n9pbsWzjYtA1202nGCOmnv5rOi3CsYP2Hz4YxqzUT5d10jRU4spqhvm2Xpr
62korL+B9jknpOwu+ckM24UCgYAZODVuPIdAcSlHPae4ViL0MmqVRlCL6a6ToY7p
EKvKR92JwM3c7EFGonTXthxJ5tiM4vu3NIyrkoW0K4imH2utOqvg7G4p/s2WFl+O
93E975thUmQiFpDBkTnXnKcYsLpQGaIQZZ+V/2lDmfcf2FNfWk4RFgB48ySVJESk
atD0ewKBgQDK2m3yl0Iy7oCCmaG2Nrikjnq8LlJUJ95hpHV+EpQzHMwhjMlTNvfu
D28fsb2p9IUjRaXwMEar+3p6CCx38xeVC9lGX+mhRZ33Kh0Jv2oL7wlqqoZsycl3
K5TMnca38A5sR4o90XUNgoM6FnIB8MnW04B6Zhv3ijbGLEjcRiXjow==
-----END RSA PRIVATE KEY-----
`;
