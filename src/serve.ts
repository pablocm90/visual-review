import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readFileThatEnds } from './core/file-that-ends.ts';
import { servedPageHtml } from './core/page.ts';
import { parseReview } from './core/review.ts';
import { writeAnew } from './write-anew.ts';

const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';

const openInBrowser = (url: string): void => {
  spawn(opener, [url], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
};

const LockSchema = z.strictObject({
  pid: z.number(),
  port: z.number(),
  token: z.string(),
  url: z.string(),
});

type Lock = z.infer<typeof LockSchema>;

const urlOf = ({ port, token }: { readonly port: number; readonly token: string }): string =>
  `http://127.0.0.1:${port}/${token}`;

const lockFileOf = async (page: string): Promise<string> => {
  const home = homedir();
  if (!isAbsolute(home)) throw new Error(`serve's lock needs an absolute home, not '${home}'`);
  return join(
    home,
    '.cache',
    'visual-review',
    'serve',
    `${createHash('sha256')
      .update(await realpath(page))
      .digest('hex')}.json`,
  );
};

const liveLock = async (lockFile: string): Promise<Lock | undefined> => {
  const lock = await readFile(lockFile, 'utf8')
    .then(written => LockSchema.parse(JSON.parse(written)))
    .catch(() => undefined);
  const answered =
    lock !== undefined &&
    (await fetch(`${urlOf(lock)}/alive`, { method: 'POST', signal: AbortSignal.timeout(1000) })
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

const fromACollaborator = (request: IncomingMessage): boolean =>
  (request.headers['x-amp-authenticated'] ?? '')
    .toString()
    .split(',')
    .map(token => token.trim())
    .includes('collaborator=yes');

type RouteOfOptions = {
  readonly request: IncomingMessage;
  readonly host: string;
  readonly portalHost: string | undefined;
};

const routeOf = ({ request, host, portalHost }: RouteOfOptions): string | undefined =>
  request.headers.host === host ||
  (request.headers.host === portalHost && fromACollaborator(request))
    ? `${request.method} ${request.url}`
    : undefined;

const portalFor = async (port: number): Promise<string> => {
  const registered = await promisify(execFile)('amp', [
    'orb',
    'portal',
    String(port),
    '--name',
    'visual-review',
    '--title',
    'Visual review',
  ]).catch((error: Error) => {
    throw new Error(`Can't open an Amp portal: ${error.message}`);
  });
  return registered.stdout.trim();
};

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
  const unwritten = await writeAnew({
    path: reviewFile,
    content: `${JSON.stringify(review, null, 2)}\n`,
  }).catch((error: Error) => error);
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
      'x-amp-review-widget': 'off',
    })
    .end(html);
};

type AnswerOptions = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly host: string;
  readonly portalHost: string | undefined;
  readonly token: string;
  readonly reviewFile: string;
  readonly pageNow: () => Promise<string>;
  readonly reviewed: () => void;
  readonly pinged: () => Promise<void>;
};

const answer = async ({
  request,
  response,
  host,
  portalHost,
  token,
  reviewFile,
  pageNow,
  reviewed,
  pinged,
}: AnswerOptions): Promise<void> => {
  const route = routeOf({ request, host, portalHost });
  if (route === `POST /${token}/review`) {
    if (await tookReview({ request, response, reviewFile })) reviewed();
    return;
  }
  if (route === `POST /${token}/alive`) {
    response.writeHead(204).end();
    return;
  }
  if (route === `POST /${token}/ping`) {
    await pinged();
    response.writeHead(204).end();
    return;
  }
  if (route === 'GET /' && request.headers.host === portalHost) {
    response.writeHead(302, { location: `/${token}` }).end();
    return;
  }
  if (route !== `GET /${token}`) {
    response.writeHead(403).end();
    return;
  }
  await answerWithPage({ response, pageNow });
};

type ServePageOptions = {
  readonly page: string | undefined;
  readonly version: string;
  readonly idleMs: number;
  readonly firstPingMs: number;
  readonly open: boolean;
  readonly amp: boolean;
};

export const servePage = async ({
  page,
  version,
  idleMs,
  firstPingMs,
  open,
  amp,
}: ServePageOptions): Promise<string | undefined> => {
  if (page === undefined)
    throw new Error('Usage: visual-review serve [--no-open] [--amp] <page.html>');
  const lockFile = await lockFileOf(page);
  const lock = await liveLock(lockFile);
  if (lock !== undefined) {
    if (open) openInBrowser(lock.url);
    else console.error(`Serving ${lock.url}`);
    return undefined;
  }
  const token = randomBytes(16).toString('hex');
  const pageNow = () =>
    readFileThatEnds(page).then(written => servedPageHtml({ page: written, token, version }));
  await pageNow();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const portal = amp
    ? await portalFor(port).catch((error: Error) => {
        server.close();
        throw error;
      })
    : undefined;
  const url = portal === undefined ? urlOf({ port, token }) : new URL(token, portal).href;
  await mkdir(dirname(lockFile), { recursive: true })
    .then(() =>
      writeAnew({
        path: lockFile,
        content: JSON.stringify({ pid: process.pid, port, token, url }),
        mode: 0o600,
      }),
    )
    .catch((error: Error) => {
      server.close();
      throw new Error(`Can't write serve's lock: ${error.message}`);
    });
  const host = `127.0.0.1:${port}`;
  const reviewFile = beside(page, 'review.json');
  const sent = Promise.withResolvers<string>();
  const unsent = (reason: string) => () => {
    server.close();
    sent.reject(new Error(`No review sent: ${reason}`));
  };
  const notOpen = unsent('the page was not open in a tab');
  const unpinged = setTimeout(notOpen, firstPingMs);
  const firstPing = Promise.withResolvers<void>();
  const idle = firstPing.promise.then(() => {
    clearTimeout(unpinged);
    return setTimeout(notOpen, idleMs);
  });
  const stopped = unsent('serve was stopped');
  server.on('request', (request, response) =>
    answer({
      request,
      response,
      host,
      portalHost: portal === undefined ? undefined : new URL(portal).host,
      token,
      reviewFile,
      pageNow,
      reviewed: () => {
        server.close();
        sent.resolve(reviewFile);
      },
      pinged: async () => {
        firstPing.resolve();
        (await idle).refresh();
      },
    }),
  );
  process.once('SIGINT', stopped).once('SIGTERM', stopped);
  console.error(`Serving ${url}`);
  if (open) openInBrowser(url);
  return sent.promise.finally(() => {
    clearTimeout(unpinged);
    void idle.then(clearTimeout);
    process.off('SIGINT', stopped).off('SIGTERM', stopped);
    return rm(lockFile, { force: true });
  });
};
