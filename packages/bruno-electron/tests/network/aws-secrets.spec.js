jest.mock('../../src/services/aws-secrets', () => ({
  resolveDesktopAwsExternalSecrets: jest.fn()
}));

jest.mock('../../src/utils/cookies', () => ({
  addCookieToJar: jest.fn(),
  getDomainsWithCookies: jest.fn(async () => []),
  getCookieStringForUrl: jest.fn(() => '')
}));

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn((key, fallback) => fallback),
    set: jest.fn()
  }));
});

const { resolveDesktopAwsExternalSecrets } = require('../../src/services/aws-secrets');
const { addCookieToJar } = require('../../src/utils/cookies');
const {
  filterAwsProtectedVariables,
  redactAwsOutput,
  redactAwsStreamChunk,
  resolveAwsSecretsForEnvironment,
  saveCookies,
  buildOauth2CredentialsEventPayload,
  buildOauth2DebugEventPayload
} = require('../../src/ipc/network/index');

describe('network AWS external secrets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves AWS values before request execution variables are used', async () => {
    resolveDesktopAwsExternalSecrets.mockResolvedValue({
      variables: { TOKEN: 'secret' },
      secretNames: new Set(['TOKEN']),
      secretValues: new Set(['secret'])
    });

    const collection = {};
    const resolved = await resolveAwsSecretsForEnvironment({
      collection,
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'dev/api' }) }]
        }
      },
      envVars: { TOKEN: 'regular', host: 'api.example.com' }
    });

    expect(resolved).toEqual({ TOKEN: 'secret', host: 'api.example.com' });
    expect(resolveDesktopAwsExternalSecrets).toHaveBeenCalledTimes(1);
  });

  it('fails closed when AWS resolution rejects before scripts can run', async () => {
    resolveDesktopAwsExternalSecrets.mockRejectedValue(new Error('AWS Secrets Manager fetching is disabled.'));

    await expect(resolveAwsSecretsForEnvironment({
      collection: {},
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'dev/api' }) }]
        }
      },
      envVars: {}
    })).rejects.toThrow('AWS Secrets Manager fetching is disabled.');
  });

  it('protects original values while marking copied secret values for renderer reducers', () => {
    const payload = filterAwsProtectedVariables(
      { TOKEN: 'secret', SAFE: 'ok', COPY: 'prefix-secret-suffix' },
      { secretNames: new Set(['TOKEN']), secretValues: new Set(['secret']) },
      { TOKEN: 'original' }
    );

    expect(payload.variables).toEqual({ TOKEN: 'original', SAFE: 'ok' });
    expect(payload.protectedNames.sort()).toEqual(['COPY', 'TOKEN']);
  });

  it('marks deleted external names protected without restoring fetched baseline values', () => {
    const payload = filterAwsProtectedVariables(
      { SAFE: 'ok' },
      { secretNames: new Set(['TOKEN']), secretValues: new Set(['secret']) },
      { TOKEN: 'secret' }
    );

    expect(payload.variables).toEqual({ SAFE: 'ok' });
    expect(payload.protectedNames).toEqual(['TOKEN']);
  });

  it('redacts protected values in event payload keys, errors, and byte chunks', async () => {
    resolveDesktopAwsExternalSecrets.mockResolvedValue({
      variables: { TOKEN: 'secret' },
      secretNames: new Set(['TOKEN']),
      secretValues: new Set(['secret'])
    });

    const collection = {};
    await resolveAwsSecretsForEnvironment({
      collection,
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'dev/api' }) }]
        }
      },
      envVars: {}
    });

    const error = redactAwsOutput(collection, Object.assign(new Error('secret failed'), { 'secret-key': 'secret' }));
    const payload = redactAwsOutput(collection, {
      'echo-secret': 'secret',
      'data': new Uint8Array(Buffer.from('chunk-secret'))
    });

    expect(error.message).toBe('[AWS_SECRET_REDACTED] failed');
    expect(error['[AWS_SECRET_REDACTED]-key']).toBe('[AWS_SECRET_REDACTED]');
    expect(payload['echo-[AWS_SECRET_REDACTED]']).toBe('[AWS_SECRET_REDACTED]');
    expect(Buffer.from(payload.data).toString('utf8')).toBe('chunk-[AWS_SECRET_REDACTED]');
  });

  it('omits live SSE chunk content when AWS protected output is active', async () => {
    resolveDesktopAwsExternalSecrets.mockResolvedValue({
      variables: { TOKEN: 'top-secret' },
      secretNames: new Set(['TOKEN']),
      secretValues: new Set(['top-secret'])
    });

    const collection = {};
    await resolveAwsSecretsForEnvironment({
      collection,
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'dev/api' }) }]
        }
      },
      envVars: {}
    });

    const firstChunk = redactAwsStreamChunk(collection, { data: 'top-', dataBuffer: Buffer.from('top-') });
    const secondChunk = redactAwsStreamChunk(collection, { data: 'secret', dataBuffer: Buffer.from('secret') });

    expect(firstChunk.data).toBe('[AWS_SECRET_REDACTED]');
    expect(secondChunk.data).toBe('[AWS_SECRET_REDACTED]');
    expect(Buffer.from(firstChunk.dataBuffer).toString('utf8')).toBe('[AWS_SECRET_REDACTED]');
    expect(Buffer.from(secondChunk.dataBuffer).toString('utf8')).toBe('[AWS_SECRET_REDACTED]');
  });

  it('skips automatic cookie persistence when Set-Cookie contains protected AWS values', async () => {
    resolveDesktopAwsExternalSecrets.mockResolvedValue({
      variables: { TOKEN: 'secret' },
      secretNames: new Set(['TOKEN']),
      secretValues: new Set(['secret'])
    });

    const collection = {};
    await resolveAwsSecretsForEnvironment({
      collection,
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'dev/api' }) }]
        }
      },
      envVars: {}
    });

    saveCookies('https://api.example.com', {
      'set-cookie': ['session=secret; Path=/', 'theme=light; Path=/']
    }, collection);

    expect(addCookieToJar).toHaveBeenCalledTimes(1);
    expect(addCookieToJar).toHaveBeenCalledWith('theme=light; Path=/', 'https://api.example.com');
  });

  it('redacts AWS secrets from OAuth2 credential and debug IPC payloads', async () => {
    const secret = 'client secret/"value';
    resolveDesktopAwsExternalSecrets.mockResolvedValue({
      variables: { CLIENT_SECRET: secret },
      secretNames: new Set(['CLIENT_SECRET']),
      secretValues: new Set([secret])
    });

    const collection = {};
    await resolveAwsSecretsForEnvironment({
      collection,
      environment: {
        externalSecrets: {
          type: 'aws-secrets-manager',
          variables: [{ name: 'CLIENT_SECRET', value: JSON.stringify({ secretId: 'oauth/client' }) }]
        }
      },
      envVars: {}
    });

    const oauth2Credentials = {
      credentials: { access_token: 'token' },
      url: 'https://auth.example.com/token',
      credentialsId: 'oauth-id',
      debugInfo: {
        data: [{
          request: {
            headers: {
              'Authorization': `Basic ${Buffer.from(`client:${secret}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: `client_secret=${encodeURIComponent(secret)}`
          },
          response: {
            data: `{"client_secret":"${JSON.stringify(secret).slice(1, -1)}"}`
          }
        }]
      }
    };

    const credentialsPayload = buildOauth2CredentialsEventPayload({
      collection,
      oauth2Credentials,
      collectionUid: 'collection-1',
      itemUid: 'item-1',
      executionMode: 'runner'
    });
    const debugPayload = buildOauth2DebugEventPayload({
      collection,
      oauth2Credentials,
      basePayload: { collectionUid: 'collection-1', itemUid: 'item-1' }
    });

    const serialized = JSON.stringify({ credentialsPayload, debugPayload });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodeURIComponent(secret));
    expect(serialized).not.toContain(Buffer.from(`client:${secret}`).toString('base64'));
    expect(credentialsPayload.debugInfo.data[0].request.headers.Authorization).toBe('Basic [AWS_SECRET_REDACTED]');
    expect(credentialsPayload.debugInfo.data[0].request.data).toBe('client_secret=[AWS_SECRET_REDACTED]');
    expect(debugPayload.debugInfo.data[0].response.data).toBe('{"client_secret":"[AWS_SECRET_REDACTED]"}');
  });
});
