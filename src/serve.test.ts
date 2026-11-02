import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { pingServe, sendReview } from './core/page.ts';

const fakeOpeners = (openers: ReadonlyArray<string>) => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-opener-'));
  const opened = join(bin, 'opened');
  openers.forEach(opener => {
    const file = join(bin, opener);
    writeFileSync(file, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\necho 'the opener on stdout'\n`);
    chmodSync(file, 0o755);
  });
  return {
    path: bin,
    opened: () => readFileSync(opened, 'utf8'),
    forget: () => rmSync(opened, { force: true }),
    [Symbol.dispose]: () => rmSync(bin, { recursive: true, force: true }),
  };
};

type WrittenPageOptions = {
  readonly directory?: string;
  readonly range?: string;
};

const writtenPage = ({
  directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-')),
  range = 'main..feature',
}: WrittenPageOptions) => {
  const page = join(directory, `${range}.html`);
  const { version } = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );
  writeFileSync(
    page,
    readFileSync(join(import.meta.dirname, '..', 'dist', 'viewer.html'), 'utf8').replace(
      '<script type="application/json" id="review-data">{}</script>',
      () =>
        `<script type="application/json" id="review-data">${JSON.stringify({ version, range })}</script>`,
    ),
  );
  return {
    page,
    [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }),
  };
};

const stderrOf = (child: ChildProcess) => {
  const url = Promise.withResolvers<string>();
  const read = async (): Promise<string> => {
    const lines: Array<string> = [];
    for await (const line of child.stderr ? createInterface(child.stderr) : []) {
      lines.push(line);
      const found = /http:\/\/\S+/.exec(line)?.[0];
      if (found) url.resolve(found);
    }
    url.reject(new Error('serve ended without printing its URL'));
    return lines.join('\n');
  };
  return { url: url.promise, written: read() };
};

type ServedPageOptions = {
  readonly openers?: ReadonlyArray<string>;
  readonly idleMs?: number;
  readonly lock?: string;
} & WrittenPageOptions;

const servedPage = async ({
  openers = ['xdg-open', 'open'],
  idleMs,
  lock,
  ...page
}: ServedPageOptions = {}) => {
  const bin = fakeOpeners(openers);
  const written = writtenPage(page);
  if (lock !== undefined) writeFileSync(written.page.replace(/\.html$/, '.serve'), lock);
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), 'serve', written.page],
    {
      env: {
        ...process.env,
        PATH: bin.path,
        ...(idleMs === undefined ? {} : { VISUAL_REVIEW_IDLE_MS: String(idleMs) }),
      },
    },
  );
  const stderr = stderrOf(child);
  const exited = Promise.all([once(child, 'close'), text(child.stdout), stderr.written]).then(
    ([[code], stdout, errors]) => ({ code, stdout, stderr: errors }),
  );
  return {
    url: await stderr.url,
    page: written.page,
    opened: bin.opened,
    forgetOpened: bin.forget,
    serveAgain: () =>
      promisify(execFile)(
        process.execPath,
        [join(import.meta.dirname, 'cli.ts'), 'serve', written.page],
        {
          env: { ...process.env, PATH: bin.path },
          timeout: 3000,
        },
      ),
    exited,
    [Symbol.dispose]: () => {
      child.kill();
      written[Symbol.dispose]();
      bin[Symbol.dispose]();
    },
  };
};

test('serve opens the page at a URL holding a fresh token, and the page it serves carries that token', async () => {
  using server = await servedPage();

  await vi.waitFor(() => expect(server.opened()).toBe(server.url));
  const token = new URL(server.url).pathname.slice(1);
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/html/);
  expect(await response.text()).toContain(`id="review-serve">"${token}"</script>`);
});

type Asked = {
  readonly url: string;
  readonly method?: string;
  readonly path?: string;
  readonly host?: string;
};

const statusFor = ({ url, method, path, host }: Asked): Promise<number> => {
  const served = new URL(url);
  return new Promise((resolve, reject) => {
    request(
      {
        method: method ?? 'GET',
        hostname: served.hostname,
        port: served.port,
        path: path ?? served.pathname,
        headers: { host: host ?? served.host },
      },
      response => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    )
      .on('error', reject)
      .end();
  });
};

test.for([
  { request: 'for the root', path: '/' },
  { request: 'for a path under the token the page has no use for', path: '/:token/other' },
  { request: 'naming another host, as a DNS-rebinding site would', host: 'evil.example' },
  {
    request: 'sending a review while naming another host',
    method: 'POST',
    path: '/:token/review',
    host: 'evil.example',
  },
])(
  'serve refuses a request $request with 403, and keeps serving the page',
  async ({ method, path, host }) => {
    using server = await servedPage();
    const { port, pathname } = new URL(server.url);

    const status = await statusFor({
      url: server.url,
      ...(method === undefined ? {} : { method }),
      ...(path === undefined ? {} : { path: path.replace('/:token', pathname) }),
      ...(host === undefined ? {} : { host: `${host}:${port}` }),
    });

    expect(status).toBe(403);
    expect(await statusFor({ url: server.url })).toBe(200);
  },
);

test('serve answers on 127.0.0.1 only, not on the IPv6 loopback', async () => {
  using server = await servedPage();
  const { port, pathname } = new URL(server.url);

  await expect(fetch(`http://[::1]:${port}${pathname}`)).rejects.toThrow();
});

test('the served page keeps its token URL out of caches and out of the referrer of links it opens', async () => {
  using server = await servedPage();

  const { headers } = await fetch(server.url);

  expect(headers.get('cache-control')).toBe('no-store');
  expect(headers.get('referrer-policy')).toBe('no-referrer');
});

test('serve with no opener on PATH still serves the page at the URL it prints', async () => {
  using server = await servedPage({ openers: [] });

  expect((await fetch(server.url)).status).toBe(200);
});

test('serve without a page exits non-zero saying how to call it', async () => {
  const run = promisify(execFile)(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'serve']);

  await expect(run).rejects.toMatchObject({
    code: 1,
    stderr: 'Usage: visual-review serve <page.html>\n',
  });
});

test('a review sent from the served page is written beside it as <name>.review.json, its path the only output, and serve exits 0 leaving no lock', async () => {
  using server = await servedPage();
  const { origin, pathname } = new URL(server.url);
  const review = {
    version: 1,
    verdict: 'comment',
    comments: {
      'web/file/App.tsx': { text: 'Why does App fetch this itself?' },
      'web/file/App.tsx -> web/module/modules/AppInfo': { text: 'Keep this edge.' },
    },
  } as const;

  await sendReview({ origin, token: pathname.slice(1), review });

  const reviewFile = server.page.replace(/\.html$/, '.review.json');
  expect(await server.exited).toMatchObject({ code: 0, stdout: `${reviewFile}\n` });
  expect(JSON.parse(readFileSync(reviewFile, 'utf8'))).toEqual(review);
  expect(existsSync(server.page.replace(/\.html$/, '.serve'))).toBe(false);
});

test('a review the page could not have sent is refused with 400 naming the problem, and serve keeps serving', async () => {
  using server = await servedPage();
  const { origin, pathname } = new URL(server.url);

  const response = await fetch(`${origin}${pathname}/review`, {
    method: 'POST',
    body: JSON.stringify({ version: 2, comments: {} }),
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe(
    'Invalid review: version 2 is unknown; this visual-review reads version 1',
  );
  expect(await statusFor({ url: server.url })).toBe(200);
});

test('a review serve cannot write is answered 500 naming why, and serve keeps serving so it can be sent again', async () => {
  using server = await servedPage();
  mkdirSync(server.page.replace(/\.html$/, '.review.json'));
  const { origin, pathname } = new URL(server.url);

  const response = await fetch(`${origin}${pathname}/review`, {
    method: 'POST',
    body: JSON.stringify({ version: 1, verdict: 'comment', comments: {} }),
  });

  expect(response.status).toBe(500);
  expect(await response.text()).toMatch(/^EISDIR/);
  expect(await statusFor({ url: server.url })).toBe(200);
});

test('sending a review the served page would refuse rejects with its answer, so the page can say it was not sent', async () => {
  using server = await servedPage();
  const { origin } = new URL(server.url);

  await expect(
    sendReview({
      origin,
      token: 'not-the-token',
      review: { version: 1, verdict: 'comment', comments: {} },
    }),
  ).rejects.toThrow('The review was not sent: 403 Forbidden');
});

test('serve that hears nothing from the page for its idle time exits non-zero saying no review was sent, leaving no lock', async () => {
  using server = await servedPage({ idleMs: 200 });

  expect(await server.exited).toMatchObject({
    code: 1,
    stdout: '',
    stderr: expect.stringContaining('No review sent'),
  });
  expect(existsSync(server.page.replace(/\.html$/, '.serve'))).toBe(false);
});

test('serve the page keeps pinging stays up past its idle time, and exits once the pings stop', async () => {
  using server = await servedPage({ idleMs: 1000 });
  const { origin, pathname } = new URL(server.url);

  for (const _ping of [1, 2, 3, 4]) {
    await delay(300);
    await pingServe({ origin, token: pathname.slice(1) });
  }

  expect(await statusFor({ url: server.url })).toBe(200);
  expect(await server.exited).toMatchObject({ code: 1 });
});

test('serving a page that is already served opens the live server instead of starting another, and exits 0', async () => {
  using server = await servedPage();
  await vi.waitFor(() => expect(server.opened()).toBe(server.url));
  server.forgetOpened();

  const again = await server.serveAgain();

  expect(again.stdout).toBe('');
  await vi.waitFor(() => expect(server.opened()).toBe(server.url));
});

const endedPid = async (): Promise<number> => {
  const ended = spawn(process.execPath, ['-e', '']);
  await once(ended, 'close');
  return ended.pid ?? 0;
};

test.for([
  {
    lock: 'left by a serve that has ended',
    written: async () => JSON.stringify({ pid: await endedPid(), port: 9, token: 'ended' }),
  },
  { lock: 'serve could not have written', written: async () => '{"pid": 1, "port"' },
])('a lock $lock is replaced by a new server', async ({ written }) => {
  using server = await servedPage({ lock: await written() });

  expect((await fetch(server.url)).status).toBe(200);
});

test('the lock holding the token is readable by its owner only, even when it replaces one anyone could read', async () => {
  using server = await servedPage({
    lock: JSON.stringify({ pid: await endedPid(), port: 9, token: 'ended' }),
  });
  const lockFile = server.page.replace(/\.html$/, '.serve');

  expect(statSync(lockFile).mode & 0o777).toBe(0o600);
});

test('another page in the same folder is served by a server of its own, and each writes its own review', async () => {
  using first = await servedPage();
  using second = await servedPage({ directory: dirname(first.page), range: 'main..other' });

  await Promise.all(
    [
      { server: first, text: 'on the first page' },
      { server: second, text: 'on the second page' },
    ].map(({ server, text }) => {
      const { origin, pathname } = new URL(server.url);
      return sendReview({
        origin,
        token: pathname.slice(1),
        review: { version: 1, verdict: 'comment', comments: { 'web/file/App.tsx': { text } } },
      });
    }),
  );

  const reviewed = async (server: typeof first) =>
    JSON.parse(readFileSync((await server.exited).stdout.trim(), 'utf8')).comments[
      'web/file/App.tsx'
    ].text;
  expect(await reviewed(first)).toBe('on the first page');
  expect(await reviewed(second)).toBe('on the second page');
});
