import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { ElectronApplication, Page, expect, test, closeElectronApp, waitForReadyPage } from '../../playwright';
import {
  buildCommonLocators,
  closePreferences,
  openEnvironmentConfigTab,
  openEnvironmentInSettings,
  openPreferences,
  selectPreferencesTab
} from '../utils/page';

const SCREENSHOT_DIR = '/private/tmp/bruno-integration-screenshots';
const SYNTHETIC_PAT = 'glpat-e2e-synthetic';
const COLLECTION_NAME = 'GitLab AWS Integration';
const ENVIRONMENT_NAME = 'Local';

type MockGitLab = {
  baseUrl: string;
  requests: Array<{ method?: string; url?: string; token?: string }>;
  close: () => Promise<void>;
};

const baseUrlForRequest = (req: http.IncomingMessage) => {
  const host = req.headers.host || '127.0.0.1';
  return `http://${host}/gitlab`;
};

const startMockGitLab = async (): Promise<MockGitLab> => {
  const requests: MockGitLab['requests'] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      token: Array.isArray(req.headers['private-token']) ? req.headers['private-token'][0] : req.headers['private-token']
    });

    res.setHeader('content-type', 'application/json');

    if (req.url?.startsWith('/gitlab/api/v4/user')) {
      res.end(JSON.stringify({ username: 'integration-user' }));
      return;
    }

    if (req.url?.startsWith('/gitlab/api/v4/projects')) {
      res.setHeader('x-next-page', '');
      res.end(JSON.stringify([
        {
          id: 101,
          name: 'Payments API',
          path_with_namespace: 'platform/payments-api',
          http_url_to_repo: `${baseUrlForRequest(req)}/platform/payments-api.git`,
          ssh_url_to_repo: 'git@localhost:platform/payments-api.git',
          default_branch: 'main'
        }
      ]));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/gitlab`;

  return {
    baseUrl,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
};

const writeIntegrationCollection = async (root: string) => {
  const collectionPath = path.join(root, 'collection');
  await fs.mkdir(path.join(collectionPath, 'environments'), { recursive: true });
  await fs.writeFile(
    path.join(collectionPath, 'bruno.json'),
    JSON.stringify({ version: '1', name: COLLECTION_NAME, type: 'collection' }, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(collectionPath, 'ping.bru'),
    [
      'meta {',
      '  name: ping',
      '  type: http',
      '  seq: 1',
      '}',
      '',
      'get {',
      '  url: https://example.test/ping',
      '  body: none',
      '  auth: none',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(collectionPath, 'environments', `${ENVIRONMENT_NAME}.bru`),
    [
      'vars {',
      '  host: https://example.test',
      '  preserved_regular: keep-me',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  return collectionPath;
};

const writeInitUserData = async (root: string, collectionPath: string) => {
  const initUserDataPath = path.join(root, 'init-user-data');
  await fs.mkdir(initUserDataPath, { recursive: true });
  await fs.writeFile(
    path.join(initUserDataPath, 'preferences.json'),
    JSON.stringify({
      maximized: false,
      lastOpenedCollections: [collectionPath.replace(/\\/g, '/')],
      preferences: {
        onboarding: {
          hasLaunchedBefore: true,
          hasSeenWelcomeModal: true
        }
      }
    }, null, 2),
    'utf8'
  );
  return initUserDataPath;
};

const resizeElectronWindow = async (app: ElectronApplication, page: Page, width: number, height: number) => {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
  }, { width, height });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
};

const capture = async (app: ElectronApplication, page: Page, name: string, width: number, height: number) => {
  await resizeElectronWindow(app, page, width, height);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-${width}x${height}.png`), fullPage: true });
};

const openImportCollectionModal = async (page: Page) => {
  const locators = buildCommonLocators(page);
  await locators.plusMenu.button().click();
  await locators.plusMenu.importCollection().click();
  const modal = page.getByTestId('import-collection-modal');
  await expect(modal).toBeVisible();
  return modal;
};

const readEnvironmentFile = async (collectionPath: string) =>
  fs.readFile(path.join(collectionPath, 'environments', `${ENVIRONMENT_NAME}.bru`), 'utf8');

test.describe.serial('GitLab and AWS integration UI', () => {
  test('configures providers, lists GitLab projects, and saves AWS external references without touching user state', async ({
    launchElectronApp,
    createTmpDir
  }) => {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    const testRoot = await createTmpDir('gitlab-aws-integration');
    const collectionPath = await writeIntegrationCollection(testRoot);
    const initUserDataPath = await writeInitUserData(testRoot, collectionPath);
    const mockGitLab = await startMockGitLab();
    let app: ElectronApplication | undefined;

    try {
      app = await launchElectronApp({ initUserDataPath });
      const page = await waitForReadyPage(app);
      await resizeElectronWindow(app, page, 1440, 1000);
      const locators = buildCommonLocators(page);
      await expect(locators.sidebar.collection(COLLECTION_NAME)).toBeVisible({ timeout: 15000 });
      const collectionChevron = locators.sidebar.collectionChevron(COLLECTION_NAME);
      const isExpanded = await collectionChevron.evaluate((el: HTMLElement) => el.classList.contains('rotate-90'));
      if (!isExpanded) {
        await collectionChevron.click();
      }
      await locators.sidebar.request('ping').click();
      await expect(locators.environment.selector()).toBeVisible({ timeout: 10000 });

      await test.step('Preferences > Git Providers saves, tests and clears a synthetic GitLab PAT', async () => {
        await openPreferences(page);
        await selectPreferencesTab(page, 'Git Providers');
        await page.getByTestId('gitlab-base-url-input').fill(mockGitLab.baseUrl);
        await page.getByTestId('gitlab-token-input').fill(SYNTHETIC_PAT);
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('GitLab settings saved')).toBeVisible();
        await expect(page.getByTestId('gitlab-token-input')).toHaveValue('');

        await page.getByRole('button', { name: 'Test' }).click();
        await expect(page.getByText('Connected as integration-user')).toBeVisible();

        await page.getByRole('button', { name: 'Clear' }).click();
        await expect(page.getByText('GitLab settings cleared')).toBeVisible();

        await page.getByTestId('gitlab-base-url-input').fill(mockGitLab.baseUrl);
        await page.getByTestId('gitlab-token-input').fill(SYNTHETIC_PAT);
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('GitLab settings saved')).toBeVisible();
        await expect(page.getByTestId('gitlab-token-input')).toHaveValue('');

        await capture(app!, page, 'settings-git-providers', 1440, 1000);
        await capture(app!, page, 'settings-git-providers', 900, 700);
        await closePreferences(page);
      });

      expect(mockGitLab.requests.some((request) => request.url?.startsWith('/gitlab/api/v4/user') && request.token === SYNTHETIC_PAT)).toBe(true);

      await test.step('GitLab import tab lists accessible projects from the configured loopback API', async () => {
        const importModal = await openImportCollectionModal(page);
        await importModal.getByTestId('gitlab-tab').click();
        await expect(importModal.getByText('Payments API')).toBeVisible({ timeout: 10000 });
        await expect(importModal.getByText('platform/payments-api')).toBeVisible();
        expect(mockGitLab.requests.some((request) => request.url?.startsWith('/gitlab/api/v4/projects') && request.token === SYNTHETIC_PAT)).toBe(true);
        await importModal.getByTestId('modal-close-button').click();
        await importModal.waitFor({ state: 'hidden' });
      });

      await test.step('Preferences > Secret Managers saves disabled AWS defaults without credentials', async () => {
        await openPreferences(page);
        await selectPreferencesTab(page, 'Secret Managers');
        const enabled = page.getByLabel('Enable AWS Secrets Manager');
        if (await enabled.isChecked()) {
          await enabled.uncheck();
        }
        await page.getByTestId('aws-secrets-region-input').fill('ap-northeast-2');
        await page.getByTestId('aws-secrets-profile-input').fill('integration-profile');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('AWS Secrets Manager settings saved')).toBeVisible();
        await expect(page.getByLabel(/access key/i)).toHaveCount(0);
        await closePreferences(page);
      });

      await test.step('External Secrets can save and discard references while preserving regular .bru vars', async () => {
        await locators.sidebar.request('ping').click();
        await expect(locators.environment.selector()).toBeVisible({ timeout: 10000 });
        await openEnvironmentConfigTab(page, 'collection');
        await openEnvironmentInSettings(page, ENVIRONMENT_NAME, 'collection');
        await page.getByRole('tab', { name: 'External Secrets' }).click();
        await expect(page.getByTestId('external-secrets-editor')).toBeVisible();

        await page.getByRole('button', { name: 'Add reference' }).click();
        await page.getByLabel('Variable name 1').fill('API_TOKEN');
        await page.getByLabel('Secret ID or ARN 1').fill('dev/api');
        await page.getByLabel('JSON field (optional) 1').fill('token');
        await page.getByLabel('Region override (optional) 1').fill('us-east-1');
        await page.getByLabel('Profile override (optional) 1').fill('integration-profile');
        await page.getByRole('button', { name: 'Save references' }).click();
        await expect(page.getByText('Secret references saved. Values are fetched when you run requests.')).toBeVisible();

        await expect.poll(() => readEnvironmentFile(collectionPath)).toContain('preserved_regular: keep-me');
        const saved = await readEnvironmentFile(collectionPath);
        expect(saved).toContain('vars:externalsecrets:aws-secrets-manager');
        expect(saved).toContain('API_TOKEN:');
        expect(saved).toContain('"secretId":"dev/api"');
        expect(saved).toContain('"jsonKey":"token"');

        await capture(app!, page, 'external-secrets', 1440, 1000);
        await capture(app!, page, 'external-secrets', 900, 700);

        await page.getByLabel('Secret ID or ARN 1').fill('dev/changed');
        await expect(page.getByText('Unsaved references')).toBeVisible();
        await page.getByRole('button', { name: 'Discard changes' }).click();
        await expect(page.getByLabel('Secret ID or ARN 1')).toHaveValue('dev/api');
        expect(await readEnvironmentFile(collectionPath)).toBe(saved);
      });
    } finally {
      await mockGitLab.close();
      if (app) {
        await closeElectronApp(app);
      }
    }
  });
});
