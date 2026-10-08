import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';

global.React = React;

const mockSavePreferences = jest.fn((payload) => () => Promise.resolve(payload));

jest.mock('providers/ReduxStore/slices/app', () => ({
  savePreferences: (payload) => mockSavePreferences(payload)
}));

jest.mock('utils/ai', () => ({
  clearAiApiKey: jest.fn().mockResolvedValue({ providers: {}, models: [] }),
  getAiStatus: jest.fn().mockResolvedValue({ providers: {}, models: [] })
}));

jest.mock('utils/common/ipc', () => ({
  callIpc: jest.fn()
}));

import { callIpc } from 'utils/common/ipc';
import AI from './index';

const makeThemeProxy = () =>
  new Proxy({}, {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '#000000';
      if (typeof prop === 'symbol') return undefined;
      return makeThemeProxy();
    }
  });

const theme = makeThemeProxy();

const localProviders = {
  preferredProvider: 'claude',
  codex: {
    enabled: true,
    executable: '/usr/local/bin/codex',
    model: 'gpt-5.5'
  },
  claude: {
    enabled: false,
    executable: '/opt/claude',
    model: 'opus'
  }
};

const renderAI = (preferences = {}) => {
  const aiPreferences = preferences.ai || {};
  const appSlice = createSlice({
    name: 'app',
    initialState: {
      preferences: {
        ...preferences,
        ai: {
          enabled: true,
          providers: {},
          models: {},
          defaultModel: '',
          openaiCompatibleEndpoints: [],
          autocomplete: {
            enabled: true,
            model: '',
            triggerMode: 'debounced'
          },
          security: {
            redactHeaders: true,
            redactBody: true,
            redactVariables: true,
            redactResponse: true,
            customRedactedHeaders: [],
            customRedactedVariables: []
          },
          ...aiPreferences
        }
      }
    },
    reducers: {}
  });

  const store = configureStore({
    reducer: {
      app: appSlice.reducer
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false
    })
  });

  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <AI />
      </ThemeProvider>
    </Provider>
  );
};

const clickToggle = (testId) => {
  const input = screen.getByTestId(testId).querySelector('input');
  fireEvent.input(input, { target: { checked: !input.checked } });
};

describe('AI preferences local providers', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockSavePreferences.mockClear();
    callIpc.mockReset();
  });

  it('preserves local provider settings when saving another AI pane', async () => {
    jest.useFakeTimers();
    renderAI({ ai: { localProviders } });

    fireEvent.click(screen.getByTestId('ai-tab-autocomplete'));
    clickToggle('ai-autocomplete-enabled-toggle');

    await act(async () => {
      jest.advanceTimersByTime(450);
    });

    await waitFor(() => expect(mockSavePreferences).toHaveBeenCalled());
    expect(mockSavePreferences.mock.calls[0][0].ai.localProviders).toEqual(localProviders);
  });

  it('saves current local config before testing the provider connection', async () => {
    callIpc.mockResolvedValue({ ok: true, version: '1.2.3', authenticated: true });
    renderAI();

    fireEvent.click(screen.getByTestId('ai-tab-local'));
    clickToggle('ai-local-codex-enabled');
    fireEvent.change(screen.getByTestId('ai-local-codex-executable'), {
      target: { value: '/opt/bin/codex' }
    });
    fireEvent.change(screen.getByTestId('ai-local-codex-model'), {
      target: { value: 'gpt-5.5' }
    });
    fireEvent.click(screen.getByTestId('ai-local-codex-test'));

    await waitFor(() => expect(callIpc).toHaveBeenCalledWith('renderer:ai-local-test', { providerId: 'codex' }));
    const saved = mockSavePreferences.mock.calls[0][0].ai.localProviders;
    expect(saved.codex).toEqual({
      enabled: true,
      executable: '/opt/bin/codex',
      model: 'gpt-5.5'
    });
    expect(screen.getByTestId('ai-local-codex-feedback')).toHaveTextContent('Version 1.2.3');
  });

  it('clears connection errors and disables testing when a local provider is turned off', async () => {
    callIpc.mockResolvedValue({ ok: false, error: 'Login required' });
    renderAI({ ai: { localProviders } });

    fireEvent.click(screen.getByTestId('ai-tab-local'));
    fireEvent.click(screen.getByTestId('ai-local-codex-test'));

    await waitFor(() => expect(screen.getByTestId('ai-local-codex-feedback')).toHaveTextContent('Login required'));

    clickToggle('ai-local-codex-enabled');

    expect(screen.queryByTestId('ai-local-codex-feedback')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-local-codex-test')).toBeDisabled();
  });
});
