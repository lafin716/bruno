const axios = require('axios');

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}));

jest.mock('axios', () => ({
  create: jest.fn()
}));

const { buildGitLabApiUrl, createGitLabClient, testGitLabConnection, listGitLabProjects } = require('./gitlab');

describe('GitLab service', () => {
  let get;

  beforeEach(() => {
    get = jest.fn();
    axios.create.mockReset();
    axios.create.mockReturnValue({ get });
  });

  it('builds API URLs under a configured GitLab path prefix', () => {
    expect(buildGitLabApiUrl('https://gitlab.example.com/gitlab', '/projects')).toBe('https://gitlab.example.com/gitlab/api/v4/projects');
  });

  it('creates a client with PAT auth and redirects disabled', () => {
    createGitLabClient({ baseUrl: 'https://gitlab.example.com/gitlab', token: 'glpat-secret' });

    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://gitlab.example.com/gitlab/api/v4',
      headers: { 'PRIVATE-TOKEN': 'glpat-secret' },
      maxRedirects: 0
    }));
  });

  it('tests the connection without returning the token', async () => {
    get.mockResolvedValue({ data: { username: 'alice' } });

    await expect(testGitLabConnection({ baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }))
      .resolves.toEqual({ username: 'alice' });
    expect(get).toHaveBeenCalledWith('user');
  });

  it('lists projects with pagination and maps safe fields', async () => {
    get.mockResolvedValue({
      headers: { 'x-next-page': '2' },
      data: [{
        id: 10,
        name: 'API',
        path_with_namespace: 'team/api',
        http_url_to_repo: 'https://gitlab.example.com/team/api.git',
        ssh_url_to_repo: 'git@gitlab.example.com:team/api.git',
        default_branch: 'main'
      }]
    });

    await expect(listGitLabProjects({
      baseUrl: 'https://gitlab.example.com',
      token: 'glpat-secret',
      search: ' api ',
      page: 3
    })).resolves.toEqual({
      projects: [{
        id: 10,
        name: 'API',
        pathWithNamespace: 'team/api',
        httpUrl: 'https://gitlab.example.com/team/api.git',
        sshUrl: 'git@gitlab.example.com:team/api.git',
        defaultBranch: 'main'
      }],
      hasMore: true
    });

    expect(get).toHaveBeenCalledWith('projects', {
      params: {
        membership: true,
        simple: true,
        per_page: 20,
        page: 3,
        search: 'api'
      }
    });
  });

  it('redacts tokens from errors', async () => {
    get.mockRejectedValue(new Error('remote said glpat-secret is denied'));

    await expect(testGitLabConnection({ baseUrl: 'https://gitlab.example.com', token: 'glpat-secret' }))
      .rejects.toThrow('remote said [REDACTED] is denied');
  });
});
