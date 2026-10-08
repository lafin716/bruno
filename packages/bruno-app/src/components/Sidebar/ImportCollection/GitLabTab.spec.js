import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitLabTab from './GitLabTab';

jest.mock('ui/Button', () => ({
  __esModule: true,
  default: ({ children, loading, ...props }) => (
    <button {...props}>{loading ? 'Loading' : children}</button>
  )
}));

const project = (overrides = {}) => ({
  id: 1,
  name: 'Payments API',
  pathWithNamespace: 'platform/payments-api',
  httpUrl: 'https://gitlab.example.com/platform/payments-api.git',
  sshUrl: 'git@gitlab.example.com:platform/payments-api.git',
  defaultBranch: 'main',
  ...overrides
});

beforeEach(() => {
  window.ipcRenderer = { invoke: jest.fn() };
});

const renderTab = (props = {}) => {
  const handleSubmit = jest.fn();
  const setErrorMessage = jest.fn();
  render(<GitLabTab handleSubmit={handleSubmit} setErrorMessage={setErrorMessage} {...props} />);
  return { handleSubmit, setErrorMessage };
};

describe('GitLabTab', () => {
  it('loads configured GitLab projects and imports HTTPS by default', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: 'https://gitlab.example.com', configured: true });
      }
      if (channel === 'renderer:list-gitlab-projects') {
        return Promise.resolve({ projects: [project()], hasMore: true });
      }
      return Promise.resolve();
    });
    const { handleSubmit } = renderTab();

    expect(await screen.findByText('Payments API')).toBeInTheDocument();
    expect(screen.getByText('platform/payments-api')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(handleSubmit).toHaveBeenCalledWith({
      type: 'git-repository',
      repositoryUrl: 'https://gitlab.example.com/platform/payments-api.git'
    });
  });

  it('supports SSH import and paginated project loading', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: 'https://gitlab.example.com', configured: true });
      }
      if (channel === 'renderer:list-gitlab-projects') {
        return Promise.resolve({
          projects: [project({
            id: payload.page,
            name: `Project ${payload.page}`,
            pathWithNamespace: `group/project-${payload.page}`
          })],
          hasMore: payload.page < 2
        });
      }
      return Promise.resolve();
    });
    const { handleSubmit } = renderTab();

    expect(await screen.findByText('Project 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Project 2')).toBeInTheDocument();
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('renderer:list-gitlab-projects', { search: '', page: 2 });

    await userEvent.click(screen.getByLabelText('SSH'));
    const row = screen.getByTestId('gitlab-project-row');
    await userEvent.click(within(row).getByRole('button', { name: 'Import' }));

    expect(handleSubmit).toHaveBeenCalledWith({
      type: 'git-repository',
      repositoryUrl: 'git@gitlab.example.com:platform/payments-api.git'
    });
  });

  it('ignores stale search responses after a newer search completes', async () => {
    let resolveOldSearch;
    window.ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: 'https://gitlab.example.com', configured: true });
      }
      if (channel === 'renderer:list-gitlab-projects') {
        if (payload.search === 'old') {
          return new Promise((resolve) => {
            resolveOldSearch = () => resolve({ projects: [project({ id: 2, name: 'Old Result' })], hasMore: false });
          });
        }
        if (payload.search === 'new') {
          return Promise.resolve({ projects: [project({ id: 3, name: 'New Result' })], hasMore: false });
        }
        return Promise.resolve({ projects: [], hasMore: false });
      }
      return Promise.resolve();
    });

    renderTab();

    await screen.findByTestId('gitlab-empty-projects');
    const input = screen.getByTestId('gitlab-project-search-input');
    await userEvent.type(input, 'old');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.clear(input);
    await userEvent.type(input, 'new');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('New Result')).toBeInTheDocument();
    resolveOldSearch();

    await waitFor(() => expect(screen.queryByText('Old Result')).not.toBeInTheDocument());
    expect(screen.getByText('New Result')).toBeInTheDocument();
  });

  it('shows the configured-settings requirement instead of searching when GitLab is not configured', async () => {
    window.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'renderer:get-gitlab-settings') {
        return Promise.resolve({ baseUrl: '', configured: false });
      }
      return Promise.resolve();
    });

    renderTab();

    expect(await screen.findByTestId('gitlab-not-configured')).toHaveTextContent('Configure GitLab');
    expect(window.ipcRenderer.invoke).not.toHaveBeenCalledWith('renderer:list-gitlab-projects', expect.anything());
  });
});
