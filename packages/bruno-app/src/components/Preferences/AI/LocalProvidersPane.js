import { useState } from 'react';
import {
  IconAlertCircle,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconTerminal2
} from '@tabler/icons';
import ToggleSwitch from 'components/ToggleSwitch';
import { callIpc } from 'utils/common/ipc';

const PROVIDERS = [
  {
    id: 'codex',
    label: 'Codex',
    defaultExecutable: 'codex',
    loginCommand: 'codex login'
  },
  {
    id: 'claude',
    label: 'Claude Code',
    defaultExecutable: 'claude',
    loginCommand: 'claude login'
  }
];

const normalizeProvider = (providerId, raw) => ({
  enabled: raw?.enabled === true,
  executable: raw?.executable || PROVIDERS.find((p) => p.id === providerId)?.defaultExecutable || providerId,
  model: raw?.model || ''
});

const LocalProvidersPane = ({
  aiEnabled,
  localProviders,
  dirty,
  onChange,
  onSaveBeforeTest
}) => {
  const [testingProvider, setTestingProvider] = useState(null);
  const [feedback, setFeedback] = useState({});

  const providers = {
    preferredProvider: localProviders?.preferredProvider || 'codex',
    codex: normalizeProvider('codex', localProviders?.codex),
    claude: normalizeProvider('claude', localProviders?.claude)
  };

  const updateLocalProviders = (next, providerId) => {
    if (providerId) {
      setFeedback((current) => ({ ...current, [providerId]: null }));
    } else {
      setFeedback({});
    }
    onChange(next);
  };

  const updateProvider = (providerId, patch) => {
    updateLocalProviders(
      {
        ...providers,
        [providerId]: {
          ...providers[providerId],
          ...patch
        }
      },
      providerId
    );
  };

  const handleTest = async (providerId) => {
    setTestingProvider(providerId);
    setFeedback((current) => ({ ...current, [providerId]: null }));
    try {
      await onSaveBeforeTest();
      const result = await callIpc('renderer:ai-local-test', { providerId });
      if (result?.ok) {
        const details = [
          result.version ? `Version ${result.version}` : null,
          result.authenticated === true ? 'Authenticated' : null,
          result.authenticated === false ? 'Login required' : null
        ].filter(Boolean);
        setFeedback((current) => ({
          ...current,
          [providerId]: {
            type: result.authenticated === false ? 'error' : 'success',
            message: details.length ? details.join(' · ') : 'Connection successful'
          }
        }));
      } else {
        setFeedback((current) => ({
          ...current,
          [providerId]: {
            type: 'error',
            message: result?.error || 'Connection failed'
          }
        }));
      }
    } catch (err) {
      setFeedback((current) => ({
        ...current,
        [providerId]: {
          type: 'error',
          message: err.message || 'Connection failed'
        }
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  if (!aiEnabled) {
    return (
      <div className="local-tab flex flex-col gap-3">
        <div className="ai-empty-notice px-3.5 py-3 text-xs">
          Turn on AI in the Configuration tab to configure local CLI providers.
        </div>
      </div>
    );
  }

  return (
    <div className="local-tab flex flex-col gap-3">
      <div className="local-card">
        <div className="local-row flex items-center justify-between gap-3 px-3.5 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold">Default import provider</span>
            <span className="local-sub text-[11px]">
              Used by AI-assisted collection import when no provider is chosen in the import dialog.
            </span>
          </div>
          <div className="model-select-wrap relative inline-flex items-center">
            <select
              className="model-select"
              value={providers.preferredProvider}
              onChange={(e) => updateLocalProviders({ ...providers, preferredProvider: e.target.value })}
              aria-label="Default local import provider"
              data-testid="ai-local-preferred-provider"
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
            <IconChevronDown size={12} strokeWidth={1.75} className="model-select-chevron" />
          </div>
        </div>
      </div>

      {dirty && (
        <div className="local-unsaved px-3.5 py-2 text-[11px]" data-testid="ai-local-unsaved">
          Unsaved local provider changes will be saved before testing a connection.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {PROVIDERS.map((provider) => {
          const config = providers[provider.id];
          const result = feedback[provider.id];
          const isTesting = testingProvider === provider.id;
          const canTest = config.enabled && config.executable.trim();

          return (
            <div
              key={provider.id}
              className={`local-provider provider-row ${config.enabled ? 'expanded' : ''}`}
              data-testid={`ai-local-provider-${provider.id}`}
            >
              <div className="local-provider-header provider-header flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <IconTerminal2 size={16} strokeWidth={1.5} className="provider-logo flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-[12.5px] truncate">{provider.label}</span>
                    <span className="provider-status text-[10.5px] truncate">
                      {config.enabled ? config.executable : 'Disabled'}
                    </span>
                  </div>
                </div>
                <ToggleSwitch
                  size="xs"
                  isOn={config.enabled}
                  handleToggle={() => updateProvider(provider.id, { enabled: !config.enabled })}
                  data-testid={`ai-local-${provider.id}-enabled`}
                />
              </div>

              <div className="provider-body">
                <div className="flex flex-col gap-3.5 px-3 pt-3 pb-3">
                  <div className="grid grid-cols-2 gap-2 local-provider-grid">
                    <div className="flex flex-col gap-1">
                      <label className="key-section-label text-[11px]" htmlFor={`local-executable-${provider.id}`}>
                        Executable
                      </label>
                      <input
                        id={`local-executable-${provider.id}`}
                        type="text"
                        className="key-input w-full h-8 box-border text-xs leading-none pl-2.5 pr-2"
                        value={config.executable}
                        placeholder={provider.defaultExecutable}
                        disabled={!config.enabled || isTesting}
                        onChange={(e) => updateProvider(provider.id, { executable: e.target.value })}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        data-testid={`ai-local-${provider.id}-executable`}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="key-section-label text-[11px]" htmlFor={`local-model-${provider.id}`}>
                        Model override
                      </label>
                      <input
                        id={`local-model-${provider.id}`}
                        type="text"
                        className="key-input w-full h-8 box-border text-xs leading-none pl-2.5 pr-2"
                        value={config.model}
                        placeholder="Use CLI default"
                        disabled={!config.enabled || isTesting}
                        onChange={(e) => updateProvider(provider.id, { model: e.target.value })}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        data-testid={`ai-local-${provider.id}-model`}
                      />
                    </div>
                  </div>

                  <div className="local-guidance flex items-center justify-between gap-3">
                    <span className="local-sub text-[11px]">
                      Login is managed by the CLI. Run <code>{provider.loginCommand}</code> in a terminal if the check reports that login is required.
                    </span>
                    <button
                      type="button"
                      className="btn-primary h-8 box-border px-3 text-xs font-medium inline-flex items-center justify-center gap-1 cursor-pointer"
                      disabled={!canTest || isTesting}
                      onClick={() => handleTest(provider.id)}
                      data-testid={`ai-local-${provider.id}-test`}
                    >
                      {isTesting ? <IconLoader2 size={14} className="spin" /> : <IconBolt size={14} />}
                      Check connection
                    </button>
                  </div>

                  {result && (
                    <div
                      className={`feedback ${result.type} flex items-center gap-1.5 px-2.5 py-2 text-[11px]`}
                      role={result.type === 'error' ? 'alert' : 'status'}
                      data-testid={`ai-local-${provider.id}-feedback`}
                    >
                      {result.type === 'success'
                        ? <IconCheck size={13} strokeWidth={1.8} />
                        : <IconAlertCircle size={13} strokeWidth={1.8} />}
                      <span>{result.message}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LocalProvidersPane;
