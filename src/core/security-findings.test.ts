import { expect, test } from 'vitest';
import type { SymbolFile } from './read-range.ts';
import type { Risk } from './reader.ts';
import { riskFindings, viewRiskFindings } from './security-findings.ts';
import type { SymbolStatement } from './symbol-changes.ts';

const NODE = 'shop/class/UsersController';

const create = (risks: ReadonlyArray<Risk>): SymbolStatement => ({
  name: 'create',
  scope: 'UsersController',
  kind: 'method',
  lines: { base: { start: 2, end: 4 }, head: { start: 2, end: 5 } },
  exported: { base: true, head: true },
  change: 'edited',
  risks,
});

const file = (...symbols: ReadonlyArray<SymbolStatement>): SymbolFile => ({
  stack: 'shop',
  node: NODE,
  symbols,
  exports: { added: [], removed: [] },
  kind: 'logic',
});

test('a key a method gains to permit needs a look, on its file, found by name', () => {
  expect(riskFindings([file(create([{ kind: 'permit', text: 'admin' }]))])).toStrictEqual([
    {
      id: `security:permit:${NODE}#UsersController.create`,
      check: 'security:permit',
      dimension: 'security',
      level: 'look',
      target: NODE,
      title: 'method UsersController.create permits admin',
      detail: 'found by name',
    },
  ]);
});

test.for([
  {
    risk: { kind: 'permit!', text: 'params.permit!' },
    title: 'method UsersController.create permits every parameter',
    detail: 'params.permit! (found by name)',
  },
  {
    risk: { kind: 'raw-sql', text: 'User.where("a = #{a}")', detail: 'interpolated' },
    title: 'method UsersController.create runs raw SQL',
    detail: 'User.where("a = #{a}") (found by name, interpolated)',
  },
  {
    risk: { kind: 'html-safe', text: 'name.html_safe' },
    title: 'method UsersController.create marks HTML safe',
    detail: 'name.html_safe (found by name)',
  },
  {
    risk: { kind: 'dynamic-send', text: 'user.send(field)' },
    title: 'method UsersController.create sends a name it does not write',
    detail: 'user.send(field) (found by name)',
  },
] as const)(
  'a gained $risk.kind call needs a look under its own check',
  ({ risk, title, detail }) => {
    expect(riskFindings([file(create([risk]))])).toStrictEqual([
      {
        id: `security:${risk.kind}:${NODE}#UsersController.create`,
        check: `security:${risk.kind}`,
        dimension: 'security',
        level: 'look',
        target: NODE,
        title,
        detail,
      },
    ]);
  },
);

test('a second gain of one kind in one method is counted in its id, as a repeated symbol is', () => {
  expect(
    riskFindings([
      file(
        create([
          { kind: 'permit', text: 'admin' },
          { kind: 'raw-sql', text: 'User.where("a")' },
          { kind: 'permit', text: 'role' },
        ]),
      ),
    ]).map(({ id }) => id),
  ).toEqual([
    `security:permit:${NODE}#UsersController.create`,
    `security:raw-sql:${NODE}#UsersController.create`,
    `security:permit:${NODE}#UsersController.create#2`,
  ]);
});

const VIEW = 'app/views/users/show.html.erb';

const viewPatch = (...added: ReadonlyArray<string>) => ({
  path: VIEW,
  patch: [
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' <h1>User</h1>',
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

test('a line a view gains marking HTML safe needs a look on its row, by heuristic', () => {
  expect(viewRiskFindings([viewPatch('  <%= user.bio.html_safe %>')])).toStrictEqual([
    {
      id: `security:html-safe:${VIEW}`,
      check: 'security:html-safe',
      dimension: 'security',
      level: 'look',
      file: VIEW,
      line: `${VIEW}@head:2`,
      title: `${VIEW} marks HTML safe`,
      detail: '<%= user.bio.html_safe %> (heuristic, view not parsed)',
    },
  ]);
});

test.for([
  { code: '<%= raw(user.bio) %>', name: 'raw(' },
  { code: '<%== user.bio %>', name: '<%==' },
])('a line a view gains with $name marks HTML safe too', ({ code }) => {
  expect(viewRiskFindings([viewPatch(code)]).map(({ detail }) => detail)).toEqual([
    `${code} (heuristic, view not parsed)`,
  ]);
});

test('a call whose name only ends in raw marks nothing safe', () => {
  expect(viewRiskFindings([viewPatch('<%= withdraw(amount) %>')])).toEqual([]);
});

test.for(['show.html.haml', 'show.slim'])('a %s view is scanned too', name => {
  const path = `app/views/users/${name}`;
  expect(
    viewRiskFindings([{ ...viewPatch('= raw(user.bio)'), path }]).map(({ file }) => file),
  ).toEqual([path]);
});

test('a file that is no view is not scanned: its symbols are read', () => {
  expect(
    viewRiskFindings([{ ...viewPatch('name.html_safe'), path: 'app/helpers/users_helper.rb' }]),
  ).toEqual([]);
});
