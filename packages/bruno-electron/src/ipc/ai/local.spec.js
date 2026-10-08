jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() }
}));

jest.mock('../../store/preferences', () => ({
  getPreferences: jest.fn()
}));

jest.mock('./local-cli', () => ({
  generateLocalText: jest.fn(),
  testLocalProvider: jest.fn()
}));

jest.mock('./collection-import', () => ({
  importOpenApiWithAi: jest.fn()
}), { virtual: true });

const { ipcMain } = require('electron');
const { getPreferences } = require('../../store/preferences');
const { generateLocalText, testLocalProvider } = require('./local-cli');
const { importOpenApiWithAi } = require('./collection-import');
const { registerLocalAiIpc, _private } = require('./local');

describe('ipc/ai/local', () => {
  let handlers;

  const preferences = (overrides = {}) => ({
    ai: {
      enabled: true,
      localProviders: {
        preferredProvider: 'codex',
        codex: { enabled: true, executable: '/bin/codex', model: 'gpt-local' },
        claude: { enabled: true, executable: '/bin/claude', model: 'sonnet-local' },
        ...overrides
      }
    }
  });

  const register = () => {
    ipcMain.handle.mockReset();
    registerLocalAiIpc({});
    handlers = new Map(ipcMain.handle.mock.calls);
  };

  const sender = (id) => ({
    id,
    once: jest.fn()
  });

  const invoke = (channel, event, payload) => handlers.get(channel)(event, payload);

  beforeEach(() => {
    getPreferences.mockReturnValue(preferences());
    generateLocalText.mockReset().mockResolvedValue('generated plan');
    testLocalProvider.mockReset().mockResolvedValue({ ok: true, version: 'ok', authenticated: true });
    importOpenApiWithAi.mockReset().mockImplementation(async ({ generate, signal }) => ({
      collection: await generate('prompt from engine', signal),
      summary: [],
      warnings: [],
      sourceUrl: 'https://example.test/openapi.json'
    }));
    _private.senderJobs.clear();
    register();
  });

  afterEach(() => {
    _private.senderJobs.clear();
  });

  it('registers the local AI IPC channels', () => {
    expect([...handlers.keys()]).toEqual([
      'renderer:ai-local-status',
      'renderer:ai-local-test',
      'renderer:ai-import-openapi',
      'renderer:ai-import-cancel'
    ]);
  });

  it('reports saved local provider configuration only', async () => {
    await expect(invoke('renderer:ai-local-status', {})).resolves.toEqual({
      providers: [
        { id: 'codex', label: 'Codex', enabled: true, executable: '/bin/codex', model: 'gpt-local' },
        { id: 'claude', label: 'Claude Code', enabled: true, executable: '/bin/claude', model: 'sonnet-local' }
      ],
      preferredProvider: 'codex'
    });
  });

  it('tests the saved provider config and ignores renderer-supplied executable data', async () => {
    await expect(invoke('renderer:ai-local-test', {}, {
      providerId: 'claude',
      executable: '/tmp/attacker',
      model: 'attacker'
    })).resolves.toEqual({ ok: true, version: 'ok', authenticated: true });

    expect(testLocalProvider).toHaveBeenCalledWith({
      providerId: 'claude',
      config: { enabled: true, executable: '/bin/claude', model: 'sonnet-local' }
    });
  });

  it('returns sanitized connection test errors for disabled AI or provider state', async () => {
    getPreferences.mockReturnValue(preferences({ codex: { enabled: false, executable: '/bin/codex', model: '' } }));
    await expect(invoke('renderer:ai-local-test', {}, { providerId: 'codex' })).resolves.toEqual({
      ok: false,
      error: 'Codex local AI is disabled. Enable it in Preferences > AI.'
    });

    getPreferences.mockReturnValue({ ai: { enabled: false, localProviders: preferences().ai.localProviders } });
    await expect(invoke('renderer:ai-local-test', {}, { providerId: 'codex' })).resolves.toEqual({
      ok: false,
      error: 'AI features are disabled. Enable them in Preferences > AI.'
    });
  });

  it('imports through the engine with generateLocalText using saved preferences', async () => {
    const event = { sender: sender(7) };

    await expect(invoke('renderer:ai-import-openapi', event, {
      url: ' https://example.test/openapi.json ',
      providerId: 'claude',
      requestId: 'request-1'
    })).resolves.toEqual({
      collection: 'generated plan',
      summary: [],
      warnings: [],
      sourceUrl: 'https://example.test/openapi.json'
    });

    expect(importOpenApiWithAi).toHaveBeenCalledWith({
      url: 'https://example.test/openapi.json',
      signal: expect.any(AbortSignal),
      generate: expect.any(Function)
    });
    expect(generateLocalText).toHaveBeenCalledWith({
      providerId: 'claude',
      config: { enabled: true, executable: '/bin/claude', model: 'sonnet-local' },
      prompt: 'prompt from engine',
      signal: expect.any(AbortSignal)
    });
    expect(_private.senderJobs.size).toBe(0);
  });

  it('scopes cancellation by sender id and requestId', async () => {
    let capturedSignal;
    importOpenApiWithAi.mockImplementationOnce(({ signal }) => {
      capturedSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({
          collection: 'cancelled',
          summary: [],
          warnings: [],
          sourceUrl: 'x'
        }));
      });
    });

    const eventA = { sender: sender(10) };
    const eventB = { sender: sender(11) };
    const pending = invoke('renderer:ai-import-openapi', eventA, { url: 'https://example.test/a.json', requestId: 'shared' });

    await expect(invoke('renderer:ai-import-cancel', eventB, { requestId: 'shared' })).resolves.toEqual({
      ok: true,
      cancelled: false
    });
    expect(capturedSignal.aborted).toBe(false);

    await expect(invoke('renderer:ai-import-cancel', eventA, { requestId: 'shared' })).resolves.toEqual({
      ok: true,
      cancelled: true
    });
    expect(capturedSignal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({
      collection: 'cancelled',
      summary: [],
      warnings: [],
      sourceUrl: 'x'
    });
  });

  it('cancels sender jobs when the sender is destroyed', async () => {
    let destroyHandler;
    let capturedSignal;
    const event = {
      sender: {
        id: 12,
        once: jest.fn((_name, handler) => {
          destroyHandler = handler;
        })
      }
    };
    importOpenApiWithAi.mockImplementationOnce(({ signal }) => {
      capturedSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({
          collection: 'destroyed',
          summary: [],
          warnings: [],
          sourceUrl: 'x'
        }));
      });
    });

    const pending = invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/a.json', requestId: 'request-2' });
    expect(event.sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));

    destroyHandler();

    expect(capturedSignal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({
      collection: 'destroyed',
      summary: [],
      warnings: [],
      sourceUrl: 'x'
    });
  });

  it('enforces duplicate request and per-sender concurrency limits', async () => {
    importOpenApiWithAi.mockImplementation(() => new Promise(() => {}));
    const event = { sender: sender(13) };

    invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/1.json', requestId: 'one' });
    await expect(invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/2.json', requestId: 'one' }))
      .rejects.toThrow('already running');

    invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/2.json', requestId: 'two' });
    invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/3.json', requestId: 'three' });
    await expect(invoke('renderer:ai-import-openapi', event, { url: 'https://example.test/4.json', requestId: 'four' }))
      .rejects.toThrow('Too many local AI import jobs');

    _private.cancelSenderJobs(13);
  });

  it('throws sanitized import errors', async () => {
    importOpenApiWithAi.mockRejectedValueOnce(new Error('bad     thing\nsecret details that should be compacted'));

    await expect(invoke('renderer:ai-import-openapi', { sender: sender(14) }, {
      url: 'https://example.test/openapi.json',
      requestId: 'request-3'
    })).rejects.toThrow('bad thing\nsecret details that should be compacted');
  });
});
