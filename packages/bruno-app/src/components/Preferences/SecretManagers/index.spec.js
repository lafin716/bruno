import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'styled-components';
import SecretManagers from './index';

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
    <SecretManagers />
  </ThemeProvider>
);

beforeEach(() => {
  window.ipcRenderer = { invoke: jest.fn() };
});

describe('SecretManagers preferences', () => {
  it('saves enabled AWS defaults without static credentials', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === 'renderer:get-aws-secrets-settings') {
        return Promise.resolve({ enabled: false, region: '', profile: '' });
      }
      if (channel === 'renderer:save-aws-secrets-settings') {
        return Promise.resolve(payload);
      }
      return Promise.resolve();
    });

    renderPanel();

    const enabled = await screen.findByLabelText('Enable AWS Secrets Manager');
    await userEvent.click(enabled);
    await userEvent.type(screen.getByTestId('aws-secrets-region-input'), 'ap-northeast-2');
    await userEvent.type(screen.getByTestId('aws-secrets-profile-input'), 'dev');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:save-aws-secrets-settings',
      { enabled: true, region: 'ap-northeast-2', profile: 'dev' }
    ));
    expect(screen.queryByLabelText(/access key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret access key/i)).not.toBeInTheDocument();
  });

  it('tests a secret without rendering returned secret values', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'renderer:get-aws-secrets-settings') {
        return Promise.resolve({ enabled: true, region: 'us-east-1', profile: 'dev' });
      }
      if (channel === 'renderer:test-aws-secret') {
        return Promise.resolve({ ok: true, value: 'raw-secret-value' });
      }
      return Promise.resolve();
    });

    renderPanel();

    await screen.findByDisplayValue('us-east-1');
    await userEvent.type(screen.getByTestId('aws-test-secret-id-input'), 'dev/api');
    await userEvent.type(screen.getByTestId('aws-test-json-key-input'), 'token');
    await userEvent.click(screen.getByRole('button', { name: 'Test Secret' }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:test-aws-secret',
      { secretId: 'dev/api', jsonKey: 'token', region: 'us-east-1', profile: 'dev' }
    ));
    expect(await screen.findByText('Secret fetched successfully')).toBeInTheDocument();
    expect(screen.queryByText('raw-secret-value')).not.toBeInTheDocument();
  });
});
