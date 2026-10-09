import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const AWS_EXTERNAL_SECRETS_TYPE = 'aws-secrets-manager';
const MAX_AWS_SECRET_REFS = 50;
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', '__name__']);
const BRUNO_VARIABLE_NAME_RE = /^[\w.-]+$/;
const AWS_REGION_PATTERNS = [
  /^(us|af|ap|ca|eu|il|me|mx|sa)-(central|north|northeast|northwest|south|southeast|southwest|east|west)-\d+$/,
  /^us-gov-(east|west)-\d+$/,
  /^cn-(north|northwest)-\d+$/
];

export interface AwsSecretReference {
  name: string;
  value: string;
}

export interface AwsSecretRefValue {
  secretId: string;
  jsonKey?: string;
  region?: string;
  profile?: string;
}

export interface AwsExternalSecrets {
  type?: string;
  variables?: AwsSecretReference[];
}

export interface AwsResolvedExternalSecrets {
  variables: Record<string, string>;
  secretNames: Set<string>;
  secretValues: Set<string>;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AwsSecretsClient {
  getSecretValue(ref: AwsSecretRefValue): Promise<string>;
}

export interface AwsSecretsClientOptions {
  axiosInstance?: AxiosInstance;
  credentialsProvider: (args: { profile?: string }) => Promise<AwsCredentials>;
  signRequest: (args: {
    request: AxiosRequestConfig;
    region: string;
    service: string;
    credentials: AwsCredentials;
  }) => Promise<AxiosRequestConfig> | AxiosRequestConfig;
  timeoutMs?: number;
}

export class AwsSecretsError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AwsSecretsError';
    this.code = code;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const ensureString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readOptionalString = (parsed: Record<string, unknown>, key: string): string | undefined => {
  if (!Object.prototype.hasOwnProperty.call(parsed, key) || parsed[key] === undefined || parsed[key] === null || parsed[key] === '') {
    return undefined;
  }
  if (typeof parsed[key] !== 'string') {
    throw new AwsSecretsError('invalid-reference', `AWS secret reference field ${key} must be a string.`);
  }
  return parsed[key].trim() || undefined;
};

const parseReferenceValue = (rawValue: unknown): AwsSecretRefValue => {
  if (typeof rawValue !== 'string') {
    throw new AwsSecretsError('invalid-reference', 'AWS secret reference value must be a JSON string.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new AwsSecretsError('invalid-reference', 'AWS secret reference value must be valid JSON.');
  }

  if (!isPlainObject(parsed)) {
    throw new AwsSecretsError('invalid-reference', 'AWS secret reference value must be a JSON object.');
  }

  if (typeof parsed.secretId !== 'string') {
    throw new AwsSecretsError('invalid-reference', 'AWS secret reference requires string secretId.');
  }

  const secretId = ensureString(parsed.secretId);
  if (!secretId) {
    throw new AwsSecretsError('invalid-reference', 'AWS secret reference requires secretId.');
  }

  return {
    secretId,
    jsonKey: readOptionalString(parsed, 'jsonKey'),
    region: readOptionalString(parsed, 'region'),
    profile: readOptionalString(parsed, 'profile')
  };
};

const assertValidVariableName = (name: unknown, seen: Set<string>) => {
  const normalized = ensureString(name);
  if (!normalized || RESERVED_NAMES.has(normalized) || !BRUNO_VARIABLE_NAME_RE.test(normalized)) {
    throw new AwsSecretsError('invalid-reference', `Invalid AWS external secret variable name: ${String(name || '')}`);
  }
  if (seen.has(normalized)) {
    throw new AwsSecretsError('invalid-reference', `Duplicate AWS external secret variable name: ${normalized}`);
  }
  seen.add(normalized);
  return normalized;
};

const decodeSecretPayload = (payload: any): string => {
  if (typeof payload?.SecretString === 'string') {
    return payload.SecretString;
  }
  if (typeof payload?.SecretBinary === 'string') {
    return Buffer.from(payload.SecretBinary, 'base64').toString('utf8');
  }
  throw new AwsSecretsError('empty-secret', 'AWS secret has no SecretString or SecretBinary value.');
};

const selectJsonKey = (secret: string, jsonKey?: string): string => {
  if (!jsonKey) {
    return secret;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new AwsSecretsError('json-key-not-found', 'AWS secret value is not valid JSON.');
  }

  if (!isPlainObject(parsed) || !Object.prototype.hasOwnProperty.call(parsed, jsonKey)) {
    throw new AwsSecretsError('json-key-not-found', 'AWS secret JSON key was not found.');
  }

  const value = parsed[jsonKey];
  return typeof value === 'string' ? value : JSON.stringify(value);
};

const makeDedupeKey = (ref: AwsSecretRefValue) =>
  JSON.stringify({
    secretId: ref.secretId,
    jsonKey: ref.jsonKey || '',
    region: ref.region || '',
    profile: ref.profile || ''
  });

const validateAwsRegion = (region: string): void => {
  if (!AWS_REGION_PATTERNS.some((pattern) => pattern.test(region))) {
    throw new AwsSecretsError('invalid-region', 'AWS secret reference has an invalid region.');
  }
};

const getAwsDnsSuffix = (region: string): string => (region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com');

export const hasAwsExternalSecrets = (externalSecrets?: AwsExternalSecrets | null): boolean =>
  externalSecrets?.type === AWS_EXTERNAL_SECRETS_TYPE && Array.isArray(externalSecrets.variables) && externalSecrets.variables.length > 0;

export const validateAwsExternalSecrets = (externalSecrets?: AwsExternalSecrets | null): void => {
  if (!externalSecrets) {
    return;
  }
  if (externalSecrets.type !== AWS_EXTERNAL_SECRETS_TYPE) {
    return;
  }

  if (externalSecrets.variables === undefined || externalSecrets.variables === null) {
    return;
  }
  if (!Array.isArray(externalSecrets.variables)) {
    throw new AwsSecretsError('invalid-reference', 'AWS externalSecrets variables must be an array.');
  }

  const references = externalSecrets.variables;
  if (!references.length) {
    return;
  }
  if (references.length > MAX_AWS_SECRET_REFS) {
    throw new AwsSecretsError('too-many-references', `AWS external secrets are limited to ${MAX_AWS_SECRET_REFS} variables.`);
  }

  const seenNames = new Set<string>();
  for (const variable of references) {
    assertValidVariableName(variable?.name, seenNames);
    parseReferenceValue(variable?.value);
  }
};

export const resolveAwsExternalSecrets = async ({
  externalSecrets,
  enabled,
  defaultRegion,
  defaultProfile,
  client
}: {
  externalSecrets?: AwsExternalSecrets | null;
  enabled: boolean;
  defaultRegion?: string;
  defaultProfile?: string;
  client: AwsSecretsClient;
}): Promise<AwsResolvedExternalSecrets> => {
  if (externalSecrets?.type !== AWS_EXTERNAL_SECRETS_TYPE) {
    return { variables: {}, secretNames: new Set(), secretValues: new Set() };
  }

  validateAwsExternalSecrets(externalSecrets);
  if (!hasAwsExternalSecrets(externalSecrets)) {
    return { variables: {}, secretNames: new Set(), secretValues: new Set() };
  }

  const references = externalSecrets.variables || [];
  if (!enabled) {
    throw new AwsSecretsError('disabled', 'AWS Secrets Manager fetching is disabled.');
  }

  const seenNames = new Set<string>();
  const cache = new Map<string, Promise<string>>();
  const variables: Record<string, string> = {};
  const secretNames = new Set<string>();
  const secretValues = new Set<string>();

  for (const variable of references) {
    const name = assertValidVariableName(variable?.name, seenNames);
    const ref = parseReferenceValue(variable?.value);
    ref.region = ref.region || ensureString(defaultRegion) || undefined;
    ref.profile = ref.profile || ensureString(defaultProfile) || undefined;

    if (!ref.region) {
      throw new AwsSecretsError('missing-region', 'AWS secret reference requires a region.');
    }

    const key = makeDedupeKey(ref);
    if (!cache.has(key)) {
      cache.set(key, client.getSecretValue(ref));
    }
    const value = await cache.get(key)!;
    variables[name] = value;
    secretNames.add(name);
    if (value) {
      secretValues.add(value);
    }
  }

  return { variables, secretNames, secretValues };
};

export const createAwsSecretsManagerClient = ({
  axiosInstance = axios.create(),
  credentialsProvider,
  signRequest,
  timeoutMs = 10_000
}: AwsSecretsClientOptions): AwsSecretsClient => ({
  async getSecretValue(ref: AwsSecretRefValue): Promise<string> {
    const region = ensureString(ref.region);
    if (!region) {
      throw new AwsSecretsError('missing-region', 'AWS secret reference requires a region.');
    }
    validateAwsRegion(region);

    const request: AxiosRequestConfig = {
      method: 'POST',
      url: `https://secretsmanager.${region}.${getAwsDnsSuffix(region)}/`,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'secretsmanager.GetSecretValue'
      },
      data: JSON.stringify({ SecretId: ref.secretId }),
      timeout: timeoutMs,
      maxRedirects: 0,
      proxy: false,
      validateStatus: () => true
    };

    try {
      const credentials = await credentialsProvider({ profile: ref.profile });
      const signedRequest = await signRequest({
        request,
        region,
        service: 'secretsmanager',
        credentials
      });
      const response = await axiosInstance.request(signedRequest);
      if (!response || response.status < 200 || response.status >= 300) {
        throw new AwsSecretsError('fetch-failed', `AWS Secrets Manager returned status ${response?.status || 'unknown'}.`);
      }
      return selectJsonKey(decodeSecretPayload(response.data), ref.jsonKey);
    } catch (error: any) {
      if (error instanceof AwsSecretsError) {
        throw error;
      }
      const suffix = error?.code ? ` (${error.code})` : '';
      throw new AwsSecretsError('fetch-failed', `AWS Secrets Manager request failed${suffix}.`);
    }
  }
});

const collectJsonStringLeaves = (value: unknown, out: Set<string>) => {
  if (typeof value === 'string') {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonStringLeaves(item, out));
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => collectJsonStringLeaves(item, out));
  }
};

const buildRedactionReplacements = (secretValues?: Iterable<string>): string[] => {
  const replacements = new Set<string>();
  for (const secret of secretValues || []) {
    if (typeof secret !== 'string' || !secret.length) {
      continue;
    }
    replacements.add(secret);
    replacements.add(encodeURIComponent(secret));
    replacements.add(Buffer.from(secret, 'utf8').toString('base64'));
    const jsonEscaped = JSON.stringify(secret);
    replacements.add(jsonEscaped.slice(1, -1));
    try {
      const parsed = JSON.parse(secret);
      const leaves = new Set<string>();
      collectJsonStringLeaves(parsed, leaves);
      for (const leaf of leaves) {
        if (leaf.length) {
          replacements.add(leaf);
          replacements.add(encodeURIComponent(leaf));
          replacements.add(Buffer.from(leaf, 'utf8').toString('base64'));
          const jsonEscapedLeaf = JSON.stringify(leaf);
          replacements.add(jsonEscapedLeaf.slice(1, -1));
        }
      }
    } catch { }
  }
  return Array.from(replacements).sort((a, b) => b.length - a.length);
};

const looksLikeBase64 = (value: string): boolean => {
  const trimmed = value.trim();
  return Boolean(trimmed.length >= 8 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed));
};

const redactDecodedBase64 = (value: string, replacements: string[]): string | null => {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    let redactedDecoded = decoded;
    for (const secret of replacements) {
      redactedDecoded = redactedDecoded.split(secret).join('[AWS_SECRET_REDACTED]');
    }
    return redactedDecoded !== decoded ? Buffer.from(redactedDecoded, 'utf8').toString('base64') : null;
  } catch {
    return null;
  }
};

const replaceBasicAuth = (value: string, replacements: string[]) =>
  value.replace(/Basic\s+([A-Za-z0-9+/]+={0,2})/gi, (match, encoded) => {
    const redactedEncoded = redactDecodedBase64(encoded, replacements);
    return redactedEncoded ? 'Basic [AWS_SECRET_REDACTED]' : match;
  });

const replaceInString = (value: string, replacements: string[]) => {
  let redacted = replaceBasicAuth(value, replacements);
  for (const secret of replacements) {
    redacted = redacted.split(secret).join('[AWS_SECRET_REDACTED]');
  }

  if (redacted === value && looksLikeBase64(value)) {
    const redactedEncoded = redactDecodedBase64(value, replacements);
    if (redactedEncoded) {
      return redactedEncoded;
    }
  }

  return redacted;
};

const redactBytes = (input: Buffer | Uint8Array | ArrayBuffer, replacements: string[]) => {
  const bytes = Buffer.isBuffer(input)
    ? input
    : input instanceof ArrayBuffer
      ? Buffer.from(input)
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const redacted = Buffer.from(replaceInString(bytes.toString('utf8'), replacements));
  if (Buffer.isBuffer(input)) {
    return redacted;
  }
  if (input instanceof ArrayBuffer) {
    return redacted.buffer.slice(redacted.byteOffset, redacted.byteOffset + redacted.byteLength);
  }
  return new Uint8Array(redacted);
};

export const redactAwsSecretValues = <T>(value: T, secretValues?: Iterable<string>): T => {
  const replacements = buildRedactionReplacements(secretValues);
  if (!replacements.length) {
    return value;
  }

  const redact = (input: any): any => {
    if (typeof input === 'string') {
      return replaceInString(input, replacements);
    }
    if (Buffer.isBuffer(input) || input instanceof Uint8Array || input instanceof ArrayBuffer) {
      return redactBytes(input, replacements);
    }
    if (input instanceof Error) {
      const next = new Error(replaceInString(input.message, replacements));
      next.name = input.name;
      if (typeof input.stack === 'string') {
        next.stack = replaceInString(input.stack, replacements);
      }
      for (const [key, nested] of Object.entries(input)) {
        (next as any)[replaceInString(key, replacements)] = redact(nested);
      }
      return next;
    }
    if (Array.isArray(input)) {
      return input.map(redact);
    }
    if (input && typeof input === 'object') {
      const next: Record<string, any> = {};
      for (const [key, nested] of Object.entries(input)) {
        next[replaceInString(key, replacements)] = redact(nested);
      }
      return next;
    }
    return input;
  };

  return redact(value);
};

export const createAwsSecretRedactor = (secretValues?: Iterable<string>) => <T>(value: T): T =>
  redactAwsSecretValues(value, secretValues);

export const AWS_SECRETS_MANAGER_EXTERNAL_SECRETS_TYPE = AWS_EXTERNAL_SECRETS_TYPE;
