let mockStoredValues;
let mockGitInstance;

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

jest.mock('simple-git', () => jest.fn(() => mockGitInstance));

jest.mock('@usebruno/filestore', () => ({
  parseRequest: jest.fn()
}), { virtual: true });

const simpleGit = require('simple-git');
const fs = require('fs');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');
const {
  parseRemoteBranches,
  handleGitOutput,
  createGitOutputRedactor,
  parseGitUrlRewriteRules,
  assertNoMatchingGitUrlRewrite,
  matchesGitLabRepositoryUrl,
  getGitLabCredentialsForRepositoryUrl,
  createGitAskPassScript,
  createGitAskPassHelper,
  listBranchesForRemoteUrl,
  cloneGitRepository,
  fetchChanges,
  pullGitChanges,
  pushGitChanges
} = require('./git');

describe('parseRemoteBranches', () => {
  it('reads the branch names and the default branch out of ls-remote output', () => {
    const output = [
      'ref: refs/heads/main\tHEAD',
      '9c1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f\tHEAD',
      '9c1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f\trefs/heads/main',
      '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\trefs/heads/feature/branch-selector'
    ].join('\n');

    expect(parseRemoteBranches(output)).toEqual({
      branches: ['main', 'feature/branch-selector'],
      defaultBranch: 'main'
    });
  });

  it('reads output written with CRLF line endings', () => {
    const output = ['ref: refs/heads/main\tHEAD', '9c1f2a3\trefs/heads/main', '1a2b3c4\trefs/heads/develop'].join('\r\n');

    expect(parseRemoteBranches(output)).toEqual({
      branches: ['main', 'develop'],
      defaultBranch: 'main'
    });
  });

  it('reports no default branch when the remote sends no symref line', () => {
    const output = ['9c1f2a3\trefs/heads/main', '1a2b3c4\trefs/heads/develop'].join('\n');

    expect(parseRemoteBranches(output)).toEqual({
      branches: ['main', 'develop'],
      defaultBranch: null
    });
  });

  it('ignores refs that are not branches', () => {
    const output = ['9c1f2a3\trefs/heads/main', '1a2b3c4\trefs/tags/v1.0.0', '2b3c4d5\trefs/pull/12/head'].join('\n');

    expect(parseRemoteBranches(output).branches).toEqual(['main']);
  });

  it('returns an empty listing for empty output', () => {
    expect(parseRemoteBranches('')).toEqual({ branches: [], defaultBranch: null });
    expect(parseRemoteBranches(undefined)).toEqual({ branches: [], defaultBranch: null });
  });
});

describe('GitLab git authentication helpers', () => {
  beforeEach(() => {
    mockStoredValues = {};
    mockGitInstance = {
      outputHandler: jest.fn(),
      env: jest.fn(function () {
        return this;
      }),
      raw: jest.fn().mockResolvedValue('ref: refs/heads/main\tHEAD\nabc\trefs/heads/main\n'),
      push: jest.fn((remote, branch, callback) => callback(null, 'push ok'))
    };
    simpleGit.mockClear();
  });

  it('matches repository URLs by origin and configured path prefix', () => {
    expect(matchesGitLabRepositoryUrl(
      'https://gitlab.example.com/gitlab',
      'https://gitlab.example.com/gitlab/team/api.git'
    )).toBe(true);
    expect(matchesGitLabRepositoryUrl(
      'https://gitlab.example.com/gitlab',
      'https://gitlab.example.com/gitlab-other/team/api.git'
    )).toBe(false);
    expect(matchesGitLabRepositoryUrl(
      'https://gitlab.example.com/gitlab',
      'https://token@gitlab.example.com/gitlab/team/api.git'
    )).toBe(false);
    expect(matchesGitLabRepositoryUrl(
      'https://gitlab.example.com/gitlab',
      'git@gitlab.example.com:gitlab/team/api.git'
    )).toBe(false);
  });

  it('returns credentials only for a matching configured GitLab repository URL', () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };

    expect(getGitLabCredentialsForRepositoryUrl('https://gitlab.example.com/gitlab/team/api.git')).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      remoteUrl: 'https://gitlab.example.com/gitlab/team/api.git',
      expectedPromptHost: 'gitlab.example.com',
      token: 'glpat-secret',
      username: 'oauth2'
    });
    expect(getGitLabCredentialsForRepositoryUrl('https://gitlab.example.com/other/team/api.git')).toBeNull();
  });

  it('creates an askpass script that reads the token from env and cleans it up', () => {
    const askPass = createGitAskPassScript({ username: 'oauth2', token: 'glpat-secret', expectedPromptHost: 'gitlab.example.com' });
    const script = fs.readFileSync(askPass.scriptPath, 'utf8');
    const helper = fs.readFileSync(askPass.helperPath, 'utf8');

    expect(helper).toContain('BRUNO_GITLAB_TOKEN');
    expect(helper).toContain('BRUNO_GITLAB_EXPECTED_PROMPT_HOST');
    expect(script).not.toContain('glpat-secret');
    expect(helper).not.toContain('glpat-secret');
    expect(askPass.env).toEqual(expect.objectContaining({
      GIT_ASKPASS: askPass.scriptPath,
      GIT_TERMINAL_PROMPT: '0',
      BRUNO_GITLAB_ASKPASS_NODE: process.execPath,
      BRUNO_GITLAB_ASKPASS_HELPER: askPass.helperPath,
      BRUNO_GITLAB_USERNAME: 'oauth2',
      BRUNO_GITLAB_TOKEN: 'glpat-secret',
      BRUNO_GITLAB_EXPECTED_PROMPT_HOST: 'gitlab.example.com'
    }));

    askPass.cleanup();
    expect(fs.existsSync(askPass.scriptPath)).toBe(false);
  });

  it('askpass helper enforces exact URI authority for generated scripts', () => {
    const askPass = createGitAskPassScript({ username: 'oauth2', token: 'glpat-secret', expectedPromptHost: 'gitlab.example.com' });
    const runAskPass = (prompt) => execFileSync(askPass.scriptPath, [prompt], {
      env: askPass.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const deniedPrompts = [
      'Password for https://gitlab.example.evil.test/gitlab/team/api.git',
      'Password for https://evil-gitlab.example/gitlab/team/api.git',
      'Password for https://evil.example/gitlab.example.com/team/api.git'
    ];

    expect(runAskPass('Username for https://gitlab.example.com/gitlab/team/api.git')).toBe('oauth2');
    expect(runAskPass('Password for https://oauth2@gitlab.example.com/gitlab/team/api.git')).toBe('glpat-secret');
    deniedPrompts.forEach((prompt) => {
      expect(() => runAskPass(prompt)).toThrow();
    });

    askPass.cleanup();
  });

  it('askpass helper rejects lookalike URI authorities directly', () => {
    const helperPath = require('path').join(require('os').tmpdir(), `askpass-helper-${Date.now()}.js`);
    fs.writeFileSync(helperPath, createGitAskPassHelper(), 'utf8');
    const runHelper = (prompt) => execFileSync(process.execPath, [helperPath, prompt], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        BRUNO_GITLAB_EXPECTED_PROMPT_HOST: 'gitlab.example.com',
        BRUNO_GITLAB_USERNAME: 'oauth2',
        BRUNO_GITLAB_TOKEN: 'glpat-secret'
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    expect(runHelper('Password for https://gitlab.example.com/gitlab/team/api.git')).toBe('glpat-secret');
    expect(() => runHelper('Password for https://gitlab.example.evil.test/gitlab/team/api.git')).toThrow();
    expect(() => runHelper('Password for https://evil-gitlab.example/gitlab/team/api.git')).toThrow();
    expect(() => runHelper('Password for https://evil.example/gitlab.example.com/team/api.git')).toThrow();

    fs.rmSync(helperPath, { force: true });
  });

  it('redacts tokens split across progress chunks before IPC', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const sent = [];
    const win = {
      webContents: {
        send: jest.fn((_channel, payload) => sent.push(payload.data))
      }
    };

    handleGitOutput({
      win,
      processUid: 'progress-1',
      sendStdout: true,
      redactions: ['glpat-secret']
    })({}, stdout, stderr);

    stderr.emit('data', Buffer.from('remote: token glpat-sec'));
    stderr.emit('data', Buffer.from('ret still hidden\n'));
    stderr.emit('end');
    stdout.emit('data', Buffer.from('stdout glpat-secret done\n'));
    stdout.emit('end');

    expect(sent.join('')).toContain('[REDACTED]');
    expect(sent.join('')).not.toContain('glpat-secret');
    expect(sent.every((chunk) => !chunk.includes('glpat-secret'))).toBe(true);
  });

  it('keeps enough redaction boundary for direct split chunks', () => {
    const redactor = createGitOutputRedactor(['glpat-secret']);

    const output = [
      redactor.push('before glpat-se'),
      redactor.push('cret after'),
      redactor.flush()
    ].join('');

    expect(output).toBe('before [REDACTED] after');
  });

  it('parses and blocks matching git URL rewrite rules before using saved credentials', async () => {
    const configOutput = [
      'url.https://mirror.example.com/.insteadOf https://gitlab.example.com/gitlab',
      'url.ssh://mirror.example.com/.pushInsteadOf https://push.example.com/'
    ].join('\n');

    expect(parseGitUrlRewriteRules(configOutput)).toEqual([
      {
        key: 'url.https://mirror.example.com/.insteadOf',
        value: 'https://gitlab.example.com/gitlab'
      },
      {
        key: 'url.ssh://mirror.example.com/.pushInsteadOf',
        value: 'https://push.example.com/'
      }
    ]);

    mockGitInstance.raw.mockResolvedValue(configOutput);
    await expect(assertNoMatchingGitUrlRewrite({
      gitRootPath: '/tmp/repo-rewrite',
      targetUrl: 'https://gitlab.example.com/gitlab/team/api.git'
    })).rejects.toThrow('Git URL rewrite config url.https://mirror.example.com/.insteadOf matches');
  });

  it('blocks authenticated GitLab operations before askpass when a rewrite matches', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    mockGitInstance.raw.mockResolvedValue(
      'url.https://mirror.example.com/.insteadOf https://gitlab.example.com/gitlab\n'
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(listBranchesForRemoteUrl({
      url: 'https://gitlab.example.com/gitlab/team/api.git'
    })).rejects.toThrow('refusing to send saved GitLab credentials');

    expect(mockGitInstance.env).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('uses scoped askpass, disables persistent helpers and cleans up after branch listing', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };

    await expect(listBranchesForRemoteUrl({ url: 'https://gitlab.example.com/gitlab/team/api.git' })).resolves.toEqual({
      branches: ['main'],
      defaultBranch: 'main'
    });

    const env = mockGitInstance.env.mock.calls[0][0];
    expect(env.BRUNO_GITLAB_TOKEN).toBe('glpat-secret');
    expect(fs.existsSync(env.GIT_ASKPASS)).toBe(false);
    expect(mockGitInstance.raw).toHaveBeenCalledWith([
      '-c',
      'credential.helper=',
      '-c',
      'http.followRedirects=false',
      'ls-remote',
      '--symref',
      'https://gitlab.example.com/gitlab/team/api.git',
      'HEAD',
      'refs/heads/*'
    ]);
  });

  it('uses scoped askpass and non-persistent credentials for matching GitLab clones', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    const win = { webContents: { send: jest.fn() } };

    await expect(cloneGitRepository(win, {
      url: 'https://gitlab.example.com/gitlab/team/api.git',
      path: '/tmp/bruno-api',
      branch: 'main',
      processUid: 'clone-1'
    })).resolves.toBe('ref: refs/heads/main\tHEAD\nabc\trefs/heads/main\n');

    const env = mockGitInstance.env.mock.calls[0][0];
    expect(env.BRUNO_GITLAB_TOKEN).toBe('glpat-secret');
    expect(fs.existsSync(env.GIT_ASKPASS)).toBe(false);
    expect(mockGitInstance.raw).toHaveBeenCalledWith([
      '-c',
      'credential.helper=',
      '-c',
      'http.followRedirects=false',
      'clone',
      '--progress',
      '--branch',
      'main',
      'https://gitlab.example.com/gitlab/team/api.git',
      '/tmp/bruno-api'
    ]);
  });

  it('uses scoped askpass and non-persistent credentials for matching GitLab fetches', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    mockGitInstance.raw.mockImplementation((args) => {
      if (args.join(' ') === 'remote get-url origin') {
        return Promise.resolve('https://gitlab.example.com/gitlab/team/api.git\n');
      }
      return Promise.resolve('fetch ok');
    });

    await expect(fetchChanges('/tmp/repo', 'origin')).resolves.toBe('fetch ok');

    expect(mockGitInstance.env.mock.calls[0][0].BRUNO_GITLAB_TOKEN).toBe('glpat-secret');
    expect(mockGitInstance.raw).toHaveBeenLastCalledWith([
      '-c',
      'credential.helper=',
      '-c',
      'http.followRedirects=false',
      'fetch',
      'origin'
    ]);
  });

  it('uses scoped askpass and non-persistent credentials for matching GitLab pulls', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    mockGitInstance.raw.mockImplementation((args) => {
      if (args.join(' ') === 'remote get-url origin') {
        return Promise.resolve('https://gitlab.example.com/gitlab/team/api.git\n');
      }
      return Promise.resolve('pull ok');
    });
    const win = { webContents: { send: jest.fn() } };

    await expect(pullGitChanges(win, {
      gitRootPath: '/tmp/repo',
      processUid: 'pull-1',
      remote: 'origin',
      remoteBranch: 'main',
      strategy: '--ff-only'
    })).resolves.toBe('pull ok');

    expect(mockGitInstance.env.mock.calls[0][0].BRUNO_GITLAB_TOKEN).toBe('glpat-secret');
    expect(mockGitInstance.raw).toHaveBeenLastCalledWith([
      '-c',
      'credential.helper=',
      '-c',
      'http.followRedirects=false',
      'pull',
      'origin',
      'main',
      '--ff-only'
    ]);
  });

  it('uses the matching GitLab push URL before sending push credentials', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    mockGitInstance.branch = jest.fn((callback) => callback(null, {
      branches: {
        main: { tracking: 'origin/main' }
      }
    }));
    mockGitInstance.raw.mockImplementation((args) => {
      if (args.join(' ') === 'remote get-url --push origin') {
        return Promise.resolve('https://gitlab.example.com/gitlab/team/api.git\n');
      }
      return Promise.resolve('push ok');
    });
    const win = { webContents: { send: jest.fn() } };

    await expect(pushGitChanges(win, {
      gitRootPath: '/tmp/repo-push-match',
      processUid: 'push-1',
      remote: 'origin',
      remoteBranch: 'main'
    })).resolves.toBe('push ok');

    expect(mockGitInstance.env.mock.calls[0][0].BRUNO_GITLAB_TOKEN).toBe('glpat-secret');
    expect(mockGitInstance.raw).toHaveBeenLastCalledWith([
      '-c',
      'credential.helper=',
      '-c',
      'http.followRedirects=false',
      'push',
      'origin',
      'main'
    ]);
  });

  it('does not send GitLab credentials when the push URL points elsewhere', async () => {
    mockStoredValues.settings = {
      baseUrl: 'https://gitlab.example.com/gitlab',
      encryptedToken: 'encrypted:glpat-secret'
    };
    mockGitInstance.branch = jest.fn((callback) => callback(null, {
      branches: {
        main: { tracking: 'origin/main' }
      }
    }));
    mockGitInstance.push = jest.fn((remote, branch, callback) => callback(null, 'fallback push ok'));
    mockGitInstance.raw.mockResolvedValue('https://mirror.example.com/gitlab/team/api.git\n');
    const win = { webContents: { send: jest.fn() } };

    await expect(pushGitChanges(win, {
      gitRootPath: '/tmp/repo-push-mirror',
      processUid: 'push-1',
      remote: 'origin',
      remoteBranch: 'main'
    })).resolves.toBe('fallback push ok');

    expect(mockGitInstance.env).not.toHaveBeenCalled();
    expect(mockGitInstance.push).toHaveBeenCalledWith('origin', 'main', expect.any(Function));
  });
});
