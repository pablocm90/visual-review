import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { servedPageHtml } from './core/page.ts';

const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

export const servePage = async (page: string | undefined): Promise<string> => {
  const token = randomBytes(16).toString('hex');
  const html = servedPageHtml({ page: await readFile(page ?? '', 'utf8'), token });
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;
  server.on('request', (request, response) => {
    if (request.headers.host !== host || request.url !== `/${token}`) {
      response.writeHead(403).end();
      return;
    }
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      .end(html);
  });
  const url = `http://${host}/${token}`;
  console.error(`Serving ${url}`);
  spawn(opener, [url], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
  return new Promise(() => {});
};
