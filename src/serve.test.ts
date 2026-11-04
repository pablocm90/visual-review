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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { pingServe, sendReview } from './core/page.ts';
import type { Review } from './core/review.ts';

const removeBesideItsOpener = (bin: string) => {
  const remove = () => rmSync(bin, { recursive: true, force: true });
  try {
    remove();
  } catch {
    remove();
  }
};

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
    openedAny: () => existsSync(opened),
    forget: () => rmSync(opened, { force: true }),
    [Symbol.dispose]: () => removeBesideItsOpener(bin),
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

const aToken = 'a'.repeat(32);

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
  readonly firstPingMs?: number;
  readonly lock?: string;
  readonly flags?: ReadonlyArray<string>;
} & WrittenPageOptions;

const servedPage = async ({
  openers = ['xdg-open', 'open'],
  idleMs,
  firstPingMs,
  lock,
  flags = [],
  ...page
}: ServedPageOptions = {}) => {
  const bin = fakeOpeners(openers);
  const written = writtenPage(page);
  if (lock !== undefined) {
    writeFileSync(written.page.replace(/\.html$/, '.serve'), lock, { mode: 0o600 });
  }
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), 'serve', ...flags, written.page],
    {
      env: {
        ...process.env,
        PATH: bin.path,
        ...(idleMs === undefined ? {} : { VISUAL_REVIEW_IDLE_MS: String(idleMs) }),
        ...(firstPingMs === undefined ? {} : { VISUAL_REVIEW_FIRST_PING_MS: String(firstPingMs) }),
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
    openedAny: bin.openedAny,
    forgetOpened: bin.forget,
    serveAgain: (againFlags: ReadonlyArray<string> = []) =>
      promisify(execFile)(
        process.execPath,
        [join(import.meta.dirname, 'cli.ts'), 'serve', ...againFlags, written.page],
        {
          env: { ...process.env, PATH: bin.path },
          timeout: 3000,
        },
      ),
    exited,
    signal: (signal: NodeJS.Signals) => child.kill(signal),
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
    stderr: 'Usage: visual-review serve [--no-open] <page.html>\n',
  });
});

test("serve loads no reader or linker, so it starts without paying for their parsers' load", async () => {
  const refuseAdapters = `data:text/javascript,${encodeURIComponent(`
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve: (specifier, context, next) => {
        const resolved = next(specifier, context);
        if (/\\/src\\/(readers|linkers)\\//.test(resolved.url)) throw new Error('adapter loaded: ' + resolved.url);
        return resolved;
      },
    });
  `)}`;
  const run = promisify(execFile)(process.execPath, [
    '--import',
    refuseAdapters,
    join(import.meta.dirname, 'cli.ts'),
    'serve',
  ]);

  await expect(run).rejects.toMatchObject({
    code: 1,
    stderr: 'Usage: visual-review serve [--no-open] <page.html>\n',
  });
});

const reviewWith = (comments: Review['comments']): Review => ({
  version: 5,
  verdict: 'comment',
  reviewed: { range: 'abc123..def456' },
  read: [],
  comments,
});

test('a review sent from the served page is written beside it as <name>.review.json, its path the only output, and serve exits 0 leaving no lock', async () => {
  using server = await servedPage();
  const { origin, pathname } = new URL(server.url);
  const review = {
    version: 5,
    verdict: 'comment',
    body: 'The fetch belongs in AppInfo; the rest reads well.',
    reviewed: { range: 'abc123..def456', pullRequest: 16 },
    read: ['web/file/AppInfo.tsx'],
    comments: [
      {
        anchor: { kind: 'part', id: 'web/file/App.tsx' },
        kind: 'question',
        text: 'Why does App fetch this itself?',
      },
    ],
  } as const;

  await pingServe({ origin, token: pathname.slice(1) });
  await sendReview({ origin, token: pathname.slice(1), review });

  const reviewFile = server.page.replace(/\.html$/, '.review.json');
  expect(await server.exited).toMatchObject({ code: 0, stdout: `${reviewFile}\n` });
  expect(JSON.parse(readFileSync(reviewFile, 'utf8'))).toEqual(review);
  expect(existsSync(server.page.replace(/\.html$/, '.serve'))).toBe(false);
});

test('a link standing where the review goes is replaced by the review, what it points at left as it was', async () => {
  using server = await servedPage();
  const { origin, pathname } = new URL(server.url);
  const reviewFile = server.page.replace(/\.html$/, '.review.json');
  const elsewhere = `${server.page}.elsewhere`;
  writeFileSync(elsewhere, 'mine\n');
  symlinkSync(elsewhere, reviewFile);
  const review = reviewWith([]);

  await sendReview({ origin, token: pathname.slice(1), review });

  await server.exited;
  expect(readFileSync(elsewhere, 'utf8')).toBe('mine\n');
  expect(JSON.parse(readFileSync(reviewFile, 'utf8'))).toEqual(review);
});

test('a review the page could not have sent is refused with 400 naming the problem, and serve keeps serving', async () => {
  using server = await servedPage();
  const { origin, pathname } = new URL(server.url);

  const response = await fetch(`${origin}${pathname}/review`, {
    method: 'POST',
    body: JSON.stringify({ version: 4, comments: {} }),
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe(
    'Invalid review: version 4 is unknown; this visual-review reads version 5',
  );
  expect(await statusFor({ url: server.url })).toBe(200);
});

test('a review serve cannot write is answered 500 naming why, and serve keeps serving so it can be sent again', async () => {
  using server = await servedPage();
  mkdirSync(server.page.replace(/\.html$/, '.review.json'));
  const { origin, pathname } = new URL(server.url);

  const response = await fetch(`${origin}${pathname}/review`, {
    method: 'POST',
    body: JSON.stringify(reviewWith([])),
  });

  expect(response.status).toBe(500);
  expect(await response.text()).toMatch(/EISDIR/);
  expect(await statusFor({ url: server.url })).toBe(200);
});

test('sending a review the served page would refuse rejects with its answer, so the page can say it was not sent', async () => {
  using server = await servedPage();
  const { origin } = new URL(server.url);

  await expect(
    sendReview({
      origin,
      token: 'not-the-token',
      review: reviewWith([]),
    }),
  ).rejects.toThrow('The review was not sent: 403 Forbidden');
});

test('serve that cannot write its lock exits non-zero at once, saying why', async () => {
  using bin = fakeOpeners(['xdg-open', 'open']);
  using written = writtenPage({});
  chmodSync(dirname(written.page), 0o555);
  using _writableAgain = { [Symbol.dispose]: () => chmodSync(dirname(written.page), 0o755) };

  const serving = promisify(execFile)(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), 'serve', written.page],
    { env: { ...process.env, PATH: bin.path }, timeout: 3000 },
  );

  await expect(serving).rejects.toMatchObject({
    code: 1,
    killed: false,
    stderr: expect.stringContaining('EACCES'),
  });
});

test.for([
  ...['10m', '', '0', '1.5', '3000000000'].map(value => ({
    variable: 'VISUAL_REVIEW_IDLE_MS',
    value,
  })),
  { variable: 'VISUAL_REVIEW_FIRST_PING_MS', value: '10m' },
])(
  'serve with $variable=$value exits non-zero naming it, serving nothing',
  async ({ variable, value }) => {
    using bin = fakeOpeners(['xdg-open', 'open']);
    using written = writtenPage({});

    const serving = promisify(execFile)(
      process.execPath,
      [join(import.meta.dirname, 'cli.ts'), 'serve', written.page],
      { env: { ...process.env, PATH: bin.path, [variable]: value }, timeout: 3000 },
    );

    await expect(serving).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(
        new RegExp(`^${variable} must be a whole number of milliseconds`),
      ),
    });
  },
);

test('serve whose page never pings exits non-zero at the end of its first-ping wait, saying the page was not open, leaving no lock', async () => {
  using server = await servedPage({ firstPingMs: 200 });

  expect(await server.exited).toMatchObject({
    code: 1,
    stdout: '',
    stderr: expect.stringContaining('No review sent: the page was not open in a tab'),
  });
  expect(existsSync(server.page.replace(/\.html$/, '.serve'))).toBe(false);
});

test('serve waits past its idle time for the page to first ping', async () => {
  using server = await servedPage({ idleMs: 200 });

  await delay(600);

  expect(await statusFor({ url: server.url })).toBe(200);
});

test.for(['SIGINT', 'SIGTERM'] as const)(
  'serve stopped by %s exits non-zero saying no review was sent, leaving no lock',
  async signal => {
    using server = await servedPage();

    server.signal(signal);

    expect(await server.exited).toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('No review sent'),
    });
    expect(existsSync(server.page.replace(/\.html$/, '.serve'))).toBe(false);
  },
);

test('serve the page keeps pinging stays up past its first-ping wait and its idle time', async () => {
  using server = await servedPage({ firstPingMs: 600, idleMs: 1000 });
  const { origin, pathname } = new URL(server.url);

  for (const _ping of [1, 2, 3, 4]) {
    await delay(400);
    await pingServe({ origin, token: pathname.slice(1) });
  }

  expect(await statusFor({ url: server.url })).toBe(200);
});

test('serve whose page has pinged exits non-zero its idle time after the last ping, long before its first-ping wait would end', async () => {
  using server = await servedPage({ idleMs: 200 });
  const { origin, pathname } = new URL(server.url);

  await pingServe({ origin, token: pathname.slice(1) });

  expect(await server.exited).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('No review sent'),
  });
});

test('serving a page that is already served opens the live server instead of starting another, and exits 0', async () => {
  using server = await servedPage();
  await vi.waitFor(() => expect(server.opened()).toBe(server.url));
  server.forgetOpened();

  const again = await server.serveAgain();

  expect(again.stdout).toBe('');
  await vi.waitFor(() => expect(server.opened()).toBe(server.url));
});

test('serve --no-open serves the page at the URL it prints and opens nothing', async () => {
  using server = await servedPage({ flags: ['--no-open'], firstPingMs: 500 });

  expect((await fetch(server.url)).status).toBe(200);
  await server.exited;
  expect(server.openedAny()).toBe(false);
});

test('serving an already served page with --no-open prints the live URL, opens nothing, and exits 0', async () => {
  using server = await servedPage({ flags: ['--no-open'] });

  const again = await server.serveAgain(['--no-open']);

  expect(again).toEqual({ stdout: '', stderr: `Serving ${server.url}\n` });
  await delay(300);
  expect(server.openedAny()).toBe(false);
});

test('serving an already served page leaves the live server waiting for its first ping, past its idle time', async () => {
  using server = await servedPage({ flags: ['--no-open'], idleMs: 200 });

  await server.serveAgain(['--no-open']);
  await delay(600);

  expect(await statusFor({ url: server.url })).toBe(200);
});

test('serving a page rewritten since it was first served opens the live server, which serves the page as it is now', async () => {
  using server = await servedPage();
  writeFileSync(
    server.page,
    readFileSync(server.page, 'utf8').replace(
      '"range":"main..feature"',
      '"range":"main..rewritten"',
    ),
  );

  await server.serveAgain();

  expect(await (await fetch(server.url)).text()).toContain('"range":"main..rewritten"');
});

test('a page removed since it was served is answered 500 naming why', async () => {
  using server = await servedPage();
  rmSync(server.page);

  const response = await fetch(server.url);

  expect(response.status).toBe(500);
  expect(await response.text()).toMatch(/^ENOENT/);
});

const endedPid = async (): Promise<number> => {
  const ended = spawn(process.execPath, ['-e', '']);
  await once(ended, 'close');
  return ended.pid ?? 0;
};

test.for([
  {
    lock: 'left by a serve that has ended',
    written: async () => JSON.stringify({ pid: await endedPid(), port: 9, token: aToken }),
  },
  { lock: 'serve could not have written', written: async () => '{"pid": 1, "port"' },
  {
    lock: 'whose pid another process has taken',
    written: async () => JSON.stringify({ pid: process.pid, port: 9, token: aToken }),
  },
])('a lock $lock is replaced by a new server', async ({ written }) => {
  using server = await servedPage({ lock: await written() });

  expect((await fetch(server.url)).status).toBe(200);
});

test('a lock naming a server that refuses its token is replaced by a new server', async () => {
  using other = await servedPage();
  const { port } = new URL(other.url);

  using server = await servedPage({
    directory: dirname(other.page),
    range: 'main..other',
    lock: JSON.stringify({ pid: process.pid, port: Number(port), token: aToken }),
  });

  expect(new URL(server.url).port).not.toBe(port);
  expect((await fetch(server.url)).status).toBe(200);
});

test('the lock holding the token is readable by its owner only, even when it replaces one anyone could read', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
  const standing = join(directory, 'main..feature.serve');
  writeFileSync(standing, JSON.stringify({ pid: await endedPid(), port: 9, token: aToken }));
  chmodSync(standing, 0o644);

  using server = await servedPage({ directory });
  const lockFile = server.page.replace(/\.html$/, '.serve');

  expect(statSync(lockFile).mode & 0o777).toBe(0o600);
});

const serverAnsweringAll = async () => {
  const requests: Array<string | undefined> = [];
  const server = createServer((incoming, response) => {
    requests.push(incoming.url);
    response.writeHead(204).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { port, requests, [Symbol.dispose]: () => server.close() };
};

const writeOwnerOnly = (file: string, content: string) =>
  writeFileSync(file, content, { mode: 0o600 });

test.for([
  {
    lock: 'that others may read',
    token: aToken,
    lay: (file: string, content: string) => {
      writeFileSync(file, content);
      chmodSync(file, 0o644);
    },
  },
  { lock: 'whose token starts with a path', token: `../${aToken}`, lay: writeOwnerOnly },
  { lock: 'whose token ends with a path', token: `${aToken}/..`, lay: writeOwnerOnly },
  { lock: 'whose token is too short', token: 'abc', lay: writeOwnerOnly },
  {
    lock: 'that is a link',
    token: aToken,
    lay: (file: string, content: string) => {
      writeOwnerOnly(`${file}.target`, content);
      symlinkSync(`${file}.target`, file);
    },
  },
])(
  'a lock $lock is not believed: the server it names gets no request and a new one starts',
  async ({ token, lay }) => {
    using named = await serverAnsweringAll();
    const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
    lay(
      join(directory, 'main..feature.serve'),
      JSON.stringify({ pid: process.pid, port: named.port, token }),
    );

    using server = await servedPage({ directory });

    expect(named.requests).toEqual([]);
    expect((await fetch(server.url)).status).toBe(200);
  },
);

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
        review: reviewWith([
          { anchor: { kind: 'part', id: 'web/file/App.tsx' }, kind: 'question', text },
        ]),
      });
    }),
  );

  const reviewed = async (server: typeof first) =>
    JSON.parse(readFileSync((await server.exited).stdout.trim(), 'utf8')).comments[0].text;
  expect(await reviewed(first)).toBe('on the first page');
  expect(await reviewed(second)).toBe('on the second page');
});
