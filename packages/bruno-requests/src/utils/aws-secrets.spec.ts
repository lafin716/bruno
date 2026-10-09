import {
  AwsSecretsError,
  createAwsSecretRedactor,
  createAwsSecretsManagerClient,
  resolveAwsExternalSecrets,
  validateAwsExternalSecrets
} from './aws-secrets';

describe('aws-secrets resolver', () => {
  it('resolves string, binary, and JSON-key values with dedupe metadata', async () => {
    const calls: any[] = [];
    const client = {
      getSecretValue: jest.fn(async (ref) => {
        calls.push(ref);
        if (ref.secretId === 'binary') return 'decoded-binary';
        if (ref.secretId === 'json') return 'tok';
        return 'plain';
      })
    };

    const result = await resolveAwsExternalSecrets({
      enabled: true,
      defaultRegion: 'ap-northeast-2',
      defaultProfile: 'dev',
      client,
      externalSecrets: {
        type: 'aws-secrets-manager',
        variables: [
          { name: 'A', value: JSON.stringify({ secretId: 'plain' }) },
          { name: 'B', value: JSON.stringify({ secretId: 'plain' }) },
          { name: 'C', value: JSON.stringify({ secretId: 'json', jsonKey: 'token', region: 'us-east-1' }) },
          { name: 'D', value: JSON.stringify({ secretId: 'binary' }) }
        ]
      }
    });

    expect(result.variables).toEqual({ A: 'plain', B: 'plain', C: 'tok', D: 'decoded-binary' });
    expect(result.secretNames).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(result.secretValues).toEqual(new Set(['plain', 'tok', 'decoded-binary']));
    expect(client.getSecretValue).toHaveBeenCalledTimes(3);
    expect(calls[0]).toMatchObject({ secretId: 'plain', region: 'ap-northeast-2', profile: 'dev' });
    expect(calls[1]).toMatchObject({ secretId: 'json', region: 'us-east-1', profile: 'dev' });
  });

  it('fails closed when references exist and fetching is disabled', async () => {
    await expect(resolveAwsExternalSecrets({
      enabled: false,
      client: { getSecretValue: jest.fn() },
      externalSecrets: {
        type: 'aws-secrets-manager',
        variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'app' }) }]
      }
    })).rejects.toMatchObject({ code: 'disabled' });
  });

  it('rejects invalid names and reference payloads', async () => {
    expect(() => validateAwsExternalSecrets(null)).not.toThrow();
    expect(() => validateAwsExternalSecrets({
      type: 'aws-secrets-manager',
      variables: [{ name: 'TOKEN.name-1', value: JSON.stringify({ secretId: 'app', jsonKey: 'token' }) }]
    })).not.toThrow();

    expect(() => validateAwsExternalSecrets({
      type: 'aws-secrets-manager',
      variables: 'bad' as any
    })).toThrow(AwsSecretsError);

    expect(() => validateAwsExternalSecrets({
      type: 'aws-secrets-manager',
      variables: [{ name: 'TOKEN', value: '{"jsonKey":"token"}' }]
    })).toThrow(AwsSecretsError);

    expect(() => validateAwsExternalSecrets({
      type: 'aws-secrets-manager',
      variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId: 'app', region: 123 }) }]
    })).toThrow(AwsSecretsError);

    await expect(resolveAwsExternalSecrets({
      enabled: true,
      defaultRegion: 'us-east-1',
      client: { getSecretValue: jest.fn() },
      externalSecrets: {
        type: 'aws-secrets-manager',
        variables: [{ name: '__proto__', value: JSON.stringify({ secretId: 'app' }) }]
      }
    })).rejects.toBeInstanceOf(AwsSecretsError);

    await expect(resolveAwsExternalSecrets({
      enabled: true,
      defaultRegion: 'us-east-1',
      client: { getSecretValue: jest.fn() },
      externalSecrets: {
        type: 'aws-secrets-manager',
        variables: [{ name: 'TOKEN', value: '{"jsonKey":"token"}' }]
      }
    })).rejects.toMatchObject({ code: 'invalid-reference' });
  });

  it('signs regional GetSecretValue requests and extracts JSON fields', async () => {
    const requestSpy = jest.fn(async (request) => ({
      status: 200,
      data: { SecretString: JSON.stringify({ token: 'secret-token' }) },
      config: request
    }));
    const signRequest = jest.fn(({ request }) => ({
      ...request,
      headers: { ...request.headers, Authorization: 'AWS4-HMAC-SHA256 signed' }
    }));

    const client = createAwsSecretsManagerClient({
      axiosInstance: { request: requestSpy } as any,
      credentialsProvider: jest.fn(async () => ({
        accessKeyId: 'AKIA',
        secretAccessKey: 'SECRET',
        sessionToken: 'SESSION'
      })),
      signRequest
    });

    await expect(client.getSecretValue({
      secretId: 'dev/api',
      jsonKey: 'token',
      region: 'ap-northeast-2',
      profile: 'dev'
    })).resolves.toBe('secret-token');

    expect(signRequest).toHaveBeenCalledWith(expect.objectContaining({
      region: 'ap-northeast-2',
      service: 'secretsmanager',
      credentials: expect.objectContaining({ sessionToken: 'SESSION' })
    }));
    expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://secretsmanager.ap-northeast-2.amazonaws.com/',
      data: JSON.stringify({ SecretId: 'dev/api' }),
      headers: expect.objectContaining({
        'X-Amz-Target': 'secretsmanager.GetSecretValue',
        'Authorization': 'AWS4-HMAC-SHA256 signed'
      }),
      maxRedirects: 0
    }));
  });

  it('rejects unsafe regions before building the AWS endpoint', async () => {
    const client = createAwsSecretsManagerClient({
      axiosInstance: { request: jest.fn() } as any,
      credentialsProvider: jest.fn(async () => ({
        accessKeyId: 'AKIA',
        secretAccessKey: 'SECRET'
      })),
      signRequest: jest.fn(({ request }) => request)
    });

    await expect(client.getSecretValue({
      secretId: 'dev/api',
      region: 'x.amazonaws.com@attacker'
    })).rejects.toMatchObject({ code: 'invalid-region' });
  });

  it('sanitizes credential and signing failures', async () => {
    const credentialClient = createAwsSecretsManagerClient({
      axiosInstance: { request: jest.fn() } as any,
      credentialsProvider: jest.fn(async () => {
        throw new Error('raw credential payload');
      }),
      signRequest: jest.fn(({ request }) => request)
    });
    await expect(credentialClient.getSecretValue({
      secretId: 'dev/api',
      region: 'us-east-1'
    })).rejects.toMatchObject({ code: 'fetch-failed' });
    await expect(credentialClient.getSecretValue({
      secretId: 'dev/api',
      region: 'us-east-1'
    })).rejects.not.toThrow('raw credential payload');

    const signClient = createAwsSecretsManagerClient({
      axiosInstance: { request: jest.fn() } as any,
      credentialsProvider: jest.fn(async () => ({
        accessKeyId: 'AKIA',
        secretAccessKey: 'SECRET'
      })),
      signRequest: jest.fn(() => {
        throw new Error('raw signing payload');
      })
    });
    await expect(signClient.getSecretValue({
      secretId: 'dev/api',
      region: 'us-east-1'
    })).rejects.toMatchObject({ code: 'fetch-failed' });
    await expect(signClient.getSecretValue({
      secretId: 'dev/api',
      region: 'us-east-1'
    })).rejects.not.toThrow('raw signing payload');
  });

  it('redacts known values inside copied strings, object keys, and byte output', () => {
    const redact = createAwsSecretRedactor(new Set(['top-secret']));
    const result = redact({
      'request': { data: 'copy=top-secret' },
      'response': { data: ['top-secret', 'safe'] },
      'x-top-secret': 'header',
      'bytes': new Uint8Array(Buffer.from('top-secret')),
      'buffer': Buffer.from('prefix-top-secret')
    });

    expect(result.request.data).toBe('copy=[AWS_SECRET_REDACTED]');
    expect(result.response.data).toEqual(['[AWS_SECRET_REDACTED]', 'safe']);
    expect(result['x-[AWS_SECRET_REDACTED]']).toBe('header');
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('[AWS_SECRET_REDACTED]');
    expect(result.buffer.toString('utf8')).toBe('prefix-[AWS_SECRET_REDACTED]');

    const error = redact(Object.assign(new Error('top-secret exploded'), { 'top-secret-key': 'top-secret' }));
    expect(error.message).toBe('[AWS_SECRET_REDACTED] exploded');
    expect(error.stack).not.toContain('top-secret');
    expect((error as any)['[AWS_SECRET_REDACTED]-key']).toBe('[AWS_SECRET_REDACTED]');
  });

  it('redacts parsed JSON secret leaves and encoded data buffers', () => {
    const redact = createAwsSecretRedactor(new Set([JSON.stringify({ token: 'abcsecret', nested: { key: 'nested-secret' } })]));
    const result = redact({
      'response': { data: { token: 'abcsecret', nested: { key: 'nested-secret' } } },
      'dataBuffer': Buffer.from('prefix-abcsecret').toString('base64'),
      'nested-secret': 'abcsecret'
    });

    expect(result.response.data).toEqual({
      token: '[AWS_SECRET_REDACTED]',
      nested: { key: '[AWS_SECRET_REDACTED]' }
    });
    expect(Buffer.from(result.dataBuffer, 'base64').toString('utf8')).toBe('prefix-[AWS_SECRET_REDACTED]');
    expect(result['[AWS_SECRET_REDACTED]']).toBe('[AWS_SECRET_REDACTED]');
  });

  it('redacts OAuth-style Basic, form-encoded, and JSON-escaped representations', () => {
    const secret = 'abc secret/\"value';
    const redact = createAwsSecretRedactor(new Set([secret]));
    const result = redact({
      basic: `Authorization: Basic ${Buffer.from(`client:${secret}`).toString('base64')}`,
      form: `client_secret=${encodeURIComponent(secret)}`,
      json: `{"client_secret":"${JSON.stringify(secret).slice(1, -1)}"}`
    });

    expect(result.basic).toBe('Authorization: Basic [AWS_SECRET_REDACTED]');
    expect(result.form).toBe('client_secret=[AWS_SECRET_REDACTED]');
    expect(result.json).toBe('{"client_secret":"[AWS_SECRET_REDACTED]"}');
  });
});
