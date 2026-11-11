import { expect, test } from 'vitest';
import type { Risk } from './reader.ts';
import type { SymbolFile } from './reading.ts';
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
      id: `security:permit:${NODE}#UsersController.create#admin`,
      check: 'security:permit',
      dimension: 'security',
      level: 'look',
      target: NODE,
      title: 'method UsersController.create permits admin',
      detail: 'found by name',
    },
  ]);
});

test('a permit it could not name raises no finding, since coverage names it', () => {
  expect(riskFindings([file(create([{ kind: 'permit', text: '*FIELDS', unread: true }]))])).toEqual(
    [],
  );
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
        id: `security:${risk.kind}:${NODE}#UsersController.create#${risk.text}`,
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

test('a call is known by its text, so one gained before it leaves its id as it was; the same call twice is counted', () => {
  expect(
    riskFindings([
      file(
        create([
          { kind: 'permit', text: 'role' },
          { kind: 'permit', text: 'admin' },
          { kind: 'raw-sql', text: 'User.where("a")' },
          { kind: 'permit', text: 'admin' },
        ]),
      ),
    ]).map(({ id }) => id),
  ).toEqual([
    `security:permit:${NODE}#UsersController.create#role`,
    `security:permit:${NODE}#UsersController.create#admin`,
    `security:raw-sql:${NODE}#UsersController.create#User.where("a")`,
    `security:permit:${NODE}#UsersController.create#admin#2`,
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
      id: `security:html-safe:${VIEW}#<%= user.bio.html_safe %>`,
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

test('a view line is known by its text, so one gained above it leaves its id as it was; the same text twice is counted', () => {
  expect(
    viewRiskFindings([viewPatch('<%== b %>', '<p>plain</p>', '<%= raw(a) %>', '<%== b %>')]).map(
      ({ id, line }) => ({ id, line }),
    ),
  ).toEqual([
    { id: `security:html-safe:${VIEW}#<%== b %>`, line: `${VIEW}@head:2` },
    { id: `security:html-safe:${VIEW}#<%= raw(a) %>`, line: `${VIEW}@head:4` },
    { id: `security:html-safe:${VIEW}#<%== b %>#2`, line: `${VIEW}@head:5` },
  ]);
});

test('a view line marked safe that the change removes or keeps raises nothing', () => {
  const patch = ['@@ -1,2 +1,1 @@', ' <%= raw(a) %>', '-<%== b %>'].join('\n');
  expect(viewRiskFindings([{ path: VIEW, patch }])).toEqual([]);
});

test('a view asking html_safe? marks nothing safe', () => {
  expect(viewRiskFindings([viewPatch('<% if bio.html_safe? %>')])).toEqual([]);
});
