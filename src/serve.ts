import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { servedPageHtml } from './core/page.ts';

const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

export const servePage = async (page: string | undefined): Promise<string> => {
  const token = randomBytes(16).toString('hex');
  const html = servedPageHtml({ page: await readFile(page ?? '', 'utf8'), token });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/${token}`;
    console.error(`Serving ${url}`);
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
  });
  return new Promise(() => {});
};
