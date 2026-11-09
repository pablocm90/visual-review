import { expect, test } from 'vitest';
import type { Action } from './access.ts';
import { accessFindings } from './access-findings.ts';
import type { AccessReading } from './read-access.ts';

const FILE = 'app/controllers/users_controller.rb';

const NODE = {
  id: 'shop/class/UsersController',
  kind: 'file',
  label: 'UsersController',
  path: FILE,
} as const;

const action = (overrides: Partial<Action> = {}): Action => ({
  controller: 'UsersController',
  action: 'show',
  root: '',
  file: FILE,
  line: 4,
  ...overrides,
});

const reading = (base: ReadonlyArray<Action>, head: ReadonlyArray<Action>): AccessReading => ({
  base: { actions: base, unread: [] },
  head: { actions: head, unread: [] },
});

const OTHER = {
  id: 'shop/class/User',
  kind: 'file',
  label: 'User',
  path: 'app/models/user.rb',
} as const;

const findingsOf = (...access: ReadonlyArray<AccessReading>) =>
  accessFindings({ access, nodes: [OTHER, NODE] });

test('a new action nothing authorizes needs a look, on its controller', () => {
  expect(findingsOf(reading([], [action()]))).toStrictEqual([
    {
      id: 'security:unauthorized::UsersController#show',
      check: 'security:unauthorized',
      dimension: 'security',
      level: 'look',
      target: NODE.id,
      title: 'UsersController#show added with no authorization',
      detail: `At ${FILE}:4. No callback, parent or call of its own authorizes it.`,
    },
  ]);
});

test('a new action with a cover raises nothing', () => {
  expect(
    findingsOf(reading([], [action({ cover: { by: 'authorize', conditional: false } })])),
  ).toStrictEqual([]);
});

test('an action in a file no node draws opens the file', () => {
  expect(
    accessFindings({ access: [reading([], [action()])], nodes: [] }).map(({ target, file }) => ({
      target,
      file,
    })),
  ).toStrictEqual([{ target: undefined, file: FILE }]);
});

test('an action nothing authorized before raises nothing', () => {
  expect(findingsOf(reading([action()], [action()]))).toStrictEqual([]);
});

test('an action the base covered and the head does not needs a look, naming the lost cover', () => {
  expect(
    findingsOf(
      reading([action({ cover: { by: 'authorize_user', conditional: false } })], [action()]),
    ).map(({ id, level, title, detail }) => ({ id, level, title, detail })),
  ).toStrictEqual([
    {
      id: 'security:unauthorized::UsersController#show',
      level: 'look',
      title: 'UsersController#show lost its authorization',
      detail: `At ${FILE}:4. authorize_user covered it before; nothing authorizes it now.`,
    },
  ]);
});
