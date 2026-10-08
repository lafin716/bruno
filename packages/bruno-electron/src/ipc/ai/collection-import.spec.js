const {
  importOpenApiWithAi,
  parsePlanJson,
  validatePlan
} = require('./collection-import');

const makeFetcher = (spec, sourceUrl = 'https://api.example.com/openapi.json') => jest.fn(() => Promise.resolve({
  url: sourceUrl,
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(spec)
}));

const findFolder = (collection, name) => collection.items.find((item) => item.type === 'folder' && item.name === name);

const findRequest = (items, name) => {
  for (const item of items) {
    if (item.type === 'http-request' && item.name === name) {
      return item;
    }
    if (item.items) {
      const child = findRequest(item.items, name);
      if (child) {
        return child;
      }
    }
  }
  return null;
};

const envVariable = (collection, name) => collection.environments
  .flatMap((env) => env.variables || [])
  .find((variable) => variable.name === name);

describe('ipc/ai/collection-import', () => {
  it('parses fenced AI JSON output', () => {
    expect(parsePlanJson('```json\n{"groups":[],"tokenCaptures":[],"warnings":[]}\n```')).toEqual({
      groups: [],
      tokenCaptures: [],
      warnings: []
    });
  });

  it('rejects missing, duplicate and unknown endpoint assignments', () => {
    const endpoints = [
      { id: 'GET /users' },
      { id: 'POST /users' }
    ];

    expect(() => validatePlan({
      groups: [{ name: 'Users', endpointIds: ['GET /users', 'GET /users'] }],
      tokenCaptures: []
    }, endpoints)).toThrow('assigns endpoint more than once');

    expect(() => validatePlan({
      groups: [{ name: 'Users', endpointIds: ['GET /users', 'DELETE /users'] }],
      tokenCaptures: []
    }, endpoints)).toThrow('unknown endpoint');

    expect(() => validatePlan({
      groups: [{ name: '../Users', endpointIds: ['GET /users', 'POST /users'] }],
      tokenCaptures: []
    }, endpoints)).toThrow('unsafe group');
  });

  it('rejects unsafe token capture paths and variables', () => {
    const endpoints = [{ id: 'POST /login' }];

    expect(() => validatePlan({
      groups: [{ name: 'Auth', endpointIds: ['POST /login'] }],
      tokenCaptures: [{ endpointId: 'POST /login', path: ['__proto__'], variable: 'token' }]
    }, endpoints)).toThrow('unsafe path');

    expect(() => validatePlan({
      groups: [{ name: 'Auth', endpointIds: ['POST /login'] }],
      tokenCaptures: [{ endpointId: 'POST /login', path: ['token'], variable: 'token-name' }]
    }, endpoints)).toThrow('unsafe variable');
  });

  it('rejects explicit malformed optional plan fields', () => {
    const endpoints = [{ id: 'GET /users' }];

    expect(() => validatePlan({
      groups: [{ name: 'Users', endpointIds: ['GET /users'] }],
      tokenCaptures: {}
    }, endpoints)).toThrow('tokenCaptures must be an array');

    expect(() => validatePlan({
      groups: [{ name: 'Users', endpointIds: ['GET /users'] }],
      tokenCaptures: [],
      warnings: 'check this'
    }, endpoints)).toThrow('warnings must be an array');

    expect(() => validatePlan({
      groups: [{ name: 'Users', endpointIds: ['GET /users'] }],
      tokenCaptures: [],
      warnings: [42]
    }, endpoints)).toThrow('warnings must contain only strings');
  });

  it('imports OpenAPI with AI folders, restored names, auth, environments and token script', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Shop API', version: '1' },
      servers: [
        { url: '/v1', description: 'Relative server' }
      ],
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer' }
        },
        schemas: {
          LoginResponse: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' }
                }
              }
            }
          }
        }
      },
      security: [{ BearerAuth: [] }],
      paths: {
        '/auth/login': {
          post: {
            summary: 'Login user',
            security: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' }
                    }
                  }
                }
              }
            },
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/LoginResponse' }
                  }
                }
              }
            }
          }
        },
        '/orders/{id}': {
          get: {
            operationId: 'getOrder',
            summary: 'Get order',
            responses: {
              200: { description: 'OK' }
            }
          }
        }
      }
    };
    const generate = jest.fn(() => Promise.resolve(JSON.stringify({
      groups: [
        { name: 'Authentication', endpointIds: ['POST /auth/login'] },
        { name: 'Orders', endpointIds: ['GET /orders/{id}'] }
      ],
      tokenCaptures: [
        { endpointId: 'POST /auth/login', path: ['data', 'accessToken'], variable: 'accessToken' }
      ],
      warnings: ['Review generated token capture before running login.']
    })));

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/docs/openapi.json',
      fetcher: makeFetcher(spec, 'https://api.example.com/docs/openapi.json'),
      generate
    });

    const authFolder = findFolder(result.collection, 'Authentication');
    const ordersFolder = findFolder(result.collection, 'Orders');
    const login = findRequest(result.collection.items, 'Login user');
    const order = findRequest(result.collection.items, 'Get order');

    expect(authFolder.items).toHaveLength(1);
    expect(ordersFolder.items).toHaveLength(1);
    expect(login).toBeDefined();
    expect(order).toBeDefined();
    expect(login.request.auth.mode).toBe('none');
    expect(result.collection.root.request.auth.mode).toBe('bearer');
    expect(result.collection.environments[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'baseUrl', value: 'https://api.example.com/v1', secret: false }),
      expect.objectContaining({ name: 'accessToken', value: '', secret: true })
    ]));
    expect(result.collection.root.request.auth.bearer.token).toBe('{{accessToken}}');
    expect(login.request.script.res).toContain('if (status >= 200 && status < 300)');
    expect(login.request.script.res).toContain('const token = body?.["data"]?.["accessToken"];');
    expect(login.request.script.res).toContain('bru.setVar("accessToken", token);');
    expect(order.request.url).toContain('/orders/:id');
    expect(result.summary).toEqual(expect.arrayContaining([
      'Imported 2 endpoints from Shop API',
      'Organized into 2 folders',
      'Added 1 environment with 1 auth variable placeholder'
    ]));
    expect(result.warnings).toContain('Review generated token capture before running login.');
    expect(generate.mock.calls[0][0]).not.toContain('hunter2');
    expect(generate.mock.calls[0][0]).toContain('openapi-collection-organizer');
  });

  it('skips token captures whose response path is not documented', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Auth API', version: '1' },
      paths: {
        '/login': {
          post: {
            summary: 'Login',
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { ok: { type: 'boolean' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['POST /login'] }],
        tokenCaptures: [{ endpointId: 'POST /login', path: ['data', 'token'], variable: 'token' }],
        warnings: []
      }))
    });

    const login = findRequest(result.collection.items, 'Login');
    expect(login.request.script.res).toBeNull();
    expect(result.collection.environments[0].variables).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'token' })
    ]));
    expect(result.summary).toContain('Configured 0 documented token captures');
    expect(result.warnings[0]).toContain('response path data.token is not documented');
  });

  it('imports Swagger 2 with default baseUrl and api key auth placeholders', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Legacy API', version: '1' },
      securityDefinitions: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
      },
      security: [{ ApiKeyAuth: [] }],
      paths: {
        '/reports': {
          get: {
            summary: 'List reports',
            responses: {
              200: {
                description: 'OK',
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: { type: 'object' } } }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://legacy.example.com/swagger.json',
      fetcher: makeFetcher(spec, 'https://legacy.example.com/swagger.json'),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Reports', endpointIds: ['GET /reports'] }],
        tokenCaptures: [],
        warnings: []
      }))
    });

    const request = findRequest(result.collection.items, 'List reports');
    expect(result.collection.environments[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'baseUrl', value: 'https://legacy.example.com' })
    ]));
    expect(result.collection.root.request.auth.mode).toBe('apikey');
    expect(result.collection.root.request.auth.apikey).toEqual(expect.objectContaining({
      key: 'X-API-Key',
      value: '{{apiKey}}',
      placement: 'header'
    }));
    expect(request.request.auth.mode).toBe('inherit');
    expect(envVariable(result.collection, 'apiKey')).toMatchObject({ name: 'apiKey', value: '', secret: true });
  });

  it('preserves explicit OpenAPI public auth overrides after conversion', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Public API', version: '1' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer' }
        }
      },
      security: [{ BearerAuth: [] }],
      paths: {
        '/login': {
          post: {
            summary: 'Public login',
            security: [{}],
            responses: { 200: { description: 'OK' } }
          }
        },
        '/users': {
          get: {
            summary: 'List users',
            responses: { 200: { description: 'OK' } }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'API', endpointIds: ['POST /login', 'GET /users'] }],
        tokenCaptures: [],
        warnings: []
      }))
    });

    expect(findRequest(result.collection.items, 'Public login').request.auth.mode).toBe('none');
    expect(findRequest(result.collection.items, 'List users').request.auth.mode).toBe('inherit');
    expect(result.collection.root.request.auth.mode).toBe('bearer');
  });

  it('preserves explicit Swagger 2 public auth overrides after conversion', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Swagger Public API', version: '1' },
      securityDefinitions: {
        apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' }
      },
      security: [{ apiKey: [] }],
      paths: {
        '/login': {
          post: {
            summary: 'Swagger login',
            security: [],
            responses: { 200: { description: 'OK' } }
          }
        },
        '/reports': {
          get: {
            summary: 'Swagger reports',
            responses: { 200: { description: 'OK' } }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/swagger.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'API', endpointIds: ['POST /login', 'GET /reports'] }],
        tokenCaptures: [],
        warnings: []
      }))
    });

    expect(findRequest(result.collection.items, 'Swagger login').request.auth.mode).toBe('none');
    expect(findRequest(result.collection.items, 'Swagger reports').request.auth.mode).toBe('inherit');
    expect(result.collection.root.request.auth.mode).toBe('apikey');
  });

  it('maps token captures by synthetic request name instead of URL suffixes', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Collision API', version: '1' },
      paths: {
        '/auth/login': {
          post: {
            summary: 'Login',
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { token: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        },
        '/admin/auth/login': {
          post: {
            summary: 'Admin login',
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { token: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['POST /auth/login', 'POST /admin/auth/login'] }],
        tokenCaptures: [{ endpointId: 'POST /auth/login', path: ['token'], variable: 'token' }],
        warnings: []
      }))
    });

    const login = findRequest(result.collection.items, 'Login');
    const adminLogin = findRequest(result.collection.items, 'Admin login');
    expect(login.request.script.res).toContain('bru.setVar("token", token);');
    expect(adminLogin.request.script.res).toBeNull();
  });

  it('adds auth placeholders for converter auth templates without captures', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Auth Placeholders', version: '1' },
      components: {
        securitySchemes: {
          ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          BasicAuth: { type: 'http', scheme: 'basic' },
          OAuth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { read: 'Read' }
              }
            }
          }
        }
      },
      paths: {
        '/apikey': { get: { summary: 'API key', security: [{ ApiKey: [] }], responses: { 200: { description: 'OK' } } } },
        '/basic': { get: { summary: 'Basic', security: [{ BasicAuth: [] }], responses: { 200: { description: 'OK' } } } },
        '/oauth': { get: { summary: 'OAuth', security: [{ OAuth: ['read'] }], responses: { 200: { description: 'OK' } } } }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['GET /apikey', 'GET /basic', 'GET /oauth'] }],
        tokenCaptures: [],
        warnings: []
      }))
    });

    ['apiKey', 'username', 'password', 'oauth_callback_url', 'oauth_client_id', 'oauth_client_secret', 'oauth_state']
      .forEach((name) => expect(envVariable(result.collection, name)).toMatchObject({ name, value: '', secret: true }));
    expect(envVariable(result.collection, 'baseUrl')).toMatchObject({ name: 'baseUrl', secret: false });
    expect(result.summary).toEqual(expect.arrayContaining([
      'Added 1 environment with 8 auth variable placeholders'
    ]));
  });

  it('does not wire bearer auth to refresh-only captures', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Refresh API', version: '1' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer' }
        }
      },
      security: [{ BearerAuth: [] }],
      paths: {
        '/auth/refresh': {
          post: {
            summary: 'Refresh',
            security: [],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { refreshToken: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['POST /auth/refresh'] }],
        tokenCaptures: [{ endpointId: 'POST /auth/refresh', path: ['refreshToken'], variable: 'refreshToken' }],
        warnings: []
      }))
    });

    expect(result.collection.root.request.auth.bearer.token).toBe('{{token}}');
    expect(envVariable(result.collection, 'refreshToken')).toMatchObject({ name: 'refreshToken', value: '', secret: true });
    expect(envVariable(result.collection, 'token')).toMatchObject({ name: 'token', value: '', secret: true });
    expect(result.warnings).toContain('Bearer auth placeholder was not rewired because token captures did not identify exactly one access token');
  });

  it('skips refresh token captures that would overwrite the bearer token variable', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Refresh Collision API', version: '1' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer' }
        }
      },
      security: [{ BearerAuth: [] }],
      paths: {
        '/auth/refresh': {
          post: {
            summary: 'Refresh token',
            security: [],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { refreshToken: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['POST /auth/refresh'] }],
        tokenCaptures: [{ endpointId: 'POST /auth/refresh', path: ['refreshToken'], variable: 'token' }],
        warnings: []
      }))
    });

    const request = findRequest(result.collection.items, 'Refresh token');
    expect(request.request.script.res).toBeNull();
    expect(result.collection.root.request.auth.bearer.token).toBe('{{token}}');
    expect(envVariable(result.collection, 'token')).toMatchObject({ name: 'token', value: '', secret: true });
    expect(result.warnings[0]).toContain('refreshToken cannot be stored as bearer token variable');
    expect(result.summary).toContain('Configured 0 documented token captures');
  });

  it('keeps generic token captures for actual access tokens', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Generic Token API', version: '1' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer' }
        }
      },
      security: [{ BearerAuth: [] }],
      paths: {
        '/auth/login': {
          post: {
            summary: 'Token login',
            security: [],
            responses: {
              200: {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { token: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(spec),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Auth', endpointIds: ['POST /auth/login'] }],
        tokenCaptures: [{ endpointId: 'POST /auth/login', path: ['token'], variable: 'token' }],
        warnings: []
      }))
    });

    expect(findRequest(result.collection.items, 'Token login').request.script.res).toContain('bru.setVar("token", token);');
    expect(result.collection.root.request.auth.bearer.token).toBe('{{token}}');
    expect(result.warnings).toEqual([]);
  });

  it('rejects path-item and operation refs before prompting the model', async () => {
    const pathItemRefSpec = {
      openapi: '3.0.3',
      info: { title: 'Ref API', version: '1' },
      paths: {
        '/users': { $ref: '#/components/pathItems/Users' }
      },
      components: {
        pathItems: {
          Users: {
            get: {
              summary: 'Users',
              responses: { 200: { description: 'OK' } }
            }
          }
        }
      }
    };
    const operationRefSpec = {
      openapi: '3.0.3',
      info: { title: 'Ref API', version: '1' },
      paths: {
        '/users': {
          get: { $ref: '#/components/operations/getUsers' }
        }
      },
      components: {
        operations: {
          getUsers: {
            summary: 'Users',
            responses: { 200: { description: 'OK' } }
          }
        }
      }
    };
    const generate = jest.fn();

    await expect(importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(pathItemRefSpec),
      generate
    })).rejects.toThrow('Unsupported path-item $ref at /users');

    await expect(importOpenApiWithAi({
      url: 'https://api.example.com/openapi.json',
      fetcher: makeFetcher(operationRefSpec),
      generate
    })).rejects.toThrow('Unsupported operation $ref at GET /users');

    expect(generate).not.toHaveBeenCalled();
  });

  it('resolves global, path and operation servers against the spec URL while preserving templates', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Server API', version: '1' },
      servers: [{
        url: './{stage}',
        variables: { stage: { default: 'v1' } }
      }],
      paths: {
        '/files': {
          servers: [{ url: './path-scope' }],
          get: {
            summary: 'Get files',
            servers: [{
              url: '../files/{region}',
              variables: { region: { default: 'us' } }
            }],
            responses: { 200: { description: 'OK' } }
          }
        }
      }
    };

    const result = await importOpenApiWithAi({
      url: 'https://api.example.com/docs/openapi.json',
      fetcher: makeFetcher(spec, 'https://api.example.com/docs/openapi.json'),
      generate: () => Promise.resolve(JSON.stringify({
        groups: [{ name: 'Files', endpointIds: ['GET /files'] }],
        tokenCaptures: [],
        warnings: []
      }))
    });

    const baseUrl = envVariable(result.collection, 'baseUrl');
    const request = findRequest(result.collection.items, 'Get files');
    expect(baseUrl.value).toBe('https://api.example.com/docs/{{stage}}');
    expect(envVariable(result.collection, 'stage')).toMatchObject({ name: 'stage', value: 'v1' });
    expect(request.request.vars.req).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'baseUrl', value: 'https://api.example.com/files/{{region}}' }),
      expect.objectContaining({ name: 'region', value: 'us' })
    ]));
  });
});
