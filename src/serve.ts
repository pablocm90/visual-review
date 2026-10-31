import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { servedPageHtml } from './core/page.ts';
import { parseReview } from './core/review.ts';

const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

type RefuseOptions = {
  readonly response: ServerResponse;
  readonly status: number;
  readonly error: Error;
};

const refuse = ({ response, status, error }: RefuseOptions): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(error.message);
};

type ServePageOptions = {
  readonly page: string | undefined;
  readonly version: string;
};

export const servePage = async ({ page, version }: ServePageOptions): Promise<string> => {
  if (page === undefined) throw new Error('Usage: visual-review serve <page.html>');
  const token = randomBytes(16).toString('hex');
  const html = servedPageHtml({ page: await readFile(page, 'utf8'), token, version });
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;
  const reviewFile = join(dirname(page), `${basename(page, '.html')}.review.json`);
  const sent = Promise.withResolvers<string>();
  server.on('request', async (request, response) => {
    const route = request.headers.host === host ? `${request.method} ${request.url}` : undefined;
    if (route === `POST /${token}/review`) {
      const review = await text(request)
        .then(parseReview)
        .catch((error: Error) => error);
      if (review instanceof Error) {
        refuse({ response, status: 400, error: review });
        return;
      }
      const unwritten = await writeFile(reviewFile, `${JSON.stringify(review, null, 2)}\n`).catch(
        (error: Error) => error,
      );
      if (unwritten instanceof Error) {
        refuse({ response, status: 500, error: unwritten });
        return;
      }
      response.writeHead(204).end();
      server.close();
      sent.resolve(reviewFile);
      return;
    }
    if (route !== `GET /${token}`) {
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
  return sent.promise;
};
