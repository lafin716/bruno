import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integrations',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'on'
  }
});
