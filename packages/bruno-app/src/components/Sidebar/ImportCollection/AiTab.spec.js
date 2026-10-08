import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { useSelector } from 'react-redux';
import { callIpc } from 'utils/common/ipc';
import AiTab from './AiTab';

jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('utils/common/ipc', () => ({ callIpc: jest.fn() }));
jest.mock('ui/Button', () => ({ children, variant, color, type = 'button', ...props }) => <button type={type} {...props}>{children}</button>);

const collection = { name: 'Example API', version: '1', items: [], environments: [] };
const response = { collection, summary: ['2 folders', '3 endpoints'], warnings: ['Fill login credentials'] };
const enabledPreferences = {
  enabled: true,
  localProviders: { preferredProvider: 'claude', codex: { enabled: true }, claude: { enabled: true } }
};

const setup = (ai = enabledPreferences) => {
  useSelector.mockImplementation((select) => select({ app: { preferences: { ai } } }));
  const handleSubmit = jest.fn();
  const setErrorMessage = jest.fn();
  return { ...render(<AiTab handleSubmit={handleSubmit} setErrorMessage={setErrorMessage} />), handleSubmit, setErrorMessage };
};

const generate = () => {
  fireEvent.change(screen.getByLabelText('Swagger / OpenAPI link'), { target: { value: 'https://example.com/swagger/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate collection' }));
};

beforeEach(() => {
  jest.clearAllMocks();
  callIpc.mockResolvedValue(response);
});

it('previews an AI collection before continuing through the existing import flow', async () => {
  const { handleSubmit } = setup();
  generate();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await screen.findByTestId('ai-import-preview');
  expect(screen.getByText('Fill login credentials')).toBeVisible();
  expect(handleSubmit).not.toHaveBeenCalled();
  expect(callIpc).toHaveBeenCalledWith('renderer:ai-import-openapi', expect.objectContaining({ providerId: 'claude' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose location' }));
  expect(handleSubmit).toHaveBeenCalledWith({ type: 'bruno', rawData: collection });
});

it('clears a generated preview when the source or provider changes', async () => {
  setup();
  generate();
  await screen.findByTestId('ai-import-preview');
  fireEvent.change(screen.getByLabelText('Local AI connection'), { target: { value: 'codex' } });
  expect(screen.queryByTestId('ai-import-preview')).not.toBeInTheDocument();
  generate();
  await screen.findByTestId('ai-import-preview');
  fireEvent.change(screen.getByLabelText('Swagger / OpenAPI link'), { target: { value: 'https://other.example.com/openapi.json' } });
  expect(screen.queryByTestId('ai-import-preview')).not.toBeInTheDocument();
});

it('cancels pending generation and ignores a late successful result', async () => {
  let resolve;
  callIpc.mockImplementation((channel) => channel === 'renderer:ai-import-openapi' ? new Promise((done) => { resolve = done; }) : Promise.resolve({ cancelled: true }));
  setup();
  generate();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(callIpc).toHaveBeenCalledWith('renderer:ai-import-cancel', expect.objectContaining({ requestId: expect.any(String) }));
  await act(async () => resolve(response));
  expect(screen.queryByTestId('ai-import-preview')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate collection' })).toBeEnabled();
});

it('cancels generation when leaving the AI tab', () => {
  callIpc.mockImplementation((channel) => channel === 'renderer:ai-import-openapi' ? new Promise(() => {}) : Promise.resolve({}));
  const { unmount } = setup();
  generate();
  unmount();
  expect(callIpc).toHaveBeenCalledWith('renderer:ai-import-cancel', expect.any(Object));
});

it('shows actionable generation errors and allows retry', async () => {
  callIpc.mockRejectedValue(new Error('Codex is not logged in. Run codex login.'));
  const { setErrorMessage } = setup();
  generate();
  await waitFor(() => expect(setErrorMessage).toHaveBeenCalledWith('Codex is not logged in. Run codex login.'));
  expect(screen.getByRole('button', { name: 'Generate collection' })).toBeEnabled();
});

it('requires enabled AI and a local connection', () => {
  setup({ ...enabledPreferences, enabled: false });
  expect(screen.getByTestId('ai-import-setup')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Generate collection' })).toBeDisabled();
});

it('rejects URLs with embedded credentials before IPC', () => {
  const { setErrorMessage } = setup();
  fireEvent.change(screen.getByLabelText('Swagger / OpenAPI link'), { target: { value: 'https://user:secret@example.com/spec' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate collection' }));
  expect(setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('without credentials'));
  expect(callIpc).not.toHaveBeenCalled();
});
