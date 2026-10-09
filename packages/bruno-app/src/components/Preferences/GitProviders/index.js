import React, { useEffect, useState } from 'react';
import Button from 'ui/Button';
import { SettingsGroup, SettingsField } from '../SettingsLayout';
import StyledWrapper from './StyledWrapper';

const emptySettings = { baseUrl: '', configured: false };

const getErrorMessage = (error, fallback) => error?.message || fallback;

const GitProviders = () => {
  const [settings, setSettings] = useState(emptySettings);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState({ type: 'muted', message: '' });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    window.ipcRenderer.invoke('renderer:get-gitlab-settings')
      .then((nextSettings) => {
        if (!mounted) {
          return;
        }
        const safeSettings = nextSettings || emptySettings;
        setSettings(safeSettings);
        setBaseUrl(safeSettings.baseUrl || '');
        setToken('');
      })
      .catch((error) => {
        if (mounted) {
          setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to load GitLab settings') });
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const validateBaseUrl = () => {
    if (!baseUrl.trim()) {
      setFeedback({ type: 'error', message: 'GitLab URL is required' });
      return false;
    }
    return true;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!validateBaseUrl()) {
      return;
    }

    setSaving(true);
    setFeedback({ type: 'muted', message: '' });
    try {
      const payload = { baseUrl: baseUrl.trim() };
      if (token.trim()) {
        payload.token = token.trim();
      }
      const nextSettings = await window.ipcRenderer.invoke('renderer:save-gitlab-settings', payload);
      const safeSettings = nextSettings || { baseUrl: baseUrl.trim(), configured: !!token.trim() || settings.configured };
      setSettings(safeSettings);
      setBaseUrl(safeSettings.baseUrl || baseUrl.trim());
      setToken('');
      setFeedback({ type: 'success', message: 'GitLab settings saved' });
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to save GitLab settings') });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!validateBaseUrl()) {
      return;
    }

    setTesting(true);
    setFeedback({ type: 'muted', message: '' });
    try {
      const payload = { baseUrl: baseUrl.trim() };
      if (token.trim()) {
        payload.token = token.trim();
      }
      const result = await window.ipcRenderer.invoke('renderer:test-gitlab-connection', payload);
      setFeedback({ type: 'success', message: `Connected${result?.username ? ` as ${result.username}` : ''}` });
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to connect to GitLab') });
    } finally {
      setTesting(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setFeedback({ type: 'muted', message: '' });
    try {
      const nextSettings = await window.ipcRenderer.invoke('renderer:clear-gitlab-settings');
      const safeSettings = nextSettings || emptySettings;
      setSettings(safeSettings);
      setBaseUrl(safeSettings.baseUrl || '');
      setToken('');
      setFeedback({ type: 'success', message: 'GitLab settings cleared' });
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to clear GitLab settings') });
    } finally {
      setClearing(false);
    }
  };

  const isBusy = loading || saving || testing || clearing;

  return (
    <StyledWrapper className="w-full">
      <div className="section-header">Git Providers</div>
      <form className="bruno-form settings-form" onSubmit={handleSave}>
        <SettingsGroup
          title="GitLab"
          description="Configure a GitLab server for private project discovery and authenticated HTTPS imports."
        >
          <SettingsField label="GitLab URL" htmlFor="gitlabBaseUrl">
            <input
              id="gitlabBaseUrl"
              data-testid="gitlab-base-url-input"
              type="url"
              className="textbox w-full"
              autoComplete="off"
              value={baseUrl}
              disabled={loading}
              placeholder="https://gitlab.example.com"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </SettingsField>
          <SettingsField
            label={settings.configured ? 'Replace Personal Access Token' : 'Personal Access Token'}
            htmlFor="gitlabToken"
            hint={settings.configured ? 'A token is saved. Leave this blank to keep it when saving the same server.' : undefined}
          >
            <input
              id="gitlabToken"
              data-testid="gitlab-token-input"
              type="password"
              className="textbox w-full"
              autoComplete="new-password"
              value={token}
              disabled={loading}
              placeholder={settings.configured ? 'Saved token is hidden' : 'Paste a GitLab token'}
              onChange={(event) => setToken(event.target.value)}
            />
          </SettingsField>
          <div className="settings-actions">
            <Button type="submit" size="sm" variant="filled" color="primary" loading={saving} disabled={isBusy}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" color="secondary" loading={testing} disabled={isBusy} onClick={handleTest}>
              Test
            </Button>
            <Button type="button" size="sm" variant="outline" color="secondary" loading={clearing} disabled={isBusy} onClick={handleClear}>
              Clear
            </Button>
            {loading ? <span className="settings-inline-status">Loading...</span> : null}
          </div>
          {feedback.message ? (
            <div className={`settings-status ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
              {feedback.message}
            </div>
          ) : null}
          <div className="settings-help">
            The token is encrypted by the desktop app and is never displayed after saving.
          </div>
        </SettingsGroup>
      </form>
    </StyledWrapper>
  );
};

export default GitProviders;
