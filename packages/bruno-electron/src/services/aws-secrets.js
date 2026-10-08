const { fromIni, fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { aws4Interceptor } = require('aws4-axios');
const axios = require('axios');
const {
  hasAwsExternalSecrets,
  validateAwsExternalSecrets,
  createAwsSecretsManagerClient,
  resolveAwsExternalSecrets
} = require('@usebruno/requests');
const { awsSecretsStore } = require('../store/aws-secrets');

const makeSignableAxiosConfig = (request) => ({
  ...request,
  headers: axios.AxiosHeaders ? axios.AxiosHeaders.from(request.headers || {}) : { ...(request.headers || {}) },
  transformRequest: request.transformRequest || axios.defaults.transformRequest
});

const makeAwsSecretsClient = () =>
  createAwsSecretsManagerClient({
    credentialsProvider: async ({ profile } = {}) => {
      const provider = profile
        ? fromIni({ profile, ignoreCache: true })
        : fromNodeProviderChain({ ignoreCache: true });
      return provider();
    },
    signRequest: async ({ request, region, service, credentials }) => {
      const interceptor = aws4Interceptor({
        options: { region, service },
        credentials
      });
      const signedRequest = await interceptor(makeSignableAxiosConfig(request));
      return {
        ...signedRequest,
        headers: axios.AxiosHeaders && signedRequest.headers instanceof axios.AxiosHeaders
          ? signedRequest.headers.toJSON()
          : signedRequest.headers
      };
    }
  });

const resolveDesktopAwsExternalSecrets = async (externalSecrets) => {
  const settings = awsSecretsStore.getSettings();
  return resolveAwsExternalSecrets({
    externalSecrets,
    enabled: settings.enabled,
    defaultRegion: settings.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    defaultProfile: settings.profile || process.env.AWS_PROFILE,
    client: makeAwsSecretsClient()
  });
};

const hasAwsExternalSecretReferences = (environment) => hasAwsExternalSecrets(environment?.externalSecrets);

const rejectAwsExternalSecretsForProtocol = (environment, protocol) => {
  if (environment?.externalSecrets?.type === 'aws-secrets-manager') {
    validateAwsExternalSecrets(environment.externalSecrets);
  }
  if (hasAwsExternalSecretReferences(environment)) {
    throw new Error(`AWS external secrets are not supported for ${protocol} requests yet.`);
  }
};

const testAwsSecret = async ({ secretId, jsonKey, region, profile } = {}) => {
  const settings = awsSecretsStore.getSettings();
  const client = makeAwsSecretsClient();
  await client.getSecretValue({
    secretId,
    jsonKey,
    region: region || settings.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    profile: profile || settings.profile || process.env.AWS_PROFILE
  });
  return { ok: true };
};

module.exports = {
  hasAwsExternalSecretReferences,
  makeAwsSecretsClient,
  rejectAwsExternalSecretsForProtocol,
  resolveDesktopAwsExternalSecrets,
  testAwsSecret
};
