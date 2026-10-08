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

jest.mock('../../utils/encryption', () => ({
  encryptStringSafe: (value) => ({ success: true, value: `encrypted:${value}` }),
  decryptStringSafe: (value) => ({ success: value.startsWith('encrypted:'), value: value.replace(/^encrypted:/, '') })
}));

const { GitLabStore, normalizeGitLabBaseUrl } = require('../gitlab');

describe('normalizeGitLabBaseUrl', () => {
  it('normalizes HTTPS GitLab URLs with path prefixes', () => {
    expect(normalizeGitLabBaseUrl(' https://gitlab.example.com/gitlab/ ')).toBe('https://gitlab.example.com/gitlab');
  });

  it('allows loopback HTTP for local tests', () => {
    expect(normalizeGitLabBaseUrl('http://127.0.0.1:3000/gitlab')).toBe('http://127.0.0.1:3000/gitlab');
  });

  it('rejects non-loopback HTTP and embedded credentials', () => {
    expect(() => normalizeGitLabBaseUrl('http://gitlab.example.com')).toThrow('GitLab URL must use HTTPS');
    expect(() => normalizeGitLabBaseUrl('https://token@gitlab.example.com')).toThrow('must not include credentials');
  });
});

describe('GitLabStore', () => {
  beforeEach(() => {
    mockStoredValues = {};
  });

  it('stores encrypted tokens but returns only safe settings', () => {
    const store = new GitLabStore();

    expect(store.saveSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' })).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      configured: true
    });

    expect(mockStoredValues.settings.encryptedToken).toBe('encrypted:glpat-secret');
    expect(store.getSettings()).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      configured: true
    });
  });

  it('preserves a saved token only for the same normalized server', () => {
    const store = new GitLabStore();
    store.saveSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });

    store.saveSettings({ baseUrl: 'https://gitlab.example.com/gitlab/' });

    expect(store.getToken()).toBe('glpat-secret');
  });

  it('requires a fresh token before changing servers', () => {
    const store = new GitLabStore();
    store.saveSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });

    expect(() => store.saveSettings({ baseUrl: 'https://gitlab.example.com/other' })).toThrow('new GitLab token is required');
  });

  it('resolves credentials only for the matching configured base URL', () => {
    const store = new GitLabStore();
    store.saveSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });

    expect(store.getCredentialsForBaseUrl('https://gitlab.example.com/gitlab')).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      token: 'glpat-secret'
    });
    expect(store.getCredentialsForBaseUrl('https://gitlab.example.com/other')).toBeNull();
  });
});
