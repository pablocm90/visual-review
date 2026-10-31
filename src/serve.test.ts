import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { expect, test, vi } from 'vitest';

const fakeOpeners = () => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-opener-'));
  const opened = join(bin, 'opened');
  ['xdg-open', 'open'].forEach(opener => {
    const file = join(bin, opener);
    writeFileSync(file, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
    chmodSync(file, 0o755);
  });
  return {
    path: `${bin}:${process.env['PATH']}`,
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

const serving = async (options: { readonly page: string; readonly path: string }) => {
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), 'serve', options.page],
    {
      env: { ...process.env, PATH: options.path },
    },
  );
  return { url: await urlOn(child), [Symbol.dispose]: () => child.kill() };
};

test('serve opens the page at a URL holding a fresh token, and the page it serves carries that token', async () => {
  using openers = fakeOpeners();
  using written = writtenPage();

  using server = await serving({ page: written.page, path: openers.path });

  await vi.waitFor(() => expect(openers.opened()).toBe(server.url));
  const token = new URL(server.url).pathname.slice(1);
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/html/);
  expect(await response.text()).toContain(`id="review-serve">"${token}"</script>`);
});
