import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';

const fakeOpeners = (openers: ReadonlyArray<string>) => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-opener-'));
  const opened = join(bin, 'opened');
  openers.forEach(opener => {
    const file = join(bin, opener);
    writeFileSync(file, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
    chmodSync(file, 0o755);
  });
  return {
    path: bin,
    opened: () => readFileSync(opened, 'utf8'),
    [Symbol.dispose]: () => rmSync(bin, { recursive: true, force: true }),
  };
};

const writtenPage = () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
  const page = join(directory, 'main..feature.html');
  writeFileSync(page, readFileSync(join(import.meta.dirname, '..', 'dist', 'viewer.html')));
  return {
    page,
    [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }),
  };
};

const urlOn = async (child: ChildProcess): Promise<string> => {
  const lines = child.stderr ? createInterface(child.stderr) : [];
  for await (const line of lines) {
    const url = /http:\/\/\S+/.exec(line)?.[0];
    if (url) return url;
  }
  throw new Error('serve ended without printing its URL');
};

const servedPage = async ({ openers = ['xdg-open', 'open'] } = {}) => {
  const bin = fakeOpeners(openers);
  const written = writtenPage();
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), 'serve', written.page],
    {
      env: { ...process.env, PATH: bin.path },
    },
  );
  return {
    url: await urlOn(child),
    opened: bin.opened,
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

type Asked = { readonly url: string; readonly path?: string; readonly host?: string };

const statusFor = ({ url, path, host }: Asked): Promise<number> => {
  const served = new URL(url);
  return new Promise((resolve, reject) => {
    request(
      {
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
])(
  'serve refuses a request $request with 403, and keeps serving the page',
  async ({ path, host }) => {
    using server = await servedPage();
    const { port, pathname } = new URL(server.url);

    const status = await statusFor({
      url: server.url,
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
