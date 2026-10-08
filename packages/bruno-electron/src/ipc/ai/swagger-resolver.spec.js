const { resolveSwaggerDocument } = require('./swagger-resolver');

const createDefaultFetcherWithGet = async (get) => {
  jest.resetModules();
  jest.doMock('../network/cert-utils', () => ({
    getCertsAndProxyConfig: jest.fn(() => Promise.resolve({
      proxyMode: 'off',
      proxyConfig: {},
      httpsAgentRequestFields: {},
      interpolationOptions: {}
    }))
  }));
  jest.doMock('../network/axios-instance', () => ({
    makeAxiosInstance: jest.fn(() => ({ get }))
  }));
  const { _test } = require('./swagger-resolver');
  return _test.createDefaultFetcher();
};

const jsonResponse = (body, url = 'https://api.example.com/openapi.json') => ({
  url,
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

describe('ipc/ai/swagger-resolver', () => {
  it('resolves direct JSON OpenAPI documents and validates local refs', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Pets', version: '1' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pets' }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Pets: {
            type: 'object',
            properties: { id: { type: 'string' } }
          }
        }
      }
    };
    const fetcher = jest.fn(() => Promise.resolve(jsonResponse(spec)));

    const result = await resolveSwaggerDocument({ url: 'https://api.example.com/openapi.json', fetcher });

    expect(result.document.info.title).toBe('Pets');
    expect(result.sourceUrl).toBe('https://api.example.com/openapi.json');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('resolves YAML Swagger 2 documents', async () => {
    const fetcher = jest.fn(() => Promise.resolve({
      url: 'https://api.example.com/swagger.yaml',
      status: 200,
      headers: { 'content-type': 'application/yaml' },
      body: [
        'swagger: "2.0"',
        'info:',
        '  title: Legacy',
        '  version: "1"',
        'paths:',
        '  /login:',
        '    post:',
        '      responses:',
        '        "200":',
        '          description: OK'
      ].join('\n')
    }));

    const result = await resolveSwaggerDocument({ url: 'https://api.example.com/swagger.yaml', fetcher });

    expect(result.document.swagger).toBe('2.0');
    expect(result.document.paths['/login'].post).toBeDefined();
  });

  it('discovers a spec from Swagger UI configUrl', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Config API', version: '1' },
      paths: { '/users': { get: { responses: { 200: { description: 'OK' } } } } }
    };
    const fetcher = jest.fn(({ url }) => {
      if (url === 'https://docs.example.com/api') {
        return Promise.resolve({
          url,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<script>SwaggerUIBundle({ configUrl: "/swagger-config.json" })</script>'
        });
      }
      if (url === 'https://docs.example.com/swagger-config.json') {
        return Promise.resolve(jsonResponse({ url: '/v3/api-docs' }, url));
      }
      return Promise.resolve(jsonResponse(spec, url));
    });

    const result = await resolveSwaggerDocument({ url: 'https://docs.example.com/api', fetcher });

    expect(result.document.info.title).toBe('Config API');
    expect(fetcher.mock.calls.map(([arg]) => arg.url)).toEqual([
      'https://docs.example.com/api',
      'https://docs.example.com/swagger-config.json',
      'https://docs.example.com/v3/api-docs'
    ]);
  });

  it('discovers a spec from linked swagger-initializer.js', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Initializer API', version: '1' },
      paths: { '/health': { get: { responses: { 200: { description: 'OK' } } } } }
    };
    const fetcher = jest.fn(({ url }) => {
      if (url === 'https://docs.example.com/swagger-ui/') {
        return Promise.resolve({
          url,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<script src="./swagger-initializer.js"></script>'
        });
      }
      if (url === 'https://docs.example.com/swagger-ui/swagger-initializer.js') {
        return Promise.resolve({
          url,
          status: 200,
          headers: { 'content-type': 'application/javascript' },
          body: 'window.ui = SwaggerUIBundle({ url: "../openapi.json" });'
        });
      }
      return Promise.resolve(jsonResponse(spec, url));
    });

    const result = await resolveSwaggerDocument({ url: 'https://docs.example.com/swagger-ui/', fetcher });

    expect(result.document.info.title).toBe('Initializer API');
  });

  it('rejects external refs before conversion', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'External', version: '1' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: 'https://schemas.example.com/pet.json' }
                  }
                }
              }
            }
          }
        }
      }
    };

    await expect(resolveSwaggerDocument({
      url: 'https://api.example.com/openapi.json',
      fetcher: () => Promise.resolve(jsonResponse(spec))
    })).rejects.toThrow('External $ref is not supported');
  });

  it('rejects unsupported OpenAPI versions with a clear error', async () => {
    const spec = {
      openapi: '4.0.0',
      info: { title: 'Future', version: '1' },
      paths: {}
    };

    await expect(resolveSwaggerDocument({
      url: 'https://api.example.com/openapi.json',
      fetcher: () => Promise.resolve(jsonResponse(spec))
    })).rejects.toThrow('Unsupported Swagger/OpenAPI version: 4.0.0');
  });

  it('rejects credential-bearing URLs', async () => {
    await expect(resolveSwaggerDocument({
      url: 'https://api.example.com/openapi.json?access_token=secret',
      fetcher: jest.fn()
    })).rejects.toThrow('credential-bearing URL query parameter');
  });

  it('rejects unsafe redirect targets in the default fetcher', async () => {
    const get = jest.fn((url) => Promise.resolve({
      status: 302,
      headers: { location: 'ftp://evil.example.com/openapi.json' },
      data: Buffer.from(''),
      request: { res: { responseUrl: url } }
    }));
    try {
      const fetcher = await createDefaultFetcherWithGet(get);
      await expect(fetcher({ url: 'https://api.example.com/openapi.json', timeout: 1000 }))
        .rejects.toThrow('only supports http and https URLs');
    } finally {
      jest.dontMock('../network/cert-utils');
      jest.dontMock('../network/axios-instance');
      jest.resetModules();
    }
  });

  it('rejects credential-bearing redirect targets in the default fetcher', async () => {
    const get = jest.fn((url) => Promise.resolve({
      status: 302,
      headers: { location: 'https://api.example.com/openapi.json?api_key=secret' },
      data: Buffer.from(''),
      request: { res: { responseUrl: url } }
    }));
    try {
      const fetcher = await createDefaultFetcherWithGet(get);
      await expect(fetcher({ url: 'https://api.example.com/openapi.json', timeout: 1000 }))
        .rejects.toThrow('credential-bearing URL query parameter');
    } finally {
      jest.dontMock('../network/cert-utils');
      jest.dontMock('../network/axios-instance');
      jest.resetModules();
    }
  });

  it('uses one shared deadline across redirect hops in the default fetcher', async () => {
    const originalNow = Date.now;
    const times = [0, 29_999, 30_001];
    Date.now = jest.fn(() => times.shift() ?? 30_001);
    const get = jest.fn((url) => Promise.resolve({
      status: 302,
      headers: { location: '/next.json' },
      data: Buffer.from(''),
      request: { res: { responseUrl: url } }
    }));

    try {
      const fetcher = await createDefaultFetcherWithGet(get);
      await expect(fetcher({ url: 'https://api.example.com/openapi.json', timeout: () => {
        const remaining = 30_000 - Date.now();
        if (remaining <= 0) {
          throw new Error('deadline passed');
        }
        return remaining;
      } })).rejects.toThrow('deadline passed');
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalNow;
      jest.dontMock('../network/cert-utils');
      jest.dontMock('../network/axios-instance');
      jest.resetModules();
    }
  });

  it('validates final URLs returned by injected fetchers', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Injected', version: '1' },
      paths: { '/ok': { get: { responses: { 200: { description: 'OK' } } } } }
    };

    await expect(resolveSwaggerDocument({
      url: 'https://api.example.com/openapi.json',
      fetcher: () => Promise.resolve({
        url: 'https://api.example.com/openapi.json?api_key=secret',
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec)
      })
    })).rejects.toThrow('credential-bearing URL query parameter');
  });
});
