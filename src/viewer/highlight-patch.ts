import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { FilePatch } from '../core/read-range.ts';

const LANGUAGE_BY_NAME: Readonly<Record<string, string>> = {
  'Cargo.lock': 'ini',
  '.editorconfig': 'ini',
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  rs: 'rust',
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

export type PatchLine = {
  readonly kind: 'header' | 'context' | 'added' | 'removed' | 'note';
  readonly prefix: string;
  readonly pieces: ReadonlyArray<Piece>;
};

type Kind = PatchLine['kind'];
type Side = 'old' | 'new';
type Lines = ReadonlyArray<ReadonlyArray<Piece>>;

const highlighter = hljs.newInstance();
Object.entries({ css, ini, javascript, json, markdown, rust, typescript, xml, yaml }).forEach(
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

const KIND_BY_PREFIX: Readonly<Record<string, Kind>> = {
  '@': 'header',
  '\\': 'note',
  '+': 'added',
  '-': 'removed',
};

type Row = { readonly kind: Kind; readonly prefix: string; readonly code: string };

const rowOf = (line: string): Row => {
  const kind = KIND_BY_PREFIX[line.slice(0, 1)] ?? 'context';
  if (kind === 'header' || kind === 'note') return { kind, prefix: '', code: line };
  return { kind, prefix: line.slice(0, 1), code: line.slice(1) };
};

const SIDE_KINDS: Readonly<Record<Side, ReadonlyArray<Kind>>> = {
  old: ['context', 'removed'],
  new: ['context', 'added'],
};

const SHOWN_FROM: Readonly<Partial<Record<Kind, Side>>> = {
  removed: 'old',
  context: 'new',
  added: 'new',
};

const sideOf = (rows: ReadonlyArray<Row>, side: Side, language: string | undefined) =>
  highlight(
    rows
      .filter(row => SIDE_KINDS[side].includes(row.kind))
      .map(row => row.code)
      .join('\n'),
    language,
  );

type Laying = {
  readonly lines: ReadonlyArray<PatchLine>;
  readonly at: Readonly<Record<Side, number>>;
};

const hunkLines = (rows: ReadonlyArray<Row>, language: string | undefined) => {
  const sides = { old: sideOf(rows, 'old', language), new: sideOf(rows, 'new', language) };
  return rows.reduce<Laying>(
    ({ lines, at }, { kind, prefix, code }) => {
      const side = SHOWN_FROM[kind];
      const pieces = (side && sides[side][at[side]]) ?? [{ text: code, scopes: [] }];
      return {
        lines: lines.concat({ kind, prefix, pieces }),
        at: {
          old: at.old + Number(SIDE_KINDS.old.includes(kind)),
          new: at.new + Number(SIDE_KINDS.new.includes(kind)),
        },
      };
    },
    { lines: [], at: { old: 0, new: 0 } },
  ).lines;
};

export const highlightPatch = ({ path, patch }: FilePatch): ReadonlyArray<PatchLine> => {
  const language = languageOf(path);
  const lines = patch.split('\n');
  const rows = lines.map(rowOf);
  const starts = rows.flatMap((row, index) => (row.kind === 'header' ? [index] : []));
  if (starts.length === 0)
    return lines
      .slice(-1)
      .map((text): PatchLine => ({ kind: 'note', prefix: '', pieces: [{ text, scopes: [] }] }));
  return starts.flatMap((start, index) =>
    hunkLines(rows.slice(start, starts[index + 1]), language),
  );
};
