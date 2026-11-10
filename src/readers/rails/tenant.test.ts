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

test('a config file that never calls Apartment.configure gives no config', () => {
  expect(
    read({
      'config/initializers/sidekiq.rb': 'Sidekiq.configure_server do |config|\nend\n',
      'config/initializers/devise.rb':
        'Devise.setup do |config|\n  config.excluded_models = %w[User]\nend\n',
    }),
  ).toStrictEqual({ configs: [] });
});

const APARTMENT = initializer('  config.excluded_models = %w[Company]');

test.for([
  {
    reason: 'an initializer reopening ActiveJob::Base',
    file: 'config/initializers/active_job.rb',
    text: 'ActiveJob::Base.class_eval do\n  include Apartment::ActiveJob\nend\n',
  },
  {
    reason: 'the app’s ApplicationJob',
    file: 'app/jobs/application_job.rb',
    text: 'class ApplicationJob < ActiveJob::Base\n  include ::Apartment::ActiveJob\nend\n',
  },
])('jobs carry the tenant when $reason includes Apartment::ActiveJob', ({ file, text }) => {
  expect(
    read({ 'config/initializers/apartment.rb': APARTMENT, [file]: text }).configs[0]
      ?.jobsCarryTenant,
  ).toBe(true);
});

test('Apartment::ActiveJob extended, not included, carries no tenant', () => {
  expect(
    read({
      'config/initializers/apartment.rb': APARTMENT,
      'config/initializers/active_job.rb': 'ActiveJob::Base.extend Apartment::ActiveJob\n',
    }).configs[0]?.jobsCarryTenant,
  ).toBe(false);
});

test('another app’s Apartment::ActiveJob carries no tenant here', () => {
  expect(
    read({
      'config/initializers/apartment.rb': APARTMENT,
      'apps/admin/config/initializers/active_job.rb':
        'ActiveJob::Base.include Apartment::ActiveJob\n',
    }).configs[0]?.jobsCarryTenant,
  ).toBe(false);
});

test.for([
  { path: 'config/initializers/apartment.rb', held: true },
  { path: 'apps/shop/config/application.rb', held: true },
  { path: 'app/jobs/application_job.rb', held: true },
  { path: 'apps/shop/app/jobs/application_job.rb', held: true },
  { path: 'app/jobs/sync_job.rb', held: false },
  { path: 'lib/myconfig/apartment.rb', held: false },
  { path: 'config/locales/en.yml', held: false },
  { path: 'vendor/gems/x/config/initializers/apartment.rb', held: false },
  { path: 'spec/dummy/config/initializers/apartment.rb', held: false },
])('$path is held: $held', ({ path, held }) => {
  expect(railsTenant.holds(path)).toBe(held);
});

const excludedAs = (list: string) =>
  read({ 'config/initializers/apartment.rb': initializer(`  config.excluded_models = ${list}`) })
    .configs[0];

test.for([
  { list: '["Company", "Admin::User"]', excluded: ['Company', 'Admin::User'] },
  { list: '[Company, ::Admin::User]', excluded: ['Company', 'Admin::User'] },
  { list: "['Company', 'Admin::User']", excluded: ['Company', 'Admin::User'] },
])('$list is read as its constants', ({ list, excluded }) => {
  expect(excludedAs(list)).toMatchObject({ excluded });
  expect(excludedAs(list)).not.toHaveProperty('unread');
});

test.for([
  { list: 'EXCLUDED', excluded: [], unread: ['EXCLUDED'] },
  { list: '%w[Company].freeze', excluded: [], unread: ['%w[Company].freeze'] },
  { list: '[*SHARED, "Company"]', excluded: ['Company'], unread: ['*SHARED'] },
  { list: '["#{prefix}Company", User]', excluded: ['User'], unread: ['"#{prefix}Company"'] },
  { list: '%W[#{prefix}Company User]', excluded: ['User'], unread: ['#{prefix}Company'] },
  { list: '[shared::Company, User]', excluded: ['User'], unread: ['shared::Company'] },
])('$list is read as far as it is written out', ({ list, excluded, unread }) => {
  expect(excludedAs(list)).toMatchObject({
    excluded,
    unread: unread.map(text => ({ text, file: 'config/initializers/apartment.rb', line: 2 })),
  });
});

test('the last excluded_models written is the one Apartment keeps, whatever is set after it', () => {
  expect(
    read({
      'config/initializers/apartment.rb': initializer(
        '  config.excluded_models = %w[Company]\n  config.excluded_models = %w[User]\n  config.tenant_names = %w[a b]',
      ),
    }).configs[0]?.excluded,
  ).toStrictEqual(['User']);
});

test('::Apartment.configure is read as Apartment.configure', () => {
  expect(
    read({
      'config/initializers/apartment.rb': `::${initializer('  config.excluded_models = %w[Company]')}`,
    }).configs[0]?.excluded,
  ).toStrictEqual(['Company']);
});

test('Apartment called for anything but configure gives no config', () => {
  expect(read({ 'config/initializers/tenants.rb': 'Apartment.reset\n' })).toStrictEqual({
    configs: [],
  });
});

test('a config file never naming Apartment is not read, so one broken is no blind spot', () => {
  expect(read({ 'config/initializers/sidekiq.rb': 'Sidekiq.configure_server do\n' })).toStrictEqual(
    { configs: [] },
  );
});

test('an app whose first config folder holds another config folder is the app above the first', () => {
  expect(read({ 'apps/shop/config/tenancy/config/apartment.rb': APARTMENT }).configs[0]?.root).toBe(
    'apps/shop/',
  );
});

test.for([
  {
    reason: 'a syntax error',
    text: 'Apartment.configure do |config|\n  config.excluded_models = %w[Company\n',
    said: 'Ruby syntax error in config/initializers/apartment.rb',
  },
  {
    reason: 'a line too long',
    text: `Apartment.configure do |config|\n  config.excluded_models = %w[${'Company '.repeat(200)}]\nend\n`,
    said: 'config/initializers/apartment.rb too big to read: over 262,144 characters or a line over 1,000',
  },
])('an Apartment config with $reason is not read, the others still are', ({ text, said }) => {
  expect(
    read({
      'config/initializers/apartment.rb': text,
      'apps/admin/config/initializers/apartment.rb': APARTMENT,
    }),
  ).toStrictEqual({
    configs: [expect.objectContaining({ root: 'apps/admin/', excluded: ['Company'] })],
    notRead: [{ root: '', file: 'config/initializers/apartment.rb', reason: said }],
  });
});
