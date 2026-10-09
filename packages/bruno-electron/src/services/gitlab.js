const axios = require('axios');
const { normalizeGitLabBaseUrl } = require('../store/gitlab');

const PROJECTS_PER_PAGE = 20;

const sanitizeGitLabError = (error, token) => {
  const message = error?.response?.data?.message || error?.message || 'GitLab request failed';
  let sanitized = typeof message === 'string' ? message : JSON.stringify(message);
  if (token) {
    sanitized = sanitized.split(token).join('[REDACTED]');
  }
  return sanitized;
};

const buildGitLabApiUrl = (baseUrl, apiPath) => {
  const normalizedBaseUrl = normalizeGitLabBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('GitLab URL is required');
  }

  const parsed = new URL(normalizedBaseUrl);
  const prefix = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${prefix}/api/v4/${apiPath.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString().replace(/\/+$/, '');
};

const createGitLabClient = ({ baseUrl, token }) => {
  const normalizedBaseUrl = normalizeGitLabBaseUrl(baseUrl);
  const apiBaseUrl = buildGitLabApiUrl(normalizedBaseUrl, '');

  if (!token || typeof token !== 'string') {
    throw new Error('GitLab token is required');
  }

  return axios.create({
    baseURL: apiBaseUrl,
    headers: {
      'PRIVATE-TOKEN': token
    },
    maxRedirects: 0,
    timeout: 15000,
    validateStatus: (status) => status >= 200 && status < 300
  });
};

const testGitLabConnection = async ({ baseUrl, token }) => {
  try {
    const client = createGitLabClient({ baseUrl, token });
    const response = await client.get('user');
    const username = response?.data?.username;
    if (!username || typeof username !== 'string') {
      throw new Error('GitLab user response did not include a username');
    }
    return { username };
  } catch (error) {
    throw new Error(sanitizeGitLabError(error, token));
  }
};

const mapGitLabProject = (project) => ({
  id: project.id,
  name: project.name,
  pathWithNamespace: project.path_with_namespace,
  httpUrl: project.http_url_to_repo,
  sshUrl: project.ssh_url_to_repo,
  defaultBranch: project.default_branch || null
});

const listGitLabProjects = async ({ baseUrl, token, search = '', page = 1 }) => {
  try {
    const client = createGitLabClient({ baseUrl, token });
    const response = await client.get('projects', {
      params: {
        membership: true,
        simple: true,
        per_page: PROJECTS_PER_PAGE,
        page,
        search: typeof search === 'string' ? search.trim() : ''
      }
    });

    const nextPage = response.headers?.['x-next-page'];
    return {
      projects: Array.isArray(response.data) ? response.data.map(mapGitLabProject) : [],
      hasMore: Boolean(nextPage)
    };
  } catch (error) {
    throw new Error(sanitizeGitLabError(error, token));
  }
};

module.exports = {
  PROJECTS_PER_PAGE,
  buildGitLabApiUrl,
  createGitLabClient,
  testGitLabConnection,
  listGitLabProjects,
  mapGitLabProject,
  sanitizeGitLabError
};
