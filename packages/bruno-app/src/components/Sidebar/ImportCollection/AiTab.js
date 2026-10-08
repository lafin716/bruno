import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import Button from 'ui/Button';
import useAiImport from './useAiImport';

const PROVIDERS = [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude Code' }];

const AiTab = ({ handleSubmit, setErrorMessage }) => {
  const ai = useSelector((state) => state.app.preferences.ai || {});
  const local = ai.localProviders || {};
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState(local.preferredProvider || 'codex');
  const providers = PROVIDERS.filter((provider) => local[provider.id]?.enabled);
  const providerId = providers.some((provider) => provider.id === selected) ? selected : providers[0]?.id;
  const { busy, result, generate, cancel, reset } = useAiImport(setErrorMessage);
  const available = ai.enabled && providers.length > 0;

  const onGenerate = (event) => {
    event.preventDefault();
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch (_) {
      setErrorMessage('Enter an HTTP or HTTPS Swagger/OpenAPI link without credentials.');
      return;
    }
    if (available) generate(url.trim(), providerId);
  };

  return (
    <div className="ai-import flex flex-col gap-4 text-xs" data-testid="ai-import-panel">
      <div>
        <p className="font-semibold mb-1">Build a collection from a Swagger link</p>
        <p className="ai-import-muted">
          AI organizes folders, configures URL and auth variables, and prepares token capture after login.
          Uses your local CLI subscription to analyze the API structure through its AI service.
        </p>
      </div>
      {!available && (
        <p role="status" data-testid="ai-import-setup">
          Enable AI and a local Codex or Claude Code connection in Preferences → AI → Local CLI.
        </p>
      )}
      <form onSubmit={onGenerate} className="flex flex-col gap-3">
        <label htmlFor="ai-import-url">Swagger / OpenAPI link</label>
        <input
          id="ai-import-url"
          data-testid="ai-import-url"
          type="url"
          required
          value={url}
          disabled={busy}
          onChange={(event) => {
            setUrl(event.target.value); reset();
          }}
          placeholder="https://api.example.com/swagger-ui/"
          className="textbox w-full px-3 py-2"
        />
        <label htmlFor="ai-import-provider">Local AI connection</label>
        <select
          id="ai-import-provider"
          data-testid="ai-import-provider"
          value={providerId || ''}
          disabled={busy || !available}
          onChange={(event) => {
            setSelected(event.target.value); reset();
          }}
          className="textbox w-full px-3 py-2"
        >
          {providers.length === 0 && <option value="">No local connection enabled</option>}
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
        <div className="flex flex-wrap gap-2 items-center">
          <Button type="submit" disabled={!available || !url.trim() || busy} data-testid="ai-import-generate">
            Generate collection
          </Button>
          {busy && (
            <>
              <Button variant="ghost" color="secondary" onClick={cancel} data-testid="ai-import-cancel">Cancel</Button>
              <span role="status" className="ai-import-muted">Reading the specification and organizing APIs…</span>
            </>
          )}
        </div>
      </form>
      {result && (
        <div className="ai-import-preview p-3 flex flex-col gap-3" data-testid="ai-import-preview">
          <p className="font-semibold">{result.collection.name}</p>
          <ul className="list-disc pl-4">
            {(result.summary || []).map((entry, index) => <li key={index}>{entry}</li>)}
          </ul>
          {result.warnings?.length > 0 && (
            <div role="status">
              <p className="font-semibold">Review before sending requests</p>
              <ul className="list-disc pl-4">
                {result.warnings.map((entry, index) => <li key={index}>{entry}</li>)}
              </ul>
            </div>
          )}
          <p className="ai-import-muted">Choose a location next. Select an environment, fill credentials, then run the login request to capture its token.</p>
          <Button data-testid="ai-import-continue" onClick={() => handleSubmit({ type: 'bruno', rawData: result.collection })}>
            Choose location
          </Button>
        </div>
      )}
    </div>
  );
};

export default AiTab;
