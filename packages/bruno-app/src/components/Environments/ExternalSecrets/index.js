import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { saveExternalSecrets } from 'providers/ReduxStore/slices/collections/actions';
import { setExternalSecretsDraft, clearExternalSecretsDraft } from 'providers/ReduxStore/slices/collections';
import Button from 'ui/Button';
import StyledWrapper from './StyledWrapper';

const TYPE = 'aws-secrets-manager';
const FIELDS = [
  ['secretId', 'Secret ID or ARN', 'dev/api'],
  ['jsonKey', 'JSON field (optional)', 'token'],
  ['region', 'Region override (optional)', 'ap-northeast-2'],
  ['profile', 'Profile override (optional)', 'dev']
];

export const referenceError = (externalSecrets) => {
  if (!externalSecrets?.variables?.length) return null;
  if (externalSecrets.type !== TYPE) return 'This editor supports AWS Secrets Manager references.';
  if (externalSecrets.variables.length > 50) return 'Use at most 50 secret references per environment.';
  const names = new Set();
  for (const variable of externalSecrets.variables) {
    if (!variable.name || !/^[\w.-]+$/.test(variable.name)
      || ['__proto__', 'constructor', 'prototype', '__name__'].includes(variable.name)) {
      return 'Variable names must use letters, numbers, underscores, dots or hyphens and cannot be reserved names.';
    }
    if (names.has(variable.name)) return 'Each external secret must have a unique variable name.';
    names.add(variable.name);
    let reference;
    try { reference = JSON.parse(variable.value); } catch { return 'A secret reference contains invalid JSON. Fix the environment file before editing.'; }
    if (!reference || typeof reference.secretId !== 'string' || !reference.secretId.trim()) return 'Enter a Secret ID or ARN for every variable.';
  }
  return null;
};

const ExternalSecrets = ({ environment, collection }) => {
  const dispatch = useDispatch();
  const hasDraft = Object.hasOwn(collection?.externalSecretsDrafts || {}, environment.uid);
  const current = hasDraft ? collection.externalSecretsDrafts[environment.uid] : environment.externalSecrets;
  const externalSecrets = current || { type: TYPE, variables: [] };
  const unsupported = externalSecrets.type !== TYPE;
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const setDraft = (variables) => {
    setFeedback(null);
    dispatch(setExternalSecretsDraft({ collectionUid: collection.uid, environmentUid: environment.uid,
      externalSecrets: { type: TYPE, variables } }));
  };
  const changeReference = (index, field, value) => {
    const variables = externalSecrets.variables.map((variable, i) => {
      if (i !== index) return variable;
      if (field === 'name') return { ...variable, name: value };
      let reference;
      try { reference = JSON.parse(variable.value); } catch { return variable; }
      return { ...variable, value: JSON.stringify({ ...reference, [field]: value }) };
    });
    setDraft(variables);
  };
  const save = async () => {
    const error = referenceError(externalSecrets);
    if (error) {
      setFeedback({ error }); return;
    }
    setSaving(true);
    try {
      await dispatch(saveExternalSecrets(externalSecrets, environment.uid, collection.uid));
      if (alive.current) setFeedback({ message: 'Secret references saved. Values are fetched when you run requests.' });
    } catch (err) {
      if (alive.current) setFeedback({ error: err.message || 'Failed to save secret references' });
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const test = async (variable, index) => {
    const error = referenceError({ type: TYPE, variables: [variable] });
    if (error) {
      setFeedback({ error }); return;
    }
    setTesting(index);
    setFeedback(null);
    try {
      await window.ipcRenderer.invoke('renderer:test-aws-secret', JSON.parse(variable.value));
      if (alive.current) setFeedback({ message: 'Secret is accessible. Its value is kept private.' });
    } catch (err) {
      if (alive.current) setFeedback({ error: err.message || 'Failed to access the secret' });
    } finally {
      if (alive.current) setTesting(null);
    }
  };

  return (
    <StyledWrapper data-testid="external-secrets-editor">
      <h3 className="font-medium mb-2">AWS Secrets Manager</h3>
      <p className="description">Enable AWS in Preferences → Secret Managers. Only references are saved here. Use {'{{VARIABLE_NAME}}'} in requests; credentials come from your AWS profile or environment.</p>
      {unsupported && <p role="alert">This environment uses another secret provider. Its references are preserved.</p>}
      {!unsupported && externalSecrets.variables.map((variable, index) => {
        let reference = {};
        try { reference = JSON.parse(variable.value) || {}; } catch { /* Show a validation error without overwriting the reference. */ }
        return (
          <div className="reference-row" key={index} data-testid="external-secret-row">
            <div className="reference-fields">
              <label>Variable name<input aria-label={`Variable name ${index + 1}`} value={variable.name || ''} onChange={(e) => changeReference(index, 'name', e.target.value)} placeholder="API_TOKEN" disabled={saving} /></label>
              {FIELDS.map(([field, label, placeholder]) => <label key={field}>{label}<input aria-label={`${label} ${index + 1}`} value={reference[field] || ''} onChange={(e) => changeReference(index, field, e.target.value)} placeholder={placeholder} disabled={saving} /></label>)}
            </div>
            <div className="actions">
              <Button size="sm" variant="outline" onClick={() => test(variable, index)} disabled={saving || testing !== null} loading={testing === index}>Test access</Button>
              <Button size="sm" variant="outline" color="danger" onClick={() => setDraft(externalSecrets.variables.filter((_, i) => i !== index))} disabled={saving}>Remove reference</Button>
            </div>
          </div>
        );
      })}
      {!unsupported && !externalSecrets.variables.length && <p className="description">No external secret references. Add a mapping to load a secret when this environment runs.</p>}
      {feedback && <p className="feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.error || feedback.message}</p>}
      {!unsupported && (
        <div className="actions">
          <Button variant="outline" size="sm" disabled={saving || externalSecrets.variables.length >= 50} onClick={() => setDraft([...externalSecrets.variables, { name: '', value: JSON.stringify({ secretId: '' }) }])}>Add reference</Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!hasDraft}>Save references</Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving || !hasDraft}
            onClick={() => {
              dispatch(clearExternalSecretsDraft({ collectionUid: collection.uid, environmentUid: environment.uid })); setFeedback(null);
            }}
          >Discard changes
          </Button>
          {hasDraft && <span className="description">Unsaved references</span>}
        </div>
      )}
    </StyledWrapper>
  );
};

export default ExternalSecrets;
