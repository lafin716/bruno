import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { test, expect, waitForReadyPage, closeElectronApp } from '../../playwright';
import { buildAiImportLocators, openAiImport } from '../utils/page/ai-import';
import { openPreferences, selectPreferencesTab, closePreferences } from '../utils/page/preferences';
import { openCollection, openRequestInFolder, selectEnvironment, sendRequest } from '../utils/page';

test.setTimeout(90000);

const document = (title = 'AI Smoke API', serverUrl = 'https://api.example.test/v1') => ({
  openapi: '3.0.3',
  info: { title, version: '1.0.0' },
  servers: [{ url: serverUrl, description: 'Local' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        summary: 'Login',
        security: [],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string', example: 'do-not-send-this-example-to-ai' } } } } } },
        responses: { 200: { description: 'Logged in', content: { 'application/json': { schema: { type: 'object', properties: { access_token: { type: 'string' } } } } } } }
      }
    },
    '/users': { get: { summary: 'List users', responses: { 200: { description: 'Users' } } } }
  }
});

const plan = {
  groups: [{ name: 'Authentication', endpointIds: ['POST /auth/login'] }, { name: 'Users', endpointIds: ['GET /users'] }],
  tokenCaptures: [{ endpointId: 'POST /auth/login', path: ['access_token'], variable: 'token' }],
  warnings: []
};

async function setup(createTmpDir) {
  const root = await createTmpDir('ai-import-smoke');
  const userDataPath = path.join(root, 'user');
  const executable = path.join(root, 'codex-fixture.js');
  const promptFile = path.join(root, 'prompt.txt');
  await fs.mkdir(userDataPath);
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli fixture'); process.exit(0); }
if (process.argv.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(0); }
let input=''; process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
  fs.writeFileSync(${JSON.stringify(promptFile)},input);
  if(input.includes('Fail API')) { console.log(JSON.stringify({type:'turn.failed',error:{message:'Fixture generation failed'}})); process.exit(1); }
  const output=()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(plan))}}}));console.log(JSON.stringify({type:'turn.completed'}));};
  if(input.includes('Slow API')) setTimeout(output,30000); else output();
});
`, { mode: 0o755 });
  await fs.writeFile(path.join(userDataPath, 'preferences.json'), JSON.stringify({
    preferences: {
      onboarding: { hasLaunchedBefore: true, hasSeenWelcomeModal: true, lastSeenVersion: '2.0.0' },
      ai: { enabled: true, localProviders: { preferredProvider: 'codex', codex: { enabled: true, executable, model: '' }, claude: { enabled: false, executable: 'claude', model: '' } } }
    }
  }));
  let baseUrl = '';
  const receivedRequests: { path: string; authorization?: string }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/v1/')) {
      receivedRequests.push({ path: req.url, authorization: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/auth/login')) {
        res.end(JSON.stringify({ access_token: 'synthetic-access-token' }));
      } else {
        res.statusCode = req.headers.authorization === 'Bearer synthetic-access-token' ? 200 : 401;
        res.end(JSON.stringify({ authenticated: res.statusCode === 200 }));
      }
      return;
    }
    if (req.url === '/swagger/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><script>SwaggerUIBundle({url: "/spec.json"})</script></html>');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(document(req.url === '/slow.json' ? 'Slow API' : req.url === '/fail.json' ? 'Fail API' : 'AI Smoke API', `${baseUrl}/api/v1`)));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { root, userDataPath, executable, promptFile, baseUrl, receivedRequests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('local CLI settings and Swagger AI import save folders, auth, URL environments and token script', async ({ launchElectronApp, createTmpDir }, testInfo) => {
  const fixture = await setup(createTmpDir);
  let app;
  try {
    app = await launchElectronApp({ userDataPath: fixture.userDataPath });
    const page = await waitForReadyPage(app);
    const ui = buildAiImportLocators(page);
    await openPreferences(page);
    await selectPreferencesTab(page, 'AI');
    await ui.localSettingsTab().click();
    await expect(ui.executable('codex')).toHaveValue(fixture.executable);
    await ui.testConnection('codex').click();
    await expect(ui.connectionFeedback('codex')).toContainText(/connected|ready|authenticated/i);
    await page.screenshot({ path: testInfo.outputPath('local-settings-desktop.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(850, 700));
    await page.screenshot({ path: testInfo.outputPath('local-settings-narrow.png') });
    await closePreferences(page);
    await openAiImport(page);
    await ui.url().fill(`${fixture.baseUrl}/swagger/`);
    await ui.generate().click();
    await expect(ui.preview()).toContainText('AI Smoke API', { timeout: 30000 });
    const prompt = await fs.readFile(fixture.promptFile, 'utf8');
    expect(prompt).not.toContain('do-not-send-this-example-to-ai');
    expect(await fs.readdir(fixture.root)).not.toContain('AI Smoke API');
    await page.screenshot({ path: testInfo.outputPath('ai-import-narrow.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 850));
    await page.screenshot({ path: testInfo.outputPath('ai-import-desktop.png') });
    await ui.continue().click();
    await ui.location().fill(fixture.root);
    await ui.import().click();
    await expect(ui.locationModal()).not.toBeVisible();
    const collectionDir = path.join(fixture.root, 'AI Smoke API');
    await expect.poll(async () => fs.readdir(collectionDir).catch(() => [])).toContain('Authentication');
    expect(await fs.readdir(collectionDir)).toContain('Users');
    const authFiles = await fs.readdir(path.join(collectionDir, 'Authentication'));
    const loginFile = authFiles.find((name) => /Login/i.test(name));
    expect(loginFile).toBeTruthy();
    const login = await fs.readFile(path.join(collectionDir, 'Authentication', loginFile!), 'utf8');
    expect(login).toContain('bru.setVar');
    expect(login).toContain('access_token');
    expect(login).toContain('{{baseUrl}}');
    const envFiles = await fs.readdir(path.join(collectionDir, 'environments'));
    const environment = await fs.readFile(path.join(collectionDir, 'environments', envFiles[0]), 'utf8');
    expect(environment).toContain(`${fixture.baseUrl}/api/v1`);
    const configFiles = await fs.readdir(collectionDir);
    const authConfig = await fs.readFile(path.join(collectionDir, configFiles.includes('collection.bru') ? 'collection.bru' : 'opencollection.yml'), 'utf8');
    expect(authConfig).toMatch(/bearer/i);
    expect(authConfig).toContain('{{token}}');
    await openCollection(page, 'AI Smoke API');
    await openRequestInFolder(page, 'Authentication', 'Login');
    await selectEnvironment(page, 'Local');
    await sendRequest(page, 200);
    await openRequestInFolder(page, 'Users', 'List users');
    await sendRequest(page, 200);
    expect(fixture.receivedRequests).toEqual([
      { path: '/api/v1/auth/login', authorization: undefined },
      { path: '/api/v1/users', authorization: 'Bearer synthetic-access-token' }
    ]);
  } finally {
    if (app) await closeElectronApp(app);
    await fixture.close();
  }
});

test('failed and cancelled AI imports remain editable and never save a collection', async ({ launchElectronApp, createTmpDir }) => {
  const fixture = await setup(createTmpDir);
  let app;
  try {
    app = await launchElectronApp({ userDataPath: fixture.userDataPath });
    const page = await waitForReadyPage(app);
    const ui = buildAiImportLocators(page);
    await openAiImport(page);
    await ui.url().fill(`${fixture.baseUrl}/fail.json`);
    await ui.generate().click();
    await expect(ui.error()).toBeVisible({ timeout: 30000 });
    await expect(ui.generate()).toBeEnabled();
    await ui.url().fill(`${fixture.baseUrl}/slow.json`);
    await ui.generate().click();
    await expect.poll(async () => fs.readFile(fixture.promptFile, 'utf8').catch(() => '')).toContain('Slow API');
    await ui.cancel().click();
    await expect(ui.url()).toBeEnabled();
    await expect(ui.preview()).not.toBeVisible();
    expect(await fs.readdir(fixture.root)).not.toContain('AI Smoke API');
    await ui.url().fill(`${fixture.baseUrl}/spec.json`);
    await ui.generate().click();
    await expect(ui.preview()).toContainText('AI Smoke API', { timeout: 30000 });
  } finally {
    if (app) await closeElectronApp(app);
    await fixture.close();
  }
});
