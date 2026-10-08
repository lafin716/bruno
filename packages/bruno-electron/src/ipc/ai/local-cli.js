const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const GENERATE_TIMEOUT_MS = 180000;
const TEST_TIMEOUT_MS = 15000;
const KILL_GRACE_MS = 1000;

const PROVIDERS = {
  codex: {
    label: 'Codex',
    buildGenerateArgs: (model) => [
      'exec',
      '--json',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--disable',
      'shell_tool',
      '--disable',
      'hooks',
      '--disable',
      'plugins',
      '--disable',
      'multi_agent',
      '-c',
      'approval_policy="never"',
      '-c',
      'forced_login_method="chatgpt"',
      '-c',
      'web_search="disabled"',
      '-c',
      'project_doc_max_bytes=0',
      ...(model ? ['--model', model] : []),
      '-'
    ],
    versionArgs: ['--version'],
    authArgs: ['login', 'status'],
    parseGenerateOutput: parseCodexOutput,
    parseAuthOutput: parseCodexAuth
  },
  claude: {
    label: 'Claude Code',
    buildGenerateArgs: (model) => [
      '--print',
      '--input-format',
      'text',
      '--output-format',
      'json',
      '--safe-mode',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
      '--no-session-persistence',
      '--no-chrome',
      '--disable-slash-commands',
      ...(model ? ['--model', model] : [])
    ],
    versionArgs: ['--version'],
    authArgs: ['auth', 'status', '--json'],
    parseGenerateOutput: parseClaudeOutput,
    parseAuthOutput: parseClaudeAuth
  }
};

const DENIED_ENV_NAMES = new Set([
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'GOOGLE_APPLICATION_CREDENTIALS'
]);

const DENIED_ENV_PREFIXES = [
  'AWS_',
  'GOOGLE_',
  'CLOUDSDK_',
  'GCLOUD_'
];

function getProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown local AI provider: ${providerId}`);
  }
  return provider;
}

function assertConfig(config) {
  const executable = typeof config?.executable === 'string' ? config.executable.trim() : '';
  if (!executable) {
    throw new Error('Local AI executable is not configured.');
  }
  return {
    executable,
    model: typeof config.model === 'string' ? config.model.trim() : ''
  };
}

function assertPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('Prompt is required.');
  }
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw new Error('Prompt is too large for local AI generation.');
  }
}

function buildChildEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (DENIED_ENV_NAMES.has(key)) continue;
    if (DENIED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

function resolveSpawnTarget(executable, args, platform = process.platform) {
  const resolvedExecutable = resolveExecutablePath(executable, platform);

  const extension = path.extname(resolvedExecutable).toLowerCase();

  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
    return {
      command: process.execPath,
      args: [resolvedExecutable, ...args],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    };
  }

  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    throw new Error('Windows .cmd and .bat launchers are not supported for local AI. Configure the native executable or a resolved Node script path.');
  }

  return { command: resolvedExecutable, args };
}

function resolveExecutablePath(executable, platform = process.platform) {
  if (path.isAbsolute(executable)) {
    return realpathOrOriginal(executable);
  }

  if (executable.includes(path.sep) || (path.posix.sep !== path.sep && executable.includes(path.posix.sep))) {
    return executable;
  }

  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.JS')
        .split(';')
        .filter(Boolean)
    : [''];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, platform === 'win32' && path.extname(executable) === '' ? `${executable}${extension}` : executable);
      try {
        fsSync.accessSync(candidate, fsSync.constants.F_OK);
        const resolved = realpathOrOriginal(candidate);
        const resolvedExtension = path.extname(resolved).toLowerCase();
        if (resolvedExtension === '.js' || resolvedExtension === '.cjs' || resolvedExtension === '.mjs') {
          return resolved;
        }
        fsSync.accessSync(candidate, fsSync.constants.X_OK);
        return resolved;
      } catch (_err) {}
    }
  }

  return executable;
}

function realpathOrOriginal(executable) {
  try {
    return fsSync.realpathSync(executable);
  } catch (_err) {
    return executable;
  }
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[^\S\r\n]+/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);
}

function sanitizeProcessError(error, fallback) {
  if (!error) return fallback;
  if (error.code === 'ENOENT') return 'Local AI executable was not found. Check the path in Preferences > AI.';
  return sanitizeText(error.message) || fallback;
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.message === 'string') return value.message;
    if (value.content) return extractText(value.content);
    if (value.message) return extractText(value.message);
  }
  return '';
}

function parseJsonObject(text, label) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

function parseCodexOutput(stdout) {
  let completed = false;
  let finalMessage = '';
  const errors = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseJsonObject(line, 'Codex');
    const type = event.type || event.event || event.kind;

    if (type === 'turn.failed' || type === 'error') {
      errors.push(extractText(event.error || event.message || event));
    }
    if (type === 'turn.completed') {
      completed = true;
      finalMessage = extractText(event.message || event.output || event.result || event.final_message) || finalMessage;
    }
    if (type === 'agent_message') {
      finalMessage = extractText(event.message || event.text || event.content || event);
    }
    if (type === 'item.completed' && event.item?.type === 'agent_message') {
      finalMessage = extractText(event.item.text || event.item.content || event.item.message);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Codex failed: ${sanitizeText(errors.join('\n'))}`);
  }
  if (!completed) {
    throw new Error('Codex did not report turn completion.');
  }
  if (!finalMessage.trim()) {
    throw new Error('Codex did not return a final message.');
  }
  return finalMessage;
}

function parseClaudeOutput(stdout) {
  const result = parseJsonObject(stdout.trim(), 'Claude Code');
  if (result.is_error || result.error || result.subtype === 'error' || result.success === false) {
    throw new Error(`Claude Code failed: ${sanitizeText(result.error || result.result || result.message || 'generation error')}`);
  }

  const text = extractText(result.result || result.text || result.message || result.content);
  if (!text.trim()) {
    throw new Error('Claude Code did not return result text.');
  }
  return text;
}

function parseCodexAuth(stdout) {
  const text = sanitizeText(stdout);
  if (!/chatgpt/i.test(text)) {
    throw new Error('Codex is not authenticated with a ChatGPT subscription. Run `codex login` and choose ChatGPT.');
  }
  return { authenticated: true };
}

function parseClaudeAuth(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (
      data?.loggedIn === true
      && data?.authMethod === 'claude.ai'
      && (!data.apiProvider || data.apiProvider === 'firstParty')
    ) {
      return { authenticated: true };
    }
    throw new Error('Claude Code is authenticated for API billing, not a Claude subscription. Run `claude auth login` with a Claude subscription account.');
  } catch (err) {
    if (err.message.includes('Claude Code is authenticated')) {
      throw err;
    }
    throw new Error('Claude Code authentication status could not be verified. Run `claude auth status --json` and confirm a Claude subscription login.');
  }
}

async function runLocalCli({ executable, args, input = '', timeoutMs, signal }) {
  if (signal?.aborted) {
    throw new Error('Local AI request was cancelled.');
  }

  const target = resolveSpawnTarget(executable, args);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'bruno-ai-local-'));
  const child = spawn(target.command, target.args, {
    cwd,
    env: {
      ...buildChildEnv(),
      XDG_CACHE_HOME: path.join(cwd, '.cache'),
      ...(target.env || {})
    },
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let settled = false;
  let killTimer = null;
  let timeoutFailTimer = null;
  let timedOut = false;

  const terminate = () => {
    if (child.exitCode !== null || child.killed) return;
    child.kill('SIGTERM');
    if (!killTimer) {
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
    }
  };

  const abort = () => terminate();

  const cleanup = async () => {
    signal?.removeEventListener?.('abort', abort);
    await fs.rm(cwd, { recursive: true, force: true });
  };
  signal?.addEventListener?.('abort', abort, { once: true });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
      timeoutFailTimer = setTimeout(() => {
        fail(new Error('Local AI request timed out.'));
      }, KILL_GRACE_MS + 100);
    }, timeoutMs);

    async function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timeoutFailTimer) clearTimeout(timeoutFailTimer);
      await cleanup();
      reject(err);
    }

    async function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timeoutFailTimer) clearTimeout(timeoutFailTimer);
      if (killTimer) clearTimeout(killTimer);
      await cleanup();
      resolve(result);
    }

    child.once('error', (error) => {
      fail(new Error(sanitizeProcessError(error, 'Local AI process failed to start.')));
    });

    child.stdin.on('error', () => {});

    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > MAX_OUTPUT_BYTES) {
        terminate();
        fail(new Error('Local AI stdout exceeded the 2 MiB limit.'));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > MAX_OUTPUT_BYTES) {
        terminate();
        fail(new Error('Local AI stderr exceeded the 2 MiB limit.'));
      }
    });

    child.once('close', (code, signalName) => {
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      if (signal?.aborted) {
        fail(new Error('Local AI request was cancelled.'));
        return;
      }
      if (timedOut) {
        fail(new Error('Local AI request timed out.'));
        return;
      }
      if (code !== 0) {
        const details = sanitizeText(stderr.toString('utf8') || stdout.toString('utf8'));
        fail(new Error(details || `Local AI process exited with code ${code ?? signalName}.`));
        return;
      }
      done({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8')
      });
    });

    try {
      child.stdin.end(input);
    } catch (_err) {}
  });
}

async function generateLocalText({ providerId, config, prompt, signal }) {
  const provider = getProvider(providerId);
  const normalized = assertConfig(config);
  assertPrompt(prompt);

  const { stdout } = await runLocalCli({
    executable: normalized.executable,
    args: provider.buildGenerateArgs(normalized.model),
    input: prompt,
    timeoutMs: GENERATE_TIMEOUT_MS,
    signal
  });

  return provider.parseGenerateOutput(stdout);
}

async function testLocalProvider({ providerId, config, signal }) {
  const provider = getProvider(providerId);
  const normalized = assertConfig(config);

  const versionResult = await runLocalCli({
    executable: normalized.executable,
    args: provider.versionArgs,
    timeoutMs: TEST_TIMEOUT_MS,
    signal
  });
  const authResult = await runLocalCli({
    executable: normalized.executable,
    args: provider.authArgs,
    timeoutMs: TEST_TIMEOUT_MS,
    signal
  });

  return {
    ok: true,
    version: sanitizeText(versionResult.stdout || versionResult.stderr).split(/\r?\n/)[0] || undefined,
    ...provider.parseAuthOutput(`${authResult.stdout}\n${authResult.stderr}`)
  };
}

module.exports = {
  generateLocalText,
  testLocalProvider,
  resolveSpawnTarget,
  buildChildEnv,
  parseCodexOutput,
  parseClaudeOutput,
  _private: {
    runLocalCli
  }
};
