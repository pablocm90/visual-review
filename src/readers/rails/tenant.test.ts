import { expect, test } from 'vitest';
import { railsTenant } from './tenant-reader.ts';

const read = (files: Record<string, string>) => railsTenant.configs(new Map(Object.entries(files)));

const initializer = (body: string): string => `Apartment.configure do |config|
${body}
end
`;

test("Apartment's excluded models are read as constants from its initializer", () => {
  expect(
    read({
      'config/initializers/apartment.rb': initializer(
        '  config.excluded_models = %w[Company Admin::User]',
      ),
    }),
  ).toStrictEqual({
    configs: [
      {
        root: '',
        file: 'config/initializers/apartment.rb',
        excluded: ['Company', 'Admin::User'],
        jobsCarryTenant: false,
      },
    ],
  });
});
