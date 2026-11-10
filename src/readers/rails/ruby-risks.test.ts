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
