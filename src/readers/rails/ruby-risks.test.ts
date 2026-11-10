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

test.for([
  { call: 'User.where("active")', detail: 'literal, no interpolation' },
  { call: 'User.where("name = ?", name)', detail: 'literal, no interpolation' },
  { call: 'User.order("name desc")', detail: 'literal, no interpolation' },
  { call: 'User.group("kind")', detail: 'literal, no interpolation' },
  { call: 'User.having("count(*) > 1")', detail: 'literal, no interpolation' },
  { call: 'User.joins("JOIN a ON a.id = b.id")', detail: 'literal, no interpolation' },
  { call: 'User.pluck("lower(name)")', detail: 'literal, no interpolation' },
  { call: 'User.select("name")', detail: 'literal, no interpolation' },
  { call: 'User.where("name = #{name}")', detail: 'interpolated' },
  { call: 'User.where("name = " + name)', detail: 'interpolated' },
  { call: 'User.where(column + " = 1")', detail: 'interpolated' },
  { call: 'connection.execute("DELETE FROM users")', detail: 'literal, no interpolation' },
])('$call reads as raw SQL given a string, $detail', ({ call, detail }) => {
  expect(risksIn(call)).toEqual([{ kind: 'raw-sql', text: call, detail }]);
});

test.for(['User.where(active: true)', 'User.order(:name)', 'User.select { |u| u.active }'])(
  '%s is no raw SQL, given no string',
  call => {
    expect(risksIn(call)).toEqual([]);
  },
);

test.for(['name.html_safe', 'raw(name)', 'raw name', 'buffer.safe_concat(name)'])(
  '%s reads as HTML marked safe',
  call => {
    expect(risksIn(call)).toEqual([{ kind: 'html-safe', text: call }]);
  },
);

test('raw on a receiver is no HTML marked safe', () => {
  expect(risksIn('response.raw(name)')).toEqual([]);
});

test.for([
  'record.send(name)',
  'record.public_send(name, 1)',
  'send(name)',
  'record.send("save_#{kind}")',
  'record.send(:"save_#{kind}")',
  'params[:type].constantize',
  'params[:type].safe_constantize',
  '"#{kind}Policy".constantize',
])('%s reads as a dynamic send', call => {
  expect(risksIn(call)).toEqual([{ kind: 'dynamic-send', text: call }]);
});

test.for([
  'record.send(:save)',
  'record.send("save")',
  'record.send(:"save!")',
  '"User".constantize',
])('%s, sending a literal, is no dynamic send', call => {
  expect(risksIn(call)).toEqual([]);
});

test('a scope reads the risky calls of its body', () => {
  expect(
    railsReader
      .symbols?.(
        ['class User', '  scope :named, ->(name) { where("name = #{name}") }', 'end'].join('\n'),
        'app/models/user.rb',
      )
      ?.symbols.find(({ name }) => name === 'self.named')?.risks,
  ).toEqual([{ kind: 'raw-sql', text: 'where("name = #{name}")', detail: 'interpolated' }]);
});
