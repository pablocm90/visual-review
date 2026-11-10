import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { FilePatch } from '../core/diff-graphs.ts';
import {
  type Hunk,
  holdsSide,
  type LineSide,
  type PatchRow,
  type PatchRowKind,
  patchHunks,
} from '../core/patch-lines.ts';

const LANGUAGE_BY_NAME: Readonly<Record<string, string>> = {
  'Cargo.lock': 'ini',
  '.editorconfig': 'ini',
  'config.ru': 'ruby',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  rs: 'rust',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  ts: 'typescript',
  tsx: 'typescript',
  cjs: 'javascript',
  mjs: 'javascript',
  js: 'javascript',
  json: 'json',
  toml: 'ini',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  css: 'css',
};

export const languageOf = (path: string): string | undefined => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return LANGUAGE_BY_NAME[name] ?? LANGUAGE_BY_EXTENSION[extension];
};

export type Piece = { readonly text: string; readonly scopes: ReadonlyArray<string> };

export type PatchLine = Omit<PatchRow, 'code'> & { readonly pieces: ReadonlyArray<Piece> };

type Lines = ReadonlyArray<ReadonlyArray<Piece>>;

const highlighter = hljs.newInstance();
Object.entries({ css, ini, javascript, json, markdown, ruby, rust, typescript, xml, yaml }).forEach(
  ([name, language]) => {
    highlighter.registerLanguage(name, language);
  },
);

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
};

const decode = (html: string) =>
  html.replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ENTITIES[entity] ?? entity);

type Reading = {
  readonly lines: Lines;
  readonly line: ReadonlyArray<Piece>;
  readonly scopes: ReadonlyArray<string>;
};

const withText = (reading: Reading, text: string): Reading =>
  text.split('\n').reduce<Reading>(({ lines, line, scopes }, segment, index) => {
    const ended = index === 0 ? { lines, line } : { lines: lines.concat([line]), line: [] };
    return {
      lines: ended.lines,
      line: segment === '' ? ended.line : ended.line.concat({ text: segment, scopes }),
      scopes,
    };
  }, reading);

const linesOf = (html: string): Lines => {
  const { lines, line } = [
    ...html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g),
  ].reduce<Reading>(
    ({ lines, line, scopes }, [whole, open]) => {
      if (open !== undefined) return { lines, line, scopes: scopes.concat(open) };
      if (whole === '</span>') return { lines, line, scopes: scopes.slice(0, -1) };
      return withText({ lines, line, scopes }, decode(whole));
    },
    { lines: [], line: [], scopes: [] },
  );
  return lines.concat([line]);
};

const highlight = (code: string, language: string | undefined): Lines =>
  language === undefined
    ? []
    : linesOf(highlighter.highlight(code, { language, ignoreIllegals: true }).value);

const SHOWN_FROM: Readonly<Partial<Record<PatchRowKind, LineSide>>> = {
  removed: 'base',
  context: 'head',
  added: 'head',
};

const sideOf = (rows: ReadonlyArray<PatchRow>, side: LineSide, language: string | undefined) =>
  highlight(
    rows
      .filter(row => holdsSide(row.kind, side))
      .map(row => row.code)
      .join('\n'),
    language,
  );

const hunkLines = ({ start, rows }: Hunk, language: string | undefined) => {
  const sides = { base: sideOf(rows, 'base', language), head: sideOf(rows, 'head', language) };
  return rows.map(({ code, ...row }): PatchLine => {
    const side = SHOWN_FROM[row.kind];
    const number = side && row[side];
    const highlighted = side && number !== undefined && sides[side][number - start[side]];
    return { ...row, pieces: highlighted || [{ text: code, scopes: [] }] };
  });
};

export const highlightPatch = ({ path, patch }: FilePatch): ReadonlyArray<PatchLine> => {
  const language = languageOf(path);
  const hunks = patchHunks(patch);
  if (hunks.length === 0)
    return patch
      .split('\n')
      .slice(-1)
      .map((text): PatchLine => ({ kind: 'note', prefix: '', pieces: [{ text, scopes: [] }] }));
  return hunks.flatMap(hunk => hunkLines(hunk, language));
};
