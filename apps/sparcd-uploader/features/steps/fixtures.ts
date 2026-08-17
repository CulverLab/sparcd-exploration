import { expect } from '@playwright/test';
import { test as base, createBdd } from 'playwright-bdd';
import { S3Mock } from './s3mock';
import { seedDefaultStorage } from './fixtures-data';
import { App } from './app';

export const test = base.extend<{ s3: S3Mock; app: App }>({
  s3: async ({}, use) => {
    const s3 = new S3Mock();
    seedDefaultStorage(s3);
    await use(s3);
  },
  app: async ({ page, s3 }, use) => {
    await use(new App(page, s3));
  },
});

export const { Given, When, Then, Step, Before, After } = createBdd(test);
export { expect };
