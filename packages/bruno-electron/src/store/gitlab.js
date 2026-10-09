const Store = require('electron-store');
const { encryptStringSafe, decryptStringSafe } = require('../utils/encryption');

const STORE_KEY = 'settings';

const isLoopbackHostname = (hostname) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());

const normalizeGitLabBaseUrl = (value) => {
  const rawUrl = typeof value === 'string' ? value.trim() : '';
  if (!rawUrl) {
    return '';
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error('GitLab URL is not valid');
  }

  if (parsed.username || parsed.password) {
    throw new Error('GitLab URL must not include credentials');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('GitLab URL must not include query parameters or fragments');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
    throw new Error('GitLab URL must use HTTPS');
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');

  return parsed.toString().replace(/\/+$/, '');
};

const getUrlKey = (baseUrl) => {
  const normalized = normalizeGitLabBaseUrl(baseUrl);
  if (!normalized) {
    return '';
  }
  const parsed = new URL(normalized);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
};

class GitLabStore {
  constructor() {
    this.store = new Store({
      name: 'gitlab',
      clearInvalidConfig: true
    });
  }

  getRawSettings() {
    return this.store.get(STORE_KEY, {});
  }

  getSettings() {
    const settings = this.getRawSettings();
    const baseUrl = settings.baseUrl ? normalizeGitLabBaseUrl(settings.baseUrl) : '';
    return {
      baseUrl,
      configured: Boolean(baseUrl && settings.encryptedToken)
    };
  }

  getToken() {
    const settings = this.getRawSettings();
    if (!settings.encryptedToken) {
      return '';
    }

    const decrypted = decryptStringSafe(settings.encryptedToken);
    return decrypted.success ? decrypted.value : '';
  }

  getCredentialsForBaseUrl(baseUrl) {
    const requestedKey = getUrlKey(baseUrl);
    const settings = this.getRawSettings();
    if (!requestedKey || !settings.baseUrl || requestedKey !== getUrlKey(settings.baseUrl)) {
      return null;
    }

    const token = this.getToken();
    if (!token) {
      return null;
    }

    return {
      baseUrl: normalizeGitLabBaseUrl(settings.baseUrl),
      token
    };
  }

  saveSettings(payload = {}) {
    const { baseUrl, token } = payload;
    const normalizedBaseUrl = normalizeGitLabBaseUrl(baseUrl);
    const currentSettings = this.getRawSettings();
    const currentBaseUrl = currentSettings.baseUrl ? normalizeGitLabBaseUrl(currentSettings.baseUrl) : '';
    const suppliedToken = typeof token === 'string' ? token.trim() : '';
    const hasTokenField = Object.prototype.hasOwnProperty.call(payload, 'token');
    const shouldReplaceToken = hasTokenField && suppliedToken.length > 0;
    const sameServer = currentBaseUrl && normalizedBaseUrl && getUrlKey(currentBaseUrl) === getUrlKey(normalizedBaseUrl);

    if (!normalizedBaseUrl) {
      this.clearSettings();
      return this.getSettings();
    }

    if (!shouldReplaceToken && currentSettings.encryptedToken && !sameServer) {
      throw new Error('A new GitLab token is required when changing the GitLab URL');
    }

    let encryptedToken = sameServer ? currentSettings.encryptedToken : '';
    if (shouldReplaceToken) {
      const encrypted = encryptStringSafe(suppliedToken);
      if (!encrypted.success || !encrypted.value) {
        throw new Error('Unable to encrypt GitLab token');
      }
      encryptedToken = encrypted.value;
    }

    this.store.set(STORE_KEY, {
      baseUrl: normalizedBaseUrl,
      encryptedToken: encryptedToken || ''
    });

    return this.getSettings();
  }

  clearSettings() {
    this.store.delete(STORE_KEY);
    return { baseUrl: '', configured: false };
  }
}

module.exports = {
  GitLabStore,
  normalizeGitLabBaseUrl,
  getUrlKey,
  isLoopbackHostname
};
