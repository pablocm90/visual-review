import { expect, test } from 'vitest';
import { railsReader } from './reader.ts';

const risksIn = (...lines: ReadonlyArray<string>) =>
  railsReader
    .symbols?.(['def create', ...lines, 'end'].join('\n'), 'app/controllers/users_controller.rb')
    ?.symbols.find(({ name }) => name === 'create')?.risks;

test('each key a method permits reads as a permit risk', () => {
  expect(risksIn('params.require(:user).permit(:name, :email)')).toEqual([
    { kind: 'permit', text: 'name' },
    { kind: 'permit', text: 'email' },
  ]);
});

test.for([
  { permitted: 'address: [:street, :city]', texts: ['address.street', 'address.city'] },
  { permitted: 'address: [:street, geo: [:lat]]', texts: ['address.street', 'address.geo.lat'] },
  { permitted: ':address => [:street]', texts: ['address.street'] },
  { permitted: '"address" => [:street]', texts: ['address.street'] },
  { permitted: 'tags: []', texts: ['tags'] },
  { permitted: 'meta: {}', texts: ['meta'] },
])('permit($permitted) reads its nested keys by path', ({ permitted, texts }) => {
  expect(risksIn(`params.permit(${permitted})`)).toEqual(
    texts.map(text => ({ kind: 'permit', text })),
  );
});

test('permit! reads as a risk by the call it is', () => {
  expect(risksIn('User.create(params.require(:user).permit!)')).toEqual([
    { kind: 'permit!', text: 'params.require(:user).permit!' },
  ]);
});

test.for([
  'User.find_by_sql(query)',
  'connection.execute(query)',
  'connection.exec_query(query)',
  'connection.select_all(query)',
  'connection.select_value(query)',
  'connection.select_rows(query)',
  'Arel.sql(query)',
])('%s reads as raw SQL whatever it is given', call => {
  expect(risksIn(call)).toEqual([{ kind: 'raw-sql', text: call }]);
});

test('a method named sql on another receiver than Arel is no raw SQL', () => {
  expect(risksIn('report.sql(query)')).toEqual([]);
});
