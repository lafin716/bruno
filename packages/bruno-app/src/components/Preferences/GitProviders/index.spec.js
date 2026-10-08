import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'styled-components';
import GitProviders from './index';

jest.mock('ui/Button', () => ({
  __esModule: true,
  default: ({ children, loading, ...props }) => (
    <button {...props}>{loading ? 'Loading' : children}</button>
  )
}));

const theme = {
  border: { radius: { sm: '4px' } },
  input: { bg: '#fff', border: '#ccc', focusBorder: '#888' },
  text: '#111',
  font: { size: { sm: '12px' } },
  colors: { text: { muted: '#666' } },
  status: {
    success: { text: '#047857' },
    danger: { text: '#b91c1c' }
  }
};

const renderPanel = () => render(
  <ThemeProvider theme={theme}>
    <GitProviders />
  </ThemeProvider>
);

beforeEach(() => {
  window.ipcRenderer = { invoke: jest.fn() };
});

describe('GitProviders preferences', () => {
  it('saves GitLab settings without redisplaying the PAT', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: 'https://gitlab.example.com', configured: true });
      }
      if (channel === 'renderer:save-gitlab-settings') {
        return Promise.resolve({ baseUrl: payload.baseUrl, configured: true });
      }
      return Promise.resolve();
    });

    renderPanel();

    const tokenInput = await screen.findByTestId('gitlab-token-input');
    expect(tokenInput).toHaveValue('');

    await screen.findByDisplayValue('https://gitlab.example.com');
    await userEvent.type(tokenInput, 'glpat-secret-token');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:save-gitlab-settings',
      { baseUrl: 'https://gitlab.example.com', token: 'glpat-secret-token' }
    ));
    await waitFor(() => expect(screen.getByText('GitLab settings saved')).toBeInTheDocument());
    expect(tokenInput).toHaveValue('');
    expect(screen.queryByDisplayValue('glpat-secret-token')).not.toBeInTheDocument();
  });

  it('tests and clears GitLab settings through the documented IPC contracts', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: 'https://gitlab.example.com', configured: true });
      }
      if (channel === 'renderer:test-gitlab-connection') {
        return Promise.resolve({ username: 'mona' });
      }
      if (channel === 'renderer:clear-gitlab-settings') {
        return Promise.resolve({ baseUrl: '', configured: false });
      }
      return Promise.resolve();
    });

    renderPanel();

    await screen.findByDisplayValue('https://gitlab.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:test-gitlab-connection',
      { baseUrl: 'https://gitlab.example.com' }
    ));
    expect(await screen.findByText('Connected as mona')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('renderer:clear-gitlab-settings'));
    expect(await screen.findByText('GitLab settings cleared')).toBeInTheDocument();
    expect(screen.getByTestId('gitlab-base-url-input')).toHaveValue('');
  });
});
