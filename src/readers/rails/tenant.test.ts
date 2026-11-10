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
  { path: 'config/locales/en.yml', held: false },
  { path: 'vendor/gems/x/config/initializers/apartment.rb', held: false },
  { path: 'spec/dummy/config/initializers/apartment.rb', held: false },
])('$path is held: $held', ({ path, held }) => {
  expect(railsTenant.holds(path)).toBe(held);
});
