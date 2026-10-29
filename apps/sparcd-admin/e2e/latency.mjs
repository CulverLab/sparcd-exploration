// A loopback stand-in for slow storage, used only by the suite.
//
// Real deployments sit behind 100–200 ms per request; loopback MinIO answers in
// under a millisecond, so every race the app has with its own reloads is
// invisible here. This forwarder sits between the access proxy and MinIO and
// holds each request for `E2E_LATENCY_MS` plus up to 50% jitter before passing
// it on, byte for byte.
//
// Byte for byte matters: the proxy signs its requests against the host it
// dialled, so the `host` header and the body have to arrive upstream exactly as
// they were signed. Nothing here rewrites either — MinIO recomputes the
// signature over the forwarder's host and gets the same answer.

import http from 'node:http';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a delaying forwarder in front of `target`, and return its origin. */
export async function startLatencyForwarder(target, latencyMs) {
  const upstream = new URL(target);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

  const server = http.createServer((req, res) => {
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', () => res.destroy());
    req.on('end', async () => {
      await sleep(latencyMs * (1 + Math.random() * 0.5));
      const forward = http.request({
        agent,
        host: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers,
      }, (answer) => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      });
      forward.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      for (const chunk of chunks) forward.write(chunk);
      forward.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      agent.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
