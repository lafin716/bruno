const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let mockStoredValues;

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}));

jest.mock('electron-store', () =>
  jest.fn().mockImplementation(() => ({
    get: (key, defaultValue) => (Object.prototype.hasOwnProperty.call(mockStoredValues, key) ? mockStoredValues[key] : defaultValue),
    set: (key, value) => {
      mockStoredValues[key] = value;
    },
    delete: (key) => {
      delete mockStoredValues[key];
    }
  }))
);

jest.mock('../utils/encryption', () => ({
  encryptStringSafe: (value) => ({ success: true, value: `encrypted:${value}` }),
  decryptStringSafe: (value) => ({ success: value.startsWith('encrypted:'), value: value.replace(/^encrypted:/, '') })
}));

jest.mock('@usebruno/filestore', () => ({
  parseRequest: jest.fn()
}), { virtual: true });

const { cloneGitRepository, fetchChanges, listBranchesForRemoteUrl } = require('./git');

const SYNTHETIC_PAT = 'synthetic-gitlab-pat';
const BASIC_AUTH = `Basic ${Buffer.from(`oauth2:${SYNTHETIC_PAT}`).toString('base64')}`;

const runGit = (args, cwd) => {
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    }
  });
};

const createDumbHttpRepository = (rootDirectory) => {
  const workingRepository = path.join(rootDirectory, 'work');
  const bareRepository = path.join(rootDirectory, 'api.git');

  fs.mkdirSync(workingRepository, { recursive: true });
  runGit(['init'], workingRepository);
  fs.writeFileSync(path.join(workingRepository, 'README.md'), 'hello from loopback git\n', 'utf8');
  runGit(['add', 'README.md'], workingRepository);
  runGit(['-c', 'user.name=Bruno Test', '-c', 'user.email=bruno@example.test', 'commit', '-m', 'initial'], workingRepository);
  runGit(['branch', '-M', 'main'], workingRepository);
  runGit(['checkout', '-b', 'develop'], workingRepository);
  fs.writeFileSync(path.join(workingRepository, 'develop.txt'), 'develop branch\n', 'utf8');
  runGit(['add', 'develop.txt'], workingRepository);
  runGit(['-c', 'user.name=Bruno Test', '-c', 'user.email=bruno@example.test', 'commit', '-m', 'develop'], workingRepository);
  runGit(['checkout', 'main'], workingRepository);
  runGit(['clone', '--bare', workingRepository, bareRepository], rootDirectory);
  runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], bareRepository);
  runGit(['update-server-info'], bareRepository);

  return bareRepository;
};

const createAuthenticatedGitServer = (bareRepository) => {
  const requests = [];
  let listening = false;
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization || ''
    });

    if (request.headers.authorization !== BASIC_AUTH) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitLab"' });
      response.end('Authentication required');
      return;
    }

    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const prefix = '/gitlab/team/api.git';
    if (!requestUrl.pathname.startsWith(prefix)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const relativePath = decodeURIComponent(requestUrl.pathname.slice(prefix.length)).replace(/^\/+/, '');
    const filePath = path.resolve(bareRepository, relativePath || 'info/refs');
    if (!filePath.startsWith(bareRepository) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': relativePath.endsWith('info/refs') ? 'text/plain' : 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
  });

  return {
    requests,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        listening = true;
        resolve(server.address().port);
      });
    }),
    close: () => new Promise((resolve, reject) => {
      if (!listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
};

describe('GitLab authenticated HTTP git integration', () => {
  let rootDirectory;
  let server;
  let askPassDirectories;
  let mkdtempSpy;
  let originalMkdtempSync;

  beforeEach(() => {
    mockStoredValues = {};
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-gitlab-http-'));
    askPassDirectories = [];
    originalMkdtempSync = fs.mkdtempSync.bind(fs);
    mkdtempSpy = jest.spyOn(fs, 'mkdtempSync').mockImplementation((prefix) => {
      const directory = originalMkdtempSync(prefix);
      if (String(prefix).includes('bruno-gitlab-askpass-')) {
        askPassDirectories.push(directory);
      }
      return directory;
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (mkdtempSpy) {
      mkdtempSpy.mockRestore();
    }
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('authenticates branch listing, clone and fetch through scoped askpass without persisting the token', async () => {
    const bareRepository = createDumbHttpRepository(rootDirectory);
    server = createAuthenticatedGitServer(bareRepository);
    const port = await server.listen();
    const baseUrl = `http://127.0.0.1:${port}/gitlab`;
    const repositoryUrl = `${baseUrl}/team/api.git`;
    const clonePath = path.join(rootDirectory, 'clone');

    mockStoredValues.settings = {
      baseUrl,
      encryptedToken: `encrypted:${SYNTHETIC_PAT}`
    };

    await expect(listBranchesForRemoteUrl({ url: repositoryUrl })).resolves.toEqual({
      branches: expect.arrayContaining(['main', 'develop']),
      defaultBranch: 'main'
    });

    const win = { webContents: { send: jest.fn() } };
    await expect(cloneGitRepository(win, {
      url: repositoryUrl,
      path: clonePath,
      branch: 'main',
      processUid: 'clone-loopback'
    })).resolves.toEqual(expect.any(String));

    const clonedConfig = fs.readFileSync(path.join(clonePath, '.git', 'config'), 'utf8');
    expect(clonedConfig).toContain(repositoryUrl);
    expect(clonedConfig).not.toContain(SYNTHETIC_PAT);
    expect(clonedConfig).not.toContain(encodeURIComponent(SYNTHETIC_PAT));
    expect(fs.existsSync(path.join(clonePath, 'README.md'))).toBe(true);

    await expect(fetchChanges(clonePath, 'origin')).resolves.toEqual(expect.any(String));
    const configAfterFetch = fs.readFileSync(path.join(clonePath, '.git', 'config'), 'utf8');
    expect(configAfterFetch).not.toContain(SYNTHETIC_PAT);
    expect(configAfterFetch).not.toContain(encodeURIComponent(SYNTHETIC_PAT));

    const authorizedRequests = server.requests.filter((request) => request.authorization === BASIC_AUTH);
    expect(authorizedRequests.length).toBeGreaterThan(0);
    expect(server.requests.some((request) => request.url.includes(SYNTHETIC_PAT))).toBe(false);
    expect(askPassDirectories.length).toBe(3);
    expect(askPassDirectories.every((directory) => !fs.existsSync(directory))).toBe(true);
  });
});
