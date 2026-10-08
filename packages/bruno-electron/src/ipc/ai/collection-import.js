const fs = require('fs');
const path = require('path');
const { customAlphabet } = require('nanoid');
const { openApiToBruno } = require('@usebruno/converters');
const { collectionSchema } = require('@usebruno/schema');
const { resolveSwaggerDocument, getJsonPointer, SUPPORTED_METHODS } = require('./swagger-resolver');

const SKILL_PATH = path.join(__dirname, 'skills', 'openapi-collection', 'SKILL.md');
const SYNTHETIC_PREFIX = 'AI endpoint ';
const TOKEN_PATH_MAX_DEPTH = 20;
const TOKEN_VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const uid = customAlphabet('useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict', 21);

const readSkillInstructions = () => fs.readFileSync(SKILL_PATH, 'utf8');

const safeString = (value) => (typeof value === 'string' ? value : '');

const sanitizeName = (value) => safeString(value)
  .replace(/[\r\n\s]+/g, ' ')
  .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, ' ')
  .trim()
  .replace(/[.\s]+$/, '')
  .slice(0, 120)
  .trim();

const normalizeName = (value, fallback) => {
  const name = sanitizeName(value);
  const fallbackName = sanitizeName(fallback);
  return name || fallbackName || 'Request';
};

const makeUniqueName = (name, usedNames) => {
  let candidate = name;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${name} (${counter})`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
};

const isSafeFolderName = (value) => {
  if (!value || typeof value !== 'string' || value.length > 80) {
    return false;
  }
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    return false;
  }
  if (/[<>:"|?*\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  return value.trim() === value && !/[.\s]$/.test(value);
};

const getVersionKind = (document) => (document.swagger === '2.0' ? 'swagger2' : 'openapi3');

const supportedMethod = (method) => SUPPORTED_METHODS.includes(method.toLowerCase());

const operationIdFor = (method, originalPath) => `${method.toUpperCase()} ${originalPath}`;

const rejectUnsupportedOperationRefs = (document) => {
  Object.entries(document.paths || {}).forEach(([originalPath, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    if (typeof pathItem.$ref === 'string') {
      throw new Error(`Unsupported path-item $ref at ${originalPath}: resolve it before AI import`);
    }
    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!supportedMethod(method) || !operation || typeof operation !== 'object') {
        return;
      }
      if (typeof operation.$ref === 'string') {
        throw new Error(`Unsupported operation $ref at ${operationIdFor(method, originalPath)}: resolve it before AI import`);
      }
    });
  });
};

const getOperations = (document) => {
  rejectUnsupportedOperationRefs(document);
  const operations = [];
  Object.entries(document.paths || {}).forEach(([originalPath, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!supportedMethod(method) || !operation || typeof operation !== 'object') {
        return;
      }
      operations.push({
        id: operationIdFor(method, originalPath),
        method: method.toUpperCase(),
        path: originalPath,
        operation
      });
    });
  });
  return operations;
};

const schemaShape = (schema, document, depth = 0, seenRefs = new Set()) => {
  if (!schema || typeof schema !== 'object' || depth > 5) {
    return undefined;
  }

  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) {
      return { ref: schema.$ref };
    }
    const resolved = getJsonPointer(document, schema.$ref);
    if (!resolved) {
      return { ref: schema.$ref };
    }
    seenRefs.add(schema.$ref);
    const shape = schemaShape(resolved, document, depth + 1, seenRefs);
    seenRefs.delete(schema.$ref);
    return shape;
  }

  if (schema.type === 'object' || schema.properties) {
    const properties = {};
    Object.entries(schema.properties || {}).forEach(([key, prop]) => {
      properties[key] = schemaShape(prop, document, depth + 1, seenRefs) || { type: prop?.type || 'unknown' };
    });
    return { type: 'object', properties };
  }

  if (schema.type === 'array') {
    return { type: 'array', items: schemaShape(schema.items, document, depth + 1, seenRefs) || { type: 'unknown' } };
  }

  if (schema.oneOf || schema.anyOf || schema.allOf) {
    const variants = schema.oneOf || schema.anyOf || schema.allOf;
    return { type: 'composed', variants: variants.slice(0, 3).map((item) => schemaShape(item, document, depth + 1, seenRefs)) };
  }

  return { type: schema.type || 'unknown', format: schema.format };
};

function firstResponseSchema(response, document) {
  if (response?.schema) {
    return schemaShape(response.schema, document);
  }
  const firstContent = response?.content && Object.values(response.content)[0];
  if (firstContent?.schema) {
    return schemaShape(firstContent.schema, document);
  }
  return undefined;
}

const sanitizeOperationForPrompt = ({ id, method, path: operationPath, operation }, document) => {
  const parameters = (operation.parameters || []).map((param) => ({
    name: param.name,
    in: param.in,
    required: !!param.required,
    type: param.schema?.type || param.type
  }));

  const requestBody = operation.requestBody?.content
    ? Object.entries(operation.requestBody.content).map(([contentType, content]) => ({
        contentType,
        schema: schemaShape(content.schema, document)
      }))
    : [];

  const responses = Object.entries(operation.responses || {}).map(([status, response]) => ({
    status,
    contentTypes: response.content ? Object.keys(response.content) : Object.keys(response.examples || {}),
    schema: firstResponseSchema(response, document)
  }));

  return {
    id,
    method,
    path: operationPath,
    summary: safeString(operation.summary),
    operationId: safeString(operation.operationId),
    tags: Array.isArray(operation.tags) ? operation.tags.filter((tag) => typeof tag === 'string') : [],
    parameters,
    requestBody,
    responses
  };
};

const buildPrompt = ({ document, endpoints }) => {
  const summary = {
    title: safeString(document.info?.title),
    version: safeString(document.info?.version),
    format: getVersionKind(document),
    endpoints: endpoints.map((endpoint) => sanitizeOperationForPrompt(endpoint, document))
  };

  return [
    readSkillInstructions(),
    '',
    'Return only JSON that matches this shape:',
    '{"groups":[{"name":"Folder","endpointIds":["GET /path"]}],"tokenCaptures":[{"endpointId":"POST /auth/login","path":["data","token"],"variable":"token"}],"warnings":[]}',
    '',
    'OpenAPI structural summary with examples and default values removed:',
    JSON.stringify(summary, null, 2)
  ].join('\n');
};

const parsePlanJson = (text) => {
  if (!text || typeof text !== 'string') {
    throw new Error('AI returned an empty OpenAPI organization plan');
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`AI returned malformed OpenAPI organization JSON: ${err.message}`);
  }
};

const validateTokenPath = (pathSegments) => {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0 || pathSegments.length > TOKEN_PATH_MAX_DEPTH) {
    return false;
  }
  return pathSegments.every((segment) => (
    typeof segment === 'string'
    && segment.length > 0
    && !FORBIDDEN_PATH_SEGMENTS.has(segment)
    && !/[\u0000-\u001f\u007f]/.test(segment)
  ));
};

const validatePlan = (plan, endpoints) => {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.groups)) {
    throw new Error('AI OpenAPI organization plan must include a groups array');
  }

  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  const assigned = new Set();
  const groupNames = new Set();

  plan.groups.forEach((group) => {
    if (!group || typeof group !== 'object' || !isSafeFolderName(group.name) || !Array.isArray(group.endpointIds)) {
      throw new Error('AI OpenAPI organization plan contains an unsafe group');
    }
    const normalizedGroupName = group.name.toLowerCase();
    if (groupNames.has(normalizedGroupName)) {
      throw new Error(`AI OpenAPI organization plan contains duplicate group: ${group.name}`);
    }
    groupNames.add(normalizedGroupName);

    group.endpointIds.forEach((endpointId) => {
      if (!endpointIds.has(endpointId)) {
        throw new Error(`AI OpenAPI organization plan references unknown endpoint: ${endpointId}`);
      }
      if (assigned.has(endpointId)) {
        throw new Error(`AI OpenAPI organization plan assigns endpoint more than once: ${endpointId}`);
      }
      assigned.add(endpointId);
    });
  });

  endpoints.forEach((endpoint) => {
    if (!assigned.has(endpoint.id)) {
      throw new Error(`AI OpenAPI organization plan omitted endpoint: ${endpoint.id}`);
    }
  });

  if (Object.prototype.hasOwnProperty.call(plan, 'tokenCaptures') && !Array.isArray(plan.tokenCaptures)) {
    throw new Error('AI OpenAPI organization plan tokenCaptures must be an array');
  }
  if (Object.prototype.hasOwnProperty.call(plan, 'warnings') && !Array.isArray(plan.warnings)) {
    throw new Error('AI OpenAPI organization plan warnings must be an array');
  }

  const tokenCaptures = plan.tokenCaptures || [];
  tokenCaptures.forEach((capture) => {
    if (!capture || typeof capture !== 'object') {
      throw new Error('AI OpenAPI organization plan contains an invalid token capture');
    }
    if (!endpointIds.has(capture.endpointId)) {
      throw new Error(`AI OpenAPI organization plan token capture references unknown endpoint: ${capture.endpointId}`);
    }
    if (!TOKEN_VARIABLE_RE.test(capture.variable || '')) {
      throw new Error(`AI OpenAPI organization plan token capture uses unsafe variable: ${capture.variable}`);
    }
    if (!validateTokenPath(capture.path)) {
      throw new Error(`AI OpenAPI organization plan token capture has unsafe path for ${capture.endpointId}`);
    }
  });

  const warnings = (plan.warnings || []).map((warning) => {
    if (typeof warning !== 'string') {
      throw new Error('AI OpenAPI organization plan warnings must contain only strings');
    }
    return warning.trim();
  }).filter(Boolean);

  return {
    groups: plan.groups.map((group) => ({ name: group.name, endpointIds: [...group.endpointIds] })),
    tokenCaptures,
    warnings
  };
};

const applyServerDefaults = (document, sourceUrl) => {
  const source = new URL(sourceUrl);
  const defaultBaseUrl = `${source.protocol}//${source.host}`;

  if (document.openapi) {
    if (!Array.isArray(document.servers) || !document.servers.length) {
      document.servers = [{ url: defaultBaseUrl }];
    }
    resolveOpenApiServers(document, sourceUrl);
  } else if (document.swagger === '2.0') {
    if (!document.host) {
      document.host = source.host;
    }
    if (!Array.isArray(document.schemes) || !document.schemes.length) {
      document.schemes = [source.protocol.replace(':', '')];
    }
  }
};

const maskServerTemplateVariables = (value) => {
  const variables = [];
  const masked = value.replace(/{([^}]+)}/g, (match) => {
    const token = `brunoservervar${variables.length}bruno`;
    variables.push({ token, value: match });
    return token;
  });
  return { masked, variables };
};

const unmaskServerTemplateVariables = (value, variables) => {
  return variables.reduce((result, variable) => {
    return result.replace(new RegExp(variable.token, 'gi'), variable.value);
  }, value);
};

const resolveServerUrl = (serverUrl, sourceUrl) => {
  if (typeof serverUrl !== 'string' || !serverUrl.length) {
    return serverUrl;
  }
  const { masked, variables } = maskServerTemplateVariables(serverUrl);
  const resolved = /^https?:\/\//i.test(masked) ? masked : new URL(masked, sourceUrl).toString();
  return unmaskServerTemplateVariables(resolved.replace(/\/$/, ''), variables);
};

const resolveServerList = (servers, sourceUrl) => {
  if (!Array.isArray(servers)) {
    return servers;
  }
  return servers.map((server) => {
    if (!server || typeof server.url !== 'string') {
      return server;
    }
    return { ...server, url: resolveServerUrl(server.url, sourceUrl) };
  });
};

function resolveOpenApiServers(document, sourceUrl) {
  document.servers = resolveServerList(document.servers, sourceUrl);
  Object.values(document.paths || {}).forEach((pathItem) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    pathItem.servers = resolveServerList(pathItem.servers, sourceUrl);
    Object.entries(pathItem).forEach(([method, operation]) => {
      if (!supportedMethod(method) || !operation || typeof operation !== 'object') {
        return;
      }
      operation.servers = resolveServerList(operation.servers, sourceUrl);
      (operation['x-bruno-variants'] || []).forEach((variant) => {
        if (variant && typeof variant === 'object') {
          variant.servers = resolveServerList(variant.servers, sourceUrl);
        }
      });
    });
  });
}

const applySyntheticOrganization = ({ document, endpoints, plan }) => {
  const endpointToGroup = new Map();
  plan.groups.forEach((group) => {
    group.endpointIds.forEach((endpointId) => endpointToGroup.set(endpointId, group.name));
  });

  const metadata = new Map();
  endpoints.forEach((endpoint, index) => {
    const syntheticName = `${SYNTHETIC_PREFIX}${index + 1}`;
    const groupName = endpointToGroup.get(endpoint.id);
    metadata.set(syntheticName, {
      endpointId: endpoint.id,
      originalName: normalizeName(endpoint.operation.summary || endpoint.operation.operationId, endpoint.id),
      groupName
    });

    endpoint.operation['x-ai-import-original-summary'] = endpoint.operation.summary;
    endpoint.operation.summary = syntheticName;
    endpoint.operation.tags = [groupName];
  });

  document.tags = plan.groups.map((group) => ({ name: group.name }));
  return metadata;
};

const collectRequests = (items = [], requests = []) => {
  items.forEach((item) => {
    if (item && item.type === 'http-request' && item.request) {
      requests.push(item);
    }
    if (Array.isArray(item?.items)) {
      collectRequests(item.items, requests);
    }
  });
  return requests;
};

const mapRequestsByEndpointId = (collection, metadata) => {
  const requests = collectRequests(collection.items);
  const endpointRequestMap = new Map();
  metadata.forEach((match, syntheticName) => {
    const matches = requests.filter((request) => request.name === syntheticName);
    if (matches.length !== 1) {
      throw new Error(`Converted request mapping failed for ${match.endpointId}: expected 1 match, found ${matches.length}`);
    }
    if (endpointRequestMap.has(match.endpointId)) {
      throw new Error(`Converted request mapping duplicated endpoint: ${match.endpointId}`);
    }
    endpointRequestMap.set(match.endpointId, matches[0]);
  });
  if (endpointRequestMap.size !== metadata.size) {
    throw new Error('Converted request mapping did not cover every endpoint');
  }
  return endpointRequestMap;
};

const hasAnonymousSecurityAlternative = (security) => {
  return Array.isArray(security) && security.some((alternative) => {
    return alternative && typeof alternative === 'object' && Object.keys(alternative).length === 0;
  });
};

const isEffectivePublicOperation = (operation, document) => {
  if (Array.isArray(operation.security)) {
    return operation.security.length === 0 || hasAnonymousSecurityAlternative(operation.security);
  }
  if (Array.isArray(document.security)) {
    return hasAnonymousSecurityAlternative(document.security);
  }
  return false;
};

const applyPublicAuthOverrides = ({ endpointRequestMap, endpointsById, document }) => {
  endpointRequestMap.forEach((request, endpointId) => {
    const endpoint = endpointsById.get(endpointId);
    if (!endpoint || !isEffectivePublicOperation(endpoint.operation, document)) {
      return;
    }
    request.request.auth = {
      mode: 'none',
      basic: null,
      bearer: null,
      digest: null,
      apikey: null,
      oauth2: null
    };
  });
};

const restoreRequestNames = (collection, metadata) => {
  const requests = collectRequests(collection.items);
  const usedNames = new Set();
  requests.forEach((request) => {
    const match = metadata.get(request.name);
    if (match) {
      request.name = makeUniqueName(normalizeName(match.originalName, match.endpointId), usedNames);
    } else {
      usedNames.add(request.name);
    }
  });
};

const responseCandidates = (operation) => {
  return Object.entries(operation.responses || {})
    .filter(([status]) => status === 'default' || (Number(status) >= 200 && Number(status) < 300))
    .map(([, response]) => response);
};

const schemaHasPath = (schema, pathSegments, document, seenRefs = new Set()) => {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) {
      return false;
    }
    const resolved = getJsonPointer(document, schema.$ref);
    seenRefs.add(schema.$ref);
    const result = schemaHasPath(resolved, pathSegments, document, seenRefs);
    seenRefs.delete(schema.$ref);
    return result;
  }
  if (!pathSegments.length) {
    return true;
  }
  const [head, ...tail] = pathSegments;
  if (schema.type === 'array') {
    return schemaHasPath(schema.items, pathSegments, document, seenRefs);
  }
  if (schema.properties && schema.properties[head]) {
    return schemaHasPath(schema.properties[head], tail, document, seenRefs);
  }
  return false;
};

const exampleHasPath = (example, pathSegments) => {
  let current = example;
  for (const segment of pathSegments) {
    if (Array.isArray(current)) {
      current = current[0];
    }
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return true;
};

const responseDocumentsPath = (operation, pathSegments, document) => {
  return responseCandidates(operation).some((response) => {
    if (response.schema && schemaHasPath(response.schema, pathSegments, document)) {
      return true;
    }
    if (response.examples && Object.values(response.examples).some((example) => exampleHasPath(example, pathSegments))) {
      return true;
    }
    return Object.values(response.content || {}).some((content) => {
      if (content.schema && schemaHasPath(content.schema, pathSegments, document)) {
        return true;
      }
      if (content.example !== undefined && exampleHasPath(content.example, pathSegments)) {
        return true;
      }
      return Object.values(content.examples || {}).some((example) => {
        const value = example && typeof example === 'object' && Object.prototype.hasOwnProperty.call(example, 'value')
          ? example.value
          : example;
        return exampleHasPath(value, pathSegments);
      });
    });
  });
};

const pathExpression = (pathSegments) => pathSegments.map((segment) => `?.[${JSON.stringify(segment)}]`).join('');

const buildTokenScript = ({ path: tokenPath, variable }) => [
  'const status = typeof res.getStatus === \'function\' ? res.getStatus() : res.status;',
  'if (status >= 200 && status < 300) {',
  '  const body = typeof res.getBody === \'function\' ? res.getBody() : res.body;',
  `  const token = body${pathExpression(tokenPath)};`,
  '  if (typeof token === \'string\' && token.length > 0) {',
  `  bru.setVar(${JSON.stringify(variable)}, token);`,
  '  }',
  '}'
].join('\n');

const applyTokenCaptures = ({ endpointRequestMap, document, endpointsById, tokenCaptures, warnings }) => {
  const appliedCaptures = [];
  tokenCaptures.forEach((capture) => {
    const endpoint = endpointsById.get(capture.endpointId);
    if (!responseDocumentsPath(endpoint.operation, capture.path, document)) {
      warnings.push(`Skipped token capture for ${capture.endpointId}: response path ${capture.path.join('.')} is not documented`);
      return;
    }

    const request = endpointRequestMap.get(capture.endpointId);
    if (!request) {
      warnings.push(`Skipped token capture for ${capture.endpointId}: converted request was not found`);
      return;
    }

    request.request.script = request.request.script || {};
    const existingScript = request.request.script.res;
    const tokenScript = buildTokenScript(capture);
    request.request.script.res = existingScript ? `${existingScript}\n${tokenScript}` : tokenScript;
    appliedCaptures.push(capture);
  });
  return appliedCaptures;
};

const collectTemplateVariables = (value, variableNames = new Set()) => {
  if (typeof value === 'string') {
    const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
    let match;
    while ((match = pattern.exec(value)) !== null) {
      if (match[1] !== 'baseUrl') {
        variableNames.add(match[1]);
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectTemplateVariables(item, variableNames));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectTemplateVariables(item, variableNames));
  }
  return variableNames;
};

const isAuthPlaceholderName = (name) => {
  return [
    'apiKey',
    'username',
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'oauth_authorize_url',
    'oauth_token_url',
    'oauth_refresh_url',
    'oauth_callback_url',
    'oauth_client_id',
    'oauth_client_secret',
    'oauth_state'
  ].includes(name);
};

const isAccessTokenCapture = (capture) => {
  const leaf = capture.path[capture.path.length - 1];
  if (/^(refresh|id)_?token$/i.test(capture.variable) || /^(refresh|id)_?token$/i.test(leaf)) {
    return false;
  }
  return /^access_?token$/i.test(capture.variable)
    || /^token$/i.test(capture.variable)
    || /^access_?token$/i.test(leaf)
    || /^token$/i.test(leaf);
};

const conflictsWithBearerPlaceholder = (capture, collection) => {
  const leaf = capture.path[capture.path.length - 1];
  if (!/^(refresh|id)_?token$/i.test(leaf) || capture.variable !== 'token') {
    return false;
  }
  let hasBearerTokenPlaceholder = collection.root?.request?.auth?.mode === 'bearer'
    && collection.root.request.auth.bearer?.token === '{{token}}';
  collectRequests(collection.items).forEach((request) => {
    if (request.request.auth?.mode === 'bearer' && request.request.auth.bearer?.token === '{{token}}') {
      hasBearerTokenPlaceholder = true;
    }
  });
  return hasBearerTokenPlaceholder;
};

const linkBearerAuthToCapture = (collection, tokenCaptures, warnings) => {
  const accessTokenCaptures = tokenCaptures.filter(isAccessTokenCapture);
  if (accessTokenCaptures.length !== 1) {
    if (tokenCaptures.length > 0) {
      warnings.push('Bearer auth placeholder was not rewired because token captures did not identify exactly one access token');
    }
    return null;
  }
  const tokenVariable = accessTokenCaptures[0].variable;
  const replacement = `{{${tokenVariable}}}`;
  const visitAuth = (auth) => {
    if (auth?.mode === 'bearer' && auth.bearer?.token === '{{token}}') {
      auth.bearer.token = replacement;
    }
  };
  visitAuth(collection.root?.request?.auth);
  collectRequests(collection.items).forEach((request) => visitAuth(request.request.auth));
  return tokenVariable;
};

const removeBearerVariableCollisions = ({ collection, tokenCaptures, warnings }) => {
  return tokenCaptures.filter((capture) => {
    if (!conflictsWithBearerPlaceholder(capture, collection)) {
      return true;
    }
    warnings.push(`Skipped token capture for ${capture.endpointId}: ${capture.path.join('.')} cannot be stored as bearer token variable`);
    return false;
  });
};

const addRuntimeVariablePlaceholders = (collection, tokenCaptures) => {
  const variableNames = new Set([...collectTemplateVariables(collection)].filter(isAuthPlaceholderName));
  tokenCaptures.forEach((capture) => variableNames.add(capture.variable));
  if (!variableNames.size) {
    return;
  }

  if (!collection.environments || !collection.environments.length) {
    collection.environments = [{
      uid: uid(),
      name: 'Environment',
      variables: []
    }];
  }

  collection.environments.forEach((environment) => {
    environment.variables = environment.variables || [];
    const existingNames = new Set(environment.variables.map((variable) => variable.name));
    [...variableNames].sort().forEach((name) => {
      if (!existingNames.has(name)) {
        environment.variables.push({
          uid: uid(),
          name,
          value: '',
          type: 'text',
          enabled: true,
          secret: true
        });
      }
    });
  });
  return variableNames.size;
};

const validateCollection = (collection) => {
  collectionSchema.validateSync(collection);
  return collection;
};

const importOpenApiWithAi = async ({ url, generate, signal, fetcher } = {}) => {
  if (typeof generate !== 'function') {
    throw new Error('importOpenApiWithAi requires a generate(prompt, signal) function');
  }

  const resolved = await resolveSwaggerDocument({ url, signal, fetcher });
  const document = resolved.document;
  applyServerDefaults(document, resolved.sourceUrl);

  const endpoints = getOperations(document);
  if (!endpoints.length) {
    throw new Error('Swagger/OpenAPI document contains no supported endpoints');
  }

  const prompt = buildPrompt({ document, endpoints });
  const plan = validatePlan(parsePlanJson(await generate(prompt, signal)), endpoints);
  const syntheticMetadata = applySyntheticOrganization({ document, endpoints, plan });

  const collection = openApiToBruno(JSON.stringify(document), { groupBy: 'tags' });
  const endpointRequestMap = mapRequestsByEndpointId(collection, syntheticMetadata);
  restoreRequestNames(collection, syntheticMetadata);

  const warnings = [...plan.warnings];
  const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  applyPublicAuthOverrides({ endpointRequestMap, endpointsById, document });
  const safeTokenCaptures = removeBearerVariableCollisions({ collection, tokenCaptures: plan.tokenCaptures, warnings });
  const appliedTokenCaptures = applyTokenCaptures({ endpointRequestMap, document, endpointsById, tokenCaptures: safeTokenCaptures, warnings });
  linkBearerAuthToCapture(collection, appliedTokenCaptures, warnings);
  const authVariableCount = addRuntimeVariablePlaceholders(collection, appliedTokenCaptures) || 0;
  validateCollection(collection);

  return {
    collection,
    summary: [
      `Imported ${endpoints.length} endpoints from ${document.info?.title || 'OpenAPI document'}`,
      `Organized into ${plan.groups.length} folders`,
      `Configured ${appliedTokenCaptures.length} documented token capture${appliedTokenCaptures.length === 1 ? '' : 's'}`,
      `Added ${collection.environments?.length || 0} environment${collection.environments?.length === 1 ? '' : 's'} with ${authVariableCount} auth variable placeholder${authVariableCount === 1 ? '' : 's'}`
    ],
    warnings,
    sourceUrl: resolved.sourceUrl
  };
};

module.exports = {
  buildPrompt,
  getOperations,
  importOpenApiWithAi,
  parsePlanJson,
  validatePlan,
  _test: {
    applyServerDefaults,
    buildTokenScript,
    responseDocumentsPath
  }
};
