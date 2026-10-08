const { fromIni, fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { aws4Interceptor } = require('aws4-axios');
const axios = require('axios');
const { createAwsSecretsManagerClient, resolveAwsExternalSecrets } = require('@usebruno/requests');

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

const resolveCliAwsExternalSecrets = async ({
  externalSecrets,
  enabled,
  region,
  profile
}) =>
  resolveAwsExternalSecrets({
    externalSecrets,
    enabled,
    defaultRegion: region,
    defaultProfile: profile,
    client: makeAwsSecretsClient()
  });

module.exports = {
  makeAwsSecretsClient,
  resolveCliAwsExternalSecrets
};
