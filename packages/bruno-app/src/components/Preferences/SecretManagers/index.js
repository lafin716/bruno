import React, { useEffect, useState } from 'react';
import Button from 'ui/Button';
import { SettingsGroup, SettingsField, CheckboxSetting } from '../SettingsLayout';
import StyledWrapper from './StyledWrapper';

const emptySettings = { enabled: false, region: '', profile: '' };

const getErrorMessage = (error, fallback) => error?.message || fallback;

const SecretManagers = () => {
  const [settings, setSettings] = useState(emptySettings);
  const [form, setForm] = useState(emptySettings);
  const [testSecretId, setTestSecretId] = useState('');
  const [testJsonKey, setTestJsonKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState({ type: 'success', message: '' });
  const [testFeedback, setTestFeedback] = useState({ type: 'success', message: '' });

  useEffect(() => {
    let mounted = true;
    window.ipcRenderer.invoke('renderer:get-aws-secrets-settings')
      .then((nextSettings) => {
        if (!mounted) {
          return;
        }
        const safeSettings = { ...emptySettings, ...(nextSettings || {}) };
        setSettings(safeSettings);
        setForm(safeSettings);
      })
      .catch((error) => {
        if (mounted) {
          setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to load AWS Secrets Manager settings') });
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

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback({ type: 'success', message: '' });
    try {
      const payload = {
        enabled: !!form.enabled,
        region: form.region.trim(),
        profile: form.profile.trim()
      };
      const nextSettings = await window.ipcRenderer.invoke('renderer:save-aws-secrets-settings', payload);
      const safeSettings = { ...emptySettings, ...(nextSettings || payload) };
      setSettings(safeSettings);
      setForm(safeSettings);
      setFeedback({ type: 'success', message: 'AWS Secrets Manager settings saved' });
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to save AWS Secrets Manager settings') });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testSecretId.trim()) {
      setTestFeedback({ type: 'error', message: 'Secret ID is required' });
      return;
    }

    setTesting(true);
    setTestFeedback({ type: 'success', message: '' });
    try {
      await window.ipcRenderer.invoke('renderer:test-aws-secret', {
        secretId: testSecretId.trim(),
        jsonKey: testJsonKey.trim(),
        region: form.region.trim() || settings.region,
        profile: form.profile.trim() || settings.profile
      });
      setTestFeedback({ type: 'success', message: 'Secret fetched successfully' });
    } catch (error) {
      setTestFeedback({ type: 'error', message: getErrorMessage(error, 'Failed to fetch secret') });
    } finally {
      setTesting(false);
    }
  };

  const isBusy = loading || saving || testing;

  return (
    <StyledWrapper className="w-full">
      <div className="section-header">Secret Managers</div>
      <form className="bruno-form settings-form" onSubmit={handleSave}>
        <SettingsGroup
          title="AWS Secrets Manager"
          description="Use the local AWS provider chain, including SSO, environment credentials and named profiles."
        >
          <CheckboxSetting
            id="awsSecretsEnabled"
            name="enabled"
            label="Enable AWS Secrets Manager"
            checked={form.enabled}
            disabled={loading}
            onChange={updateField('enabled')}
          />
          <div className="settings-row">
            <SettingsField label="Default Region" htmlFor="awsSecretsRegion">
              <input
                id="awsSecretsRegion"
                data-testid="aws-secrets-region-input"
                type="text"
                className="textbox w-full"
                autoComplete="off"
                value={form.region}
                disabled={loading}
                placeholder="ap-northeast-2"
                onChange={updateField('region')}
              />
            </SettingsField>
            <SettingsField label="Default Profile" htmlFor="awsSecretsProfile">
              <input
                id="awsSecretsProfile"
                data-testid="aws-secrets-profile-input"
                type="text"
                className="textbox w-full"
                autoComplete="off"
                value={form.profile}
                disabled={loading}
                placeholder="default"
                onChange={updateField('profile')}
              />
            </SettingsField>
          </div>
          <div className="settings-actions">
            <Button type="submit" size="sm" variant="filled" color="primary" loading={saving} disabled={isBusy}>
              Save
            </Button>
          </div>
          {feedback.message ? (
            <div className={`settings-status ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
              {feedback.message}
            </div>
          ) : null}
          <div className="settings-help">
            Static AWS access keys are not stored here.
          </div>
        </SettingsGroup>

        <SettingsGroup
          title="Test Secret Access"
          description="Fetch a secret using the current defaults or AWS profile configuration. Secret values are not shown."
        >
          <SettingsField label="Secret ID or ARN" htmlFor="awsTestSecretId">
            <input
              id="awsTestSecretId"
              data-testid="aws-test-secret-id-input"
              type="text"
              className="textbox w-full"
              autoComplete="off"
              value={testSecretId}
              placeholder="dev/api"
              onChange={(event) => setTestSecretId(event.target.value)}
            />
          </SettingsField>
          <SettingsField label="JSON Key" htmlFor="awsTestJsonKey" hint="Optional top-level JSON field. Leave blank to test the whole secret.">
            <input
              id="awsTestJsonKey"
              data-testid="aws-test-json-key-input"
              type="text"
              className="textbox w-full"
              autoComplete="off"
              value={testJsonKey}
              placeholder="token"
              onChange={(event) => setTestJsonKey(event.target.value)}
            />
          </SettingsField>
          <div className="settings-actions">
            <Button type="button" size="sm" variant="outline" color="secondary" loading={testing} disabled={isBusy} onClick={handleTest}>
              Test Secret
            </Button>
          </div>
          {testFeedback.message ? (
            <div className={`settings-status ${testFeedback.type}`} role={testFeedback.type === 'error' ? 'alert' : 'status'}>
              {testFeedback.message}
            </div>
          ) : null}
        </SettingsGroup>
      </form>
    </StyledWrapper>
  );
};

export default SecretManagers;
