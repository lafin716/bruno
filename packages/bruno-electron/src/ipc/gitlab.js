const { ipcMain } = require('electron');
const { GitLabStore, normalizeGitLabBaseUrl } = require('../store/gitlab');
const { testGitLabConnection, listGitLabProjects } = require('../services/gitlab');

const gitLabStore = new GitLabStore();

const getGitLabSettings = () => gitLabStore.getSettings();

const saveGitLabSettings = (payload) => gitLabStore.saveSettings(payload);

const clearGitLabSettings = () => gitLabStore.clearSettings();

const resolveGitLabCredentials = ({ baseUrl, token } = {}) => {
  const safeBaseUrl = typeof baseUrl === 'string' && baseUrl.trim() ? normalizeGitLabBaseUrl(baseUrl) : getGitLabSettings().baseUrl;
  const suppliedToken = typeof token === 'string' ? token.trim() : '';
  if (suppliedToken) {
    return { baseUrl: safeBaseUrl, token: suppliedToken };
  }

  const savedCredentials = gitLabStore.getCredentialsForBaseUrl(safeBaseUrl);
  if (!savedCredentials) {
    throw new Error('GitLab token is required');
  }

  return savedCredentials;
};

const handleTestGitLabConnection = async (_event, payload = {}) => {
  const credentials = resolveGitLabCredentials(payload);
  return testGitLabConnection(credentials);
};

const handleListGitLabProjects = async (_event, payload = {}) => {
  const credentials = resolveGitLabCredentials(payload);
  return listGitLabProjects({
    ...credentials,
    search: payload.search,
    page: payload.page
  });
};

const registerGitLabIpc = () => {
  ipcMain.handle('renderer:get-gitlab-settings', getGitLabSettings);
  ipcMain.handle('renderer:save-gitlab-settings', (_event, payload) => saveGitLabSettings(payload));
  ipcMain.handle('renderer:clear-gitlab-settings', clearGitLabSettings);
  ipcMain.handle('renderer:test-gitlab-connection', handleTestGitLabConnection);
  ipcMain.handle('renderer:list-gitlab-projects', handleListGitLabProjects);
};

module.exports = registerGitLabIpc;
module.exports.gitLabStore = gitLabStore;
module.exports.getGitLabSettings = getGitLabSettings;
module.exports.saveGitLabSettings = saveGitLabSettings;
module.exports.clearGitLabSettings = clearGitLabSettings;
module.exports.resolveGitLabCredentials = resolveGitLabCredentials;
module.exports.handleTestGitLabConnection = handleTestGitLabConnection;
module.exports.handleListGitLabProjects = handleListGitLabProjects;
