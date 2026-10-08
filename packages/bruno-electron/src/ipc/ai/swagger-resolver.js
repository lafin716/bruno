const jsyaml = require('js-yaml');

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_DISCOVERY_FETCHES = 12;
const MAX_REDIRECTS = 5;
const TOTAL_TIMEOUT_MS = 30_000;
const SENSITIVE_QUERY_KEYS = /(^|_)(access_)?token$|api_?key|secret|password|signature|sig|auth/i;
const SUPPORTED_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const isHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const assertSafeUrl = (url) => {
  if (!isHttpUrl(url)) {
    throw new Error('Swagger resolver only supports http and https URLs');
  }

  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    throw new Error('Swagger resolver refuses URLs with embedded credentials');
  }

  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      throw new Error(`Swagger resolver refuses credential-bearing URL query parameter: ${key}`);
    }
  }
};

const resolveUrl = (baseUrl, value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const resolved = new URL(value, baseUrl).toString();
  assertSafeUrl(resolved);
  return resolved;
};

const parseBody = (body) => {
  if (!body || typeof body !== 'string') {
    throw new Error('Swagger response was empty');
  }

  try {
    return JSON.parse(body);
  } catch {
    return jsyaml.load(body);
  }
};

const isOpenApiDocument = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (typeof value.openapi === 'string') {
    return value.openapi.startsWith('3.') && value.paths && typeof value.paths === 'object';
  }
  if (typeof value.swagger === 'string') {
    return value.swagger === '2.0' && value.paths && typeof value.paths === 'object';
  }
  return false;
};

const assertSupportedDocument = (value) => {
  if (isOpenApiDocument(value)) {
    return;
  }

  const version = value && typeof value === 'object' ? value.openapi || value.swagger : null;
  if (version) {
    throw new Error(`Unsupported Swagger/OpenAPI version: ${version}`);
  }
  throw new Error('URL did not resolve to a Swagger 2.0 or OpenAPI 3.x document');
};

const decodePointerSegment = (segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

const getJsonPointer = (document, pointer) => {
  if (pointer === '#') {
    return document;
  }
  if (!pointer.startsWith('#/')) {
    return undefined;
  }

  return pointer
    .slice(2)
    .split('/')
    .map(decodePointerSegment)
    .reduce((current, key) => {
      if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, key)) {
        return current[key];
      }
      return undefined;
    }, document);
};

const assertLocalRefsResolvable = (document) => {
  const seen = new WeakSet();
  const refs = [];

  const walk = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (typeof value.$ref === 'string') {
      refs.push(value.$ref);
    }

    Object.values(value).forEach(walk);
  };

  walk(document);

  refs.forEach((ref) => {
    if (!ref.startsWith('#/')) {
      throw new Error(`External $ref is not supported: ${ref}`);
    }
    if (getJsonPointer(document, ref) === undefined) {
      throw new Error(`Unresolvable local $ref: ${ref}`);
    }
  });
};

const createDefaultFetcher = async () => {
  const { getCertsAndProxyConfig } = require('../network/cert-utils');
  const { makeAxiosInstance } = require('../network/axios-instance');
  const { proxyMode, proxyConfig, httpsAgentRequestFields, interpolationOptions } = await getCertsAndProxyConfig({
    collectionUid: null,
    collection: { promptVariables: {} },
    request: {},
    envVars: {},
    runtimeVariables: {},
    processEnvVars: {},
    collectionPath: '',
    globalEnvironmentVariables: {}
  });

  const axiosInstance = makeAxiosInstance({
    proxyMode,
    proxyConfig,
    httpsAgentRequestFields,
    interpolationOptions,
    followRedirects: false
  });

  return async ({ url, signal, timeout }) => {
    let currentUrl = url;
    let redirects = 0;
    let response;

    while (true) {
      assertSafeUrl(currentUrl);
      const remainingTimeout = typeof timeout === 'function' ? timeout() : timeout;
      response = await axiosInstance.get(currentUrl, {
        responseType: 'arraybuffer',
        transformResponse: [(data) => data],
        validateStatus: () => true,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        timeout: remainingTimeout,
        signal
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }

      const location = response.headers?.location || response.headers?.Location;
      if (!location) {
        break;
      }
      redirects++;
      if (redirects > MAX_REDIRECTS) {
        throw new Error(`Swagger fetch exceeded ${MAX_REDIRECTS} redirects`);
      }
      if (typeof timeout === 'function') {
        timeout();
      }
      currentUrl = resolveUrl(currentUrl, Array.isArray(location) ? location[0] : location);
    }

    const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || '');
    if (buffer.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Swagger response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    const responseUrl = response.request?.res?.responseUrl || currentUrl;
    assertSafeUrl(responseUrl);

    return {
      url: responseUrl,
      status: response.status,
      headers: response.headers || {},
      body: buffer.toString('utf8')
    };
  };
};

const responseContentType = (headers) => {
  const value = headers && (headers['content-type'] || headers['Content-Type']);
  return Array.isArray(value) ? value.join('; ') : String(value || '');
};

const isHtmlResponse = ({ headers, body }) => {
  const contentType = responseContentType(headers);
  return /html/i.test(contentType) || /^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body);
};

const extractQuotedProperty = (text, propertyName) => {
  const pattern = new RegExp(`${propertyName}\\s*:\\s*(['"\`])([^'"\`]+)\\1`);
  const match = text.match(pattern);
  return match ? match[2] : null;
};

const extractSwaggerUiCandidates = (html, pageUrl) => {
  const candidates = [];
  const add = (value) => {
    const resolved = resolveUrl(pageUrl, value);
    if (resolved && !candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  [
    extractQuotedProperty(html, 'configUrl'),
    extractQuotedProperty(html, 'url')
  ].filter(Boolean).forEach(add);

  const scriptPattern = /<script\b[^>]*\bsrc=(['"])([^'"]*swagger-initializer[^'"]*)\1/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    add(match[2]);
  }

  const page = new URL(pageUrl);
  ['/v3/api-docs', '/swagger.json', '/openapi.json'].forEach((pathname) => {
    add(`${page.origin}${pathname}`);
  });

  return candidates;
};

const isSwaggerInitializerResponse = ({ url, body }) => {
  return /swagger-initializer/i.test(url || '') || /SwaggerUIBundle\s*\(/.test(body || '');
};

const extractConfigCandidates = (config, configUrl) => {
  const candidates = [];
  const add = (value) => {
    const resolved = resolveUrl(configUrl, value);
    if (resolved && !candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  if (config && typeof config === 'object') {
    if (typeof config.url === 'string') {
      add(config.url);
    }
    if (Array.isArray(config.urls)) {
      config.urls.forEach((entry) => {
        if (typeof entry === 'string') {
          add(entry);
        } else if (entry && typeof entry.url === 'string') {
          add(entry.url);
        }
      });
    }
  }

  return candidates;
};

const createDeadline = (startedAt = Date.now()) => ({
  remaining() {
    const remainingMs = TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(`Swagger resolution exceeded ${TOTAL_TIMEOUT_MS}ms`);
    }
    return remainingMs;
  }
});

const resolveSwaggerDocument = async ({ url, signal, fetcher, startedAt } = {}) => {
  if (!url || typeof url !== 'string') {
    throw new Error('Missing Swagger/OpenAPI URL');
  }

  const deadline = createDeadline(startedAt);
  const fetchUrl = fetcher || await createDefaultFetcher();
  const queue = [url];
  const visited = new Set();
  let fetchCount = 0;
  let lastError = null;

  while (queue.length) {
    if (signal?.aborted) {
      throw new Error('Swagger resolution cancelled');
    }

    const currentUrl = queue.shift();
    assertSafeUrl(currentUrl);
    if (visited.has(currentUrl)) {
      continue;
    }
    visited.add(currentUrl);

    fetchCount++;
    if (fetchCount > MAX_DISCOVERY_FETCHES) {
      throw new Error(`Swagger discovery exceeded ${MAX_DISCOVERY_FETCHES} fetches`);
    }

    let response;
    try {
      response = await fetchUrl({ url: currentUrl, signal, timeout: () => deadline.remaining() });
    } catch (err) {
      lastError = err;
      continue;
    }

    assertSafeUrl(response.url || currentUrl);

    if (response.status < 200 || response.status >= 300) {
      lastError = new Error(`Failed to fetch ${currentUrl}: HTTP ${response.status}`);
      continue;
    }

    if (Buffer.byteLength(response.body || '', 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error(`Swagger response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    if (isHtmlResponse(response) || isSwaggerInitializerResponse(response)) {
      queue.push(...extractSwaggerUiCandidates(response.body, response.url || currentUrl));
      continue;
    }

    let parsed;
    try {
      parsed = parseBody(response.body);
    } catch (err) {
      lastError = new Error(`Failed to parse Swagger content from ${currentUrl}: ${err.message}`);
      continue;
    }

    if (isOpenApiDocument(parsed)) {
      assertLocalRefsResolvable(parsed);
      return {
        document: parsed,
        sourceUrl: response.url || currentUrl,
        fetchCount
      };
    }

    if (parsed && typeof parsed === 'object' && (parsed.openapi || parsed.swagger)) {
      assertSupportedDocument(parsed);
    }

    const configCandidates = extractConfigCandidates(parsed, response.url || currentUrl);
    if (configCandidates.length) {
      queue.push(...configCandidates);
      continue;
    }

    lastError = new Error(`Fetched document from ${currentUrl} is not a supported Swagger/OpenAPI document`);
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error('URL did not resolve to a Swagger 2.0 or OpenAPI 3.x document');
};

module.exports = {
  MAX_DISCOVERY_FETCHES,
  MAX_RESPONSE_BYTES,
  SUPPORTED_METHODS,
  assertLocalRefsResolvable,
  assertSafeUrl,
  getJsonPointer,
  isOpenApiDocument,
  resolveSwaggerDocument,
  _test: {
    createDefaultFetcher
  }
};
