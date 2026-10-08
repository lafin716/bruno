let mockStoredValues;

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
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

jest.mock('../services/gitlab', () => ({
  testGitLabConnection: jest.fn(),
  listGitLabProjects: jest.fn()
}));

const { testGitLabConnection, listGitLabProjects } = require('../services/gitlab');
const {
  saveGitLabSettings,
  getGitLabSettings,
  resolveGitLabCredentials,
  handleTestGitLabConnection,
  handleListGitLabProjects
} = require('./gitlab');

describe('GitLab IPC helpers', () => {
  beforeEach(() => {
    mockStoredValues = {};
    jest.clearAllMocks();
  });

  it('returns safe settings after saving a PAT', () => {
    expect(saveGitLabSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' })).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      configured: true
    });

    expect(getGitLabSettings()).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      configured: true
    });
  });

  it('falls back to the saved token only for the same server', () => {
    saveGitLabSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });

    expect(resolveGitLabCredentials({ baseUrl: 'https://gitlab.example.com/gitlab/' })).toEqual({
      baseUrl: 'https://gitlab.example.com/gitlab',
      token: 'glpat-secret'
    });

    expect(() => resolveGitLabCredentials({ baseUrl: 'https://gitlab.example.com/other' })).toThrow('GitLab token is required');
  });

  it('passes explicit test credentials without storing or returning the token', async () => {
    testGitLabConnection.mockResolvedValue({ username: 'alice' });

    await expect(handleTestGitLabConnection({}, {
      baseUrl: 'https://gitlab.example.com',
      token: 'glpat-adhoc'
    })).resolves.toEqual({ username: 'alice' });

    expect(testGitLabConnection).toHaveBeenCalledWith({
      baseUrl: 'https://gitlab.example.com',
      token: 'glpat-adhoc'
    });
    expect(getGitLabSettings()).toEqual({ baseUrl: '', configured: false });
  });

  it('lists projects through saved credentials', async () => {
    saveGitLabSettings({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });
    listGitLabProjects.mockResolvedValue({ projects: [], hasMore: false });

    await expect(handleListGitLabProjects({}, { search: 'api', page: 2 })).resolves.toEqual({
      projects: [],
      hasMore: false
    });

    expect(listGitLabProjects).toHaveBeenCalledWith({
      baseUrl: 'https://gitlab.example.com/gitlab',
      token: 'glpat-secret',
      search: 'api',
      page: 2
    });
  });
});
