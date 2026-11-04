import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const git = (repo: string, ...args: ReadonlyArray<string>): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

export const crateFiles = (name: string) => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`,
  [`crates/${name}/src/lib.rs`]: '',
});

export const axumCrate = (name: string, lib = '') => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\naxum = "0.8"\n`,
  [`crates/${name}/src/lib.rs`]: lib,
});

export const writeFiles = (repo: string, files: Readonly<Record<string, string>>): void =>
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  });

type CommitOptions = {
  readonly date?: string;
  readonly authorDate?: string;
};

export const commit = (
  repo: string,
  files: Readonly<Record<string, string>>,
  { date, authorDate = date }: CommitOptions = {},
): string => {
  writeFiles(repo, files);
  git(repo, 'add', '--all');
  execFileSync(
    'git',
    ['-C', repo, 'commit', '--quiet', '--message', Object.keys(files).join(' ')],
    {
      env: {
        ...process.env,
        ...(date === undefined ? {} : { GIT_COMMITTER_DATE: date }),
        ...(authorDate === undefined ? {} : { GIT_AUTHOR_DATE: authorDate }),
      },
    },
  );
  return git(repo, 'rev-parse', 'HEAD');
};

export const gitRepo = (files: Readonly<Record<string, string>>) => {
  const repo = mkdtempSync(join(tmpdir(), 'visual-review-test-'));
  git(repo, 'init', '--quiet', '--initial-branch', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  const root = commit(repo, files);
  return { repo, root, [Symbol.dispose]: () => rmSync(repo, { recursive: true, force: true }) };
};

export const cargoWorkspace = () =>
  gitRepo({
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
    ...crateFiles('core'),
  });

export const symlinkedDirectory = () => {
  const target = mkdtempSync(join(tmpdir(), 'visual-review-target-'));
  const path = `${target}-link`;
  symlinkSync(target, path);
  return {
    path,
    [Symbol.dispose]: () => {
      rmSync(path, { force: true });
      rmSync(target, { recursive: true, force: true });
    },
  };
};

export const pathTo = (...commands: ReadonlyArray<string>) => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-bin-'));
  commands.forEach(command => {
    symlinkSync(
      execFileSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim(),
      join(bin, command),
    );
  });
  return { path: bin, [Symbol.dispose]: () => rmSync(bin, { recursive: true, force: true }) };
};

export const layOutBareRepository = ({
  directory,
  monitorTouches,
}: {
  readonly directory: string;
  readonly monitorTouches: string;
}): void => {
  const monitor = join(directory, 'monitor.sh');
  mkdirSync(join(directory, 'objects'), { recursive: true });
  mkdirSync(join(directory, 'refs'));
  writeFileSync(join(directory, 'objects', '.keep'), '');
  writeFileSync(join(directory, 'refs', '.keep'), '');
  writeFileSync(join(directory, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(monitor, `#!/bin/sh\ntouch ${monitorTouches}\n`, { mode: 0o755 });
  writeFileSync(
    join(directory, 'config'),
    `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = ${monitor}\n`,
  );
};
