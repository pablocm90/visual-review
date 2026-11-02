import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { z } from 'zod';
import { servedPageHtml } from './core/page.ts';
import { parseReview } from './core/review.ts';

const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

const openInBrowser = (url: string): void => {
  spawn(opener, [url], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
};

const LockSchema = z.strictObject({ pid: z.number(), port: z.number(), token: z.string() });

type Lock = z.infer<typeof LockSchema>;

const urlOf = ({ port, token }: { readonly port: number; readonly token: string }): string =>
  `http://127.0.0.1:${port}/${token}`;

const liveLock = async (lockFile: string): Promise<Lock | undefined> => {
  const lock = await readFile(lockFile, 'utf8')
    .then(written => LockSchema.parse(JSON.parse(written)))
    .catch(() => undefined);
  const answered =
    lock !== undefined &&
    (await fetch(`${urlOf(lock)}/ping`, { method: 'POST', signal: AbortSignal.timeout(1000) })
      .then(response => response.ok)
      .catch(() => false));
  return answered ? lock : undefined;
};

const beside = (page: string, extension: string): string =>
  join(dirname(page), `${basename(page, '.html')}.${extension}`);

type RefuseOptions = {
  readonly response: ServerResponse;
  readonly status: number;
  readonly error: Error;
};

const refuse = ({ response, status, error }: RefuseOptions): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(error.message);
};

type RouteOfOptions = {
  readonly request: IncomingMessage;
  readonly host: string;
};

const routeOf = ({ request, host }: RouteOfOptions): string | undefined =>
  request.headers.host === host ? `${request.method} ${request.url}` : undefined;

type TakeReviewOptions = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly reviewFile: string;
};

const tookReview = async ({
  request,
  response,
  reviewFile,
}: TakeReviewOptions): Promise<boolean> => {
  const review = await text(request)
    .then(parseReview)
    .catch((error: Error) => error);
  if (review instanceof Error) {
    refuse({ response, status: 400, error: review });
    return false;
  }
  const unwritten = await writeFile(reviewFile, `${JSON.stringify(review, null, 2)}\n`).catch(
    (error: Error) => error,
  );
  if (unwritten instanceof Error) {
    refuse({ response, status: 500, error: unwritten });
    return false;
  }
  response.writeHead(204).end();
  return true;
};

type AnswerWithPageOptions = {
  readonly response: ServerResponse;
  readonly pageNow: () => Promise<string>;
};

const answerWithPage = async ({ response, pageNow }: AnswerWithPageOptions): Promise<void> => {
  const html = await pageNow().catch((error: Error) => error);
  if (html instanceof Error) {
    refuse({ response, status: 500, error: html });
    return;
  }
  response
    .writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    .end(html);
};

type ServePageOptions = {
  readonly page: string | undefined;
  readonly version: string;
  readonly idleMs: number;
  readonly open: boolean;
};

export const servePage = async ({
  page,
  version,
  idleMs,
  open,
}: ServePageOptions): Promise<string | undefined> => {
  if (page === undefined) throw new Error('Usage: visual-review serve [--no-open] <page.html>');
  const lockFile = beside(page, 'serve');
  const lock = await liveLock(lockFile);
  if (lock !== undefined) {
    if (open) openInBrowser(urlOf(lock));
    else console.error(`Serving ${urlOf(lock)}`);
    return undefined;
  }
  const token = randomBytes(16).toString('hex');
  const pageNow = () =>
    readFile(page, 'utf8').then(written => servedPageHtml({ page: written, token, version }));
  await pageNow();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await rm(lockFile, { force: true })
    .then(() =>
      writeFile(lockFile, JSON.stringify({ pid: process.pid, port, token }), { mode: 0o600 }),
    )
    .catch((error: Error) => {
      server.close();
      throw error;
    });
  const host = `127.0.0.1:${port}`;
  const reviewFile = beside(page, 'review.json');
  const sent = Promise.withResolvers<string>();
  const unsent = (reason: string) => () => {
    server.close();
    sent.reject(new Error(`No review sent: ${reason}`));
  };
  const idle = setTimeout(unsent('the page was not open in a tab'), idleMs);
  const stopped = unsent('serve was stopped');
  server.on('request', async (request, response) => {
    const route = routeOf({ request, host });
    if (route === `POST /${token}/review`) {
      if (await tookReview({ request, response, reviewFile })) {
        server.close();
        sent.resolve(reviewFile);
      }
      return;
    }
    if (route === `POST /${token}/ping`) {
      idle.refresh();
      response.writeHead(204).end();
      return;
    }
    if (route !== `GET /${token}`) {
      response.writeHead(403).end();
      return;
    }
    await answerWithPage({ response, pageNow });
  });
  process.once('SIGINT', stopped).once('SIGTERM', stopped);
  const url = urlOf({ port, token });
  console.error(`Serving ${url}`);
  if (open) openInBrowser(url);
  return sent.promise.finally(() => {
    clearTimeout(idle);
    process.off('SIGINT', stopped).off('SIGTERM', stopped);
    return rm(lockFile, { force: true });
  });
};
