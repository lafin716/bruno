const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  generateLocalText,
  testLocalProvider,
  resolveSpawnTarget,
  buildChildEnv,
  parseCodexOutput,
  parseClaudeOutput,
  _private
} = require('./local-cli');

describe('ipc/ai/local-cli', () => {
  let tempDir;
  let fixturePath;
  let originalPath;

  beforeAll(async () => {
    originalPath = process.env.PATH;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bruno-local-cli-spec-'));
    fixturePath = path.join(tempDir, 'fixture-cli.js');
    await fs.writeFile(fixturePath, `
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (args.includes('--exit-early')) {
    process.exit(0);
  }
  if (args[0] === '--version') {
    console.log('fixture 1.2.3');
    return;
  }
  if (args[0] === 'login' && args[1] === 'status') {
    console.log(process.env.BRUNO_FIXTURE_AUTH_MODE === 'api' ? 'Logged in using API key' : 'Logged in using ChatGPT');
    return;
  }
  if (args[0] === 'auth' && args[1] === 'status') {
    if (process.env.BRUNO_FIXTURE_AUTH_MODE === 'api') {
      console.log(JSON.stringify({ loggedIn: true, authMethod: 'console', apiProvider: 'anthropic' }));
    } else {
      console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }));
    }
    return;
  }
  if (args.includes('--emit-malformed')) {
    console.log('{');
    return;
  }
  if (args.includes('--emit-large')) {
    if (args.includes('--ignore-sigterm')) {
      process.on('SIGTERM', () => {});
      const pidArg = args.find((arg) => arg.startsWith('--pid-file='));
      if (pidArg) {
        require('fs').writeFileSync(pidArg.slice('--pid-file='.length), String(process.pid));
      }
    }
    process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));
    if (args.includes('--ignore-sigterm')) {
      setInterval(() => {}, 1000);
    }
    return;
  }
  if (args.includes('--sleep')) {
    setTimeout(() => console.log('late'), 5000);
    return;
  }
  const payload = {
    args,
    input,
    cwd: process.cwd(),
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || null,
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
      ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || null,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || null,
      PATH: process.env.PATH || null,
      HOME: process.env.HOME || null
    }
  };
  if (args[0] === 'exec') {
    console.log(JSON.stringify({ type: 'agent_message', message: JSON.stringify(payload) }));
    console.log(JSON.stringify({ type: 'turn.completed' }));
  } else {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(payload) }));
  }
});
`);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.BRUNO_FIXTURE_AUTH_MODE;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.PATH = originalPath;
  });

  it('runs Codex with fixed safe argv, prompt on stdin, shell-free Node script support and scrubbed provider env', async () => {
    process.env.OPENAI_API_KEY = 'secret-openai';
    process.env.ANTHROPIC_API_KEY = 'secret-anthropic';
    process.env.AWS_ACCESS_KEY_ID = 'secret-aws';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/secret/google.json';

    const text = await generateLocalText({
      providerId: 'codex',
      config: { executable: fixturePath, model: 'gpt-local' },
      prompt: 'organize this spec'
    });
    const payload = JSON.parse(text);

    expect(payload.input).toBe('organize this spec');
    expect(payload.args).toEqual([
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
      '--model',
      'gpt-local',
      '-'
    ]);
    expect(payload.args).not.toContain('organize this spec');
    expect(path.basename(payload.cwd)).toMatch(/^bruno-ai-local-/);
    expect(payload.env.OPENAI_API_KEY).toBeNull();
    expect(payload.env.ANTHROPIC_API_KEY).toBeNull();
    expect(payload.env.AWS_ACCESS_KEY_ID).toBeNull();
    expect(payload.env.GOOGLE_APPLICATION_CREDENTIALS).toBeNull();
    expect(payload.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(path.basename(path.dirname(payload.env.XDG_CACHE_HOME))).toMatch(/^bruno-ai-local-/);
    expect(payload.env.PATH).toBeTruthy();
  });

  it('runs Claude Code with fixed safe argv and omits blank model override', async () => {
    const text = await generateLocalText({
      providerId: 'claude',
      config: { executable: fixturePath, model: ' ' },
      prompt: 'group endpoints'
    });
    const payload = JSON.parse(text);

    expect(payload.input).toBe('group endpoints');
    expect(payload.args).toEqual([
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
      '--disable-slash-commands'
    ]);
  });

  it('runs an absolute symlink to a Node script when PATH cannot resolve node', async () => {
    const symlinkPath = path.join(tempDir, 'codex-bin');
    await fs.symlink(fixturePath, symlinkPath);
    process.env.PATH = '/usr/bin:/bin';

    const text = await generateLocalText({
      providerId: 'codex',
      config: { executable: symlinkPath, model: '' },
      prompt: 'via symlink'
    });
    const payload = JSON.parse(text);

    expect(payload.input).toBe('via symlink');
    expect(payload.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('resolves a bare PATH command that points to a Node script', async () => {
    const binDir = path.join(tempDir, 'bin');
    await fs.mkdir(binDir);
    await fs.symlink(fixturePath, path.join(binDir, 'codex'));
    process.env.PATH = binDir;

    const text = await generateLocalText({
      providerId: 'codex',
      config: { executable: 'codex', model: '' },
      prompt: 'via PATH'
    });
    const payload = JSON.parse(text);

    expect(payload.input).toBe('via PATH');
    expect(payload.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('checks version and subscription authentication for Codex', async () => {
    await expect(testLocalProvider({
      providerId: 'codex',
      config: { executable: fixturePath, model: '' }
    })).resolves.toEqual({
      ok: true,
      version: 'fixture 1.2.3',
      authenticated: true
    });

    process.env.BRUNO_FIXTURE_AUTH_MODE = 'api';
    await expect(testLocalProvider({
      providerId: 'codex',
      config: { executable: fixturePath, model: '' }
    })).rejects.toThrow('ChatGPT subscription');
  });

  it('checks version and subscription authentication for Claude Code', async () => {
    await expect(testLocalProvider({
      providerId: 'claude',
      config: { executable: fixturePath, model: '' }
    })).resolves.toEqual({
      ok: true,
      version: 'fixture 1.2.3',
      authenticated: true
    });

    process.env.BRUNO_FIXTURE_AUTH_MODE = 'api';
    await expect(testLocalProvider({
      providerId: 'claude',
      config: { executable: fixturePath, model: '' }
    })).rejects.toThrow('Claude subscription');
  });

  it('rejects malformed provider output and failed turns', () => {
    expect(() => parseCodexOutput('{"type":"turn.failed","message":"bad"}\n')).toThrow('Codex failed');
    expect(() => parseCodexOutput('{"type":"agent_message","message":"ok"}\n')).toThrow('turn completion');
    expect(parseCodexOutput('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n{"type":"turn.completed"}\n')).toBe('ok');
    expect(() => parseClaudeOutput('{"is_error":true,"result":"bad"}')).toThrow('Claude Code failed');
    expect(() => parseClaudeOutput('{')).toThrow('malformed JSON');
  });

  it('cancels a running child process', async () => {
    const controller = new AbortController();
    const promise = generateLocalText({
      providerId: 'claude',
      config: { executable: fixturePath, model: '--sleep' },
      prompt: 'wait',
      signal: controller.signal
    });

    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('times out a running child process with an actionable error', async () => {
    await expect(_private.runLocalCli({
      executable: fixturePath,
      args: ['--sleep'],
      timeoutMs: 50
    })).rejects.toThrow('timed out');
  });

  it('rejects before spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(generateLocalText({
      providerId: 'codex',
      config: { executable: fixturePath, model: '' },
      prompt: 'never spawn',
      signal: controller.signal
    })).rejects.toThrow('cancelled');
  });

  it('does not crash on stdin EPIPE when a child exits before reading input', async () => {
    await expect(_private.runLocalCli({
      executable: fixturePath,
      args: ['--exit-early'],
      input: 'x'.repeat(1024 * 1024),
      timeoutMs: 1000
    })).resolves.toEqual({ stdout: '', stderr: '' });
  });

  it('bounds prompt size and output size', async () => {
    await expect(generateLocalText({
      providerId: 'codex',
      config: { executable: fixturePath, model: '' },
      prompt: 'x'.repeat(512 * 1024 + 1)
    })).rejects.toThrow('Prompt is too large');

    await expect(generateLocalText({
      providerId: 'claude',
      config: { executable: fixturePath, model: '--emit-large' },
      prompt: 'large'
    })).rejects.toThrow('stdout exceeded');
  });

  it('force-kills a child that ignores SIGTERM after an output limit failure', async () => {
    const pidFile = path.join(tempDir, 'ignore-sigterm.pid');

    await expect(_private.runLocalCli({
      executable: fixturePath,
      args: ['--emit-large', '--ignore-sigterm', `--pid-file=${pidFile}`],
      timeoutMs: 5000,
      signal: undefined
    })).rejects.toThrow('stdout exceeded');

    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('does not shell-execute Windows cmd or bat launchers', () => {
    expect(() => resolveSpawnTarget('C:\\\\Tools\\\\codex.cmd', [], 'win32')).toThrow('.cmd and .bat');
    expect(() => resolveSpawnTarget('C:\\\\Tools\\\\claude.bat', [], 'win32')).toThrow('.cmd and .bat');
  });

  it('scrubs provider credential environment variables but preserves account paths', () => {
    process.env.OPENAI_API_KEY = 'secret';
    process.env.AWS_REGION = 'us-test-1';
    process.env.CODEX_HOME = '/tmp/codex-home';

    const env = buildChildEnv();

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_REGION).toBeUndefined();
    expect(env.CODEX_HOME).toBe('/tmp/codex-home');
  });
});
