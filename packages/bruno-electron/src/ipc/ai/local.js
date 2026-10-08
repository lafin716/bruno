const { ipcMain } = require('electron');
const { getPreferences } = require('../../store/preferences');
const { generateLocalText, testLocalProvider } = require('./local-cli');
const { importOpenApiWithAi } = require('./collection-import');

const PROVIDERS = [
  { id: 'codex', label: 'Codex', executable: 'codex' },
  { id: 'claude', label: 'Claude Code', executable: 'claude' }
];

const DEFAULT_LOCAL_PROVIDERS = {
  preferredProvider: 'codex',
  codex: { enabled: false, executable: 'codex', model: '' },
  claude: { enabled: false, executable: 'claude', model: '' }
};

const MAX_CONCURRENT_JOBS_PER_SENDER = 3;

const senderJobs = new Map();

function sanitizeError(error) {
  return String(error?.message || error || 'Local AI request failed.')
    .replace(/[^\S\r\n]+/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);
}

function getLocalProvidersPrefs() {
  return {
    ...DEFAULT_LOCAL_PROVIDERS,
    ...(getPreferences().ai?.localProviders || {})
  };
}

function normalizeProviderConfig(providerId, localProviders = getLocalProvidersPrefs()) {
  const defaults = DEFAULT_LOCAL_PROVIDERS[providerId];
  const saved = localProviders[providerId] || {};
  if (!defaults) {
    throw new Error(`Unknown local AI provider: ${providerId}`);
  }
  return {
    enabled: Boolean(saved.enabled),
    executable: typeof saved.executable === 'string' && saved.executable.trim()
      ? saved.executable.trim()
      : defaults.executable,
    model: typeof saved.model === 'string' ? saved.model.trim() : ''
  };
}

function getProviderId(requestedProviderId) {
  const localProviders = getLocalProvidersPrefs();
  const providerId = requestedProviderId || localProviders.preferredProvider || DEFAULT_LOCAL_PROVIDERS.preferredProvider;
  if (!PROVIDERS.some((provider) => provider.id === providerId)) {
    throw new Error(`Unknown local AI provider: ${providerId}`);
  }
  return providerId;
}

function assertAiEnabled() {
  if (!getPreferences().ai?.enabled) {
    throw new Error('AI features are disabled. Enable them in Preferences > AI.');
  }
}

function getEnabledProviderConfig(providerId) {
  const config = normalizeProviderConfig(providerId);
  if (!config.enabled) {
    throw new Error(`${providerId === 'codex' ? 'Codex' : 'Claude Code'} local AI is disabled. Enable it in Preferences > AI.`);
  }
  return config;
}

function buildLocalStatus() {
  const localProviders = getLocalProvidersPrefs();
  return {
    providers: PROVIDERS.map((provider) => {
      const config = normalizeProviderConfig(provider.id, localProviders);
      return {
        id: provider.id,
        label: provider.label,
        enabled: config.enabled,
        executable: config.executable,
        model: config.model
      };
    }),
    preferredProvider: localProviders.preferredProvider || DEFAULT_LOCAL_PROVIDERS.preferredProvider
  };
}

function getSenderId(event) {
  const id = event?.sender?.id;
  if (!Number.isInteger(id)) {
    throw new Error('Local AI IPC sender is unavailable.');
  }
  return id;
}

function getRequestId(payload) {
  const requestId = payload?.requestId;
  if (typeof requestId !== 'string' || !requestId.trim()) {
    throw new Error('requestId is required.');
  }
  return requestId.trim();
}

function jobsForSender(senderId) {
  let jobs = senderJobs.get(senderId);
  if (!jobs) {
    jobs = new Map();
    senderJobs.set(senderId, jobs);
  }
  return jobs;
}

function cancelSenderJobs(senderId) {
  const jobs = senderJobs.get(senderId);
  if (!jobs) return;
  for (const job of jobs.values()) {
    job.controller.abort();
  }
  senderJobs.delete(senderId);
}

function registerSenderCleanup(event, senderId) {
  const sender = event?.sender;
  if (!sender || sender.__brunoLocalAiCleanupRegistered) return;
  sender.__brunoLocalAiCleanupRegistered = true;
  if (typeof sender.once === 'function') {
    sender.once('destroyed', () => cancelSenderJobs(senderId));
  }
}

function startJob(event, requestId) {
  const senderId = getSenderId(event);
  registerSenderCleanup(event, senderId);

  const jobs = jobsForSender(senderId);
  if (jobs.has(requestId)) {
    throw new Error(`Local AI request is already running: ${requestId}`);
  }
  if (jobs.size >= MAX_CONCURRENT_JOBS_PER_SENDER) {
    throw new Error('Too many local AI import jobs are running. Cancel one before starting another.');
  }

  const controller = new AbortController();
  jobs.set(requestId, { controller });
  return {
    senderId,
    signal: controller.signal,
    finish: () => {
      jobs.delete(requestId);
      if (jobs.size === 0) {
        senderJobs.delete(senderId);
      }
    }
  };
}

function cancelJob(event, requestId) {
  const senderId = getSenderId(event);
  const jobs = senderJobs.get(senderId);
  const job = jobs?.get(requestId);
  if (!job) {
    return false;
  }

  job.controller.abort();
  jobs.delete(requestId);
  if (jobs.size === 0) {
    senderJobs.delete(senderId);
  }
  return true;
}

function registerLocalAiIpc(mainWindow) {
  ipcMain.handle('renderer:ai-local-status', async () => buildLocalStatus());

  ipcMain.handle('renderer:ai-local-test', async (_event, payload = {}) => {
    try {
      assertAiEnabled();
      const providerId = getProviderId(payload.providerId);
      const config = getEnabledProviderConfig(providerId);
      return await testLocalProvider({ providerId, config });
    } catch (error) {
      return { ok: false, error: sanitizeError(error) };
    }
  });

  ipcMain.handle('renderer:ai-import-openapi', async (event, payload = {}) => {
    assertAiEnabled();
    const providerId = getProviderId(payload.providerId);
    const config = getEnabledProviderConfig(providerId);
    const requestId = getRequestId(payload);
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) {
      throw new Error('OpenAPI URL is required.');
    }

    const job = startJob(event, requestId);
    try {
      return await importOpenApiWithAi({
        url,
        signal: job.signal,
        generate: (prompt, signal) => generateLocalText({
          providerId,
          config,
          prompt,
          signal: signal || job.signal
        })
      });
    } catch (error) {
      throw new Error(sanitizeError(error));
    } finally {
      job.finish();
    }
  });

  ipcMain.handle('renderer:ai-import-cancel', async (event, payload = {}) => {
    const requestId = getRequestId(payload);
    return { ok: true, cancelled: cancelJob(event, requestId) };
  });

  return mainWindow;
}

module.exports = {
  registerLocalAiIpc,
  buildLocalStatus,
  _private: {
    cancelSenderJobs,
    senderJobs,
    sanitizeError
  }
};
