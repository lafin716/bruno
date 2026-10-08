jest.mock('../store/aws-secrets', () => ({ awsSecretsStore: { getSettings: jest.fn() } }));
jest.mock('@aws-sdk/credential-providers', () => ({ fromIni: jest.fn(), fromNodeProviderChain: jest.fn() }));
jest.mock('axios', () => ({
  ...jest.requireActual('axios'),
  create: jest.fn(() => ({ request: jest.fn() }))
}));

const axios = require('axios');
const { fromIni, fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { awsSecretsStore } = require('../store/aws-secrets');
const { makeAwsSecretsClient, testAwsSecret, resolveDesktopAwsExternalSecrets } = require('./aws-secrets');
const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'synthetic-signing-key', sessionToken: 'synthetic-session' };

beforeEach(() => {
  jest.clearAllMocks();
  fromIni.mockReturnValue(async () => credentials);
  fromNodeProviderChain.mockReturnValue(async () => credentials);
  awsSecretsStore.getSettings.mockReturnValue({ enabled: true, region: 'ap-northeast-2', profile: 'dev' });
  axios.create.mockImplementation(() => ({ request: jest.fn(async () => ({ status: 200, data: { SecretString: '{"token":"synthetic-secret"}' } })) }));
});

it('uses the actual AWS signer with the session token and named credential provider', async () => {
  const client = makeAwsSecretsClient();
  const transport = axios.create.mock.results[0].value;
  await expect(client.getSecretValue({ secretId: 'dev/api', jsonKey: 'token', region: 'ap-northeast-2', profile: 'dev' })).resolves.toBe('synthetic-secret');
  const request = transport.request.mock.calls[0][0];
  expect(fromIni).toHaveBeenCalledWith(expect.objectContaining({ profile: 'dev' }));
  expect(request.url).toBe('https://secretsmanager.ap-northeast-2.amazonaws.com/');
  expect(request.maxRedirects).toBe(0);
  expect(request.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-northeast-2\/secretsmanager\/aws4_request/);
  expect(request.headers['X-Amz-Security-Token']).toBe('synthetic-session');
  expect(request.headers['X-Amz-Target']).toBe('secretsmanager.GetSecretValue');
});

it('returns only access success when testing a secret', async () => {
  await expect(testAwsSecret({ secretId: 'dev/api', jsonKey: 'token' })).resolves.toEqual({ ok: true });
});

it('fails before transport when desktop fetching is disabled', async () => {
  awsSecretsStore.getSettings.mockReturnValue({ enabled: false, region: 'us-east-1', profile: '' });
  await expect(resolveDesktopAwsExternalSecrets({ type: 'aws-secrets-manager', variables: [{ name: 'TOKEN', value: '{"secretId":"dev/api"}' }] })).rejects.toMatchObject({ code: 'disabled' });
  const transport = axios.create.mock.results[0].value;
  expect(transport.request).not.toHaveBeenCalled();
  expect(fromIni).not.toHaveBeenCalled();
  expect(fromNodeProviderChain).not.toHaveBeenCalled();
});
