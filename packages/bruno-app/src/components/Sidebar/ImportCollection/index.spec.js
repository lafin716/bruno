import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'styled-components';
import ImportCollection from './index';

jest.mock('components/Portal', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="portal-root">{children}</div>
}));

jest.mock('components/Modal', () => ({
  __esModule: true,
  default: ({ children, title }) => (
    <div data-testid="mock-modal">
      <h1>{title}</h1>
      {children}
    </div>
  )
}));

jest.mock('providers/Theme', () => ({
  useTheme: () => ({
    theme: {
      status: {
        danger: { background: '#fee2e2', border: '#fecaca', text: '#991b1b' }
      }
    }
  })
}));

jest.mock('./GitLabTab', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-gitlab-tab">GitLab projects</div>
}));

jest.mock('./FileTab', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-file-tab">Files</div>
}));

jest.mock('./GitHubTab', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-github-tab">Git Repository</div>
}));

jest.mock('./UrlTab', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-url-tab">URL</div>
}));

const theme = {
  tabs: {
    active: { color: '#111', border: '#111' }
  },
  status: {
    danger: { background: '#fee2e2', border: '#fecaca', text: '#991b1b' }
  }
};

describe('ImportCollection', () => {
  it('adds a GitLab tab without removing existing import tabs', async () => {
    render(
      <ThemeProvider theme={theme}>
        <ImportCollection onClose={jest.fn()} handleSubmit={jest.fn()} />
      </ThemeProvider>
    );

    expect(screen.getByTestId('file-tab')).toBeInTheDocument();
    expect(screen.getByTestId('github-tab')).toBeInTheDocument();
    expect(screen.getByTestId('url-tab')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('gitlab-tab'));
    expect(screen.getByTestId('mock-gitlab-tab')).toBeInTheDocument();
  });
});
