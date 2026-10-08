const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

jest.mock('electron', () => ({ dialog: {} }));
// The real shared validator is covered by requests tests. This test exercises
// actual environment serializers and locked disk writes, independently of its build.
jest.mock('@usebruno/requests', () => ({ validateAwsExternalSecrets: jest.fn() }));

const { parseEnvironment, stringifyEnvironment } = require('@usebruno/filestore');
const { saveExternalSecrets } = require('./save-external-secrets');
const { validateAwsExternalSecrets } = require('@usebruno/requests');
const refs = { type: 'aws-secrets-manager', variables: [{ name: 'TOKEN', value: '{"secretId":"dev/api","jsonKey":"token"}' }] };
let collectionPath;

beforeEach(async () => {
  collectionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bruno-reference-test-'));
  await fs.mkdir(path.join(collectionPath, 'environments'));
});
afterEach(async () => { await fs.rm(collectionPath, { recursive: true, force: true }); });

describe.each(['bru', 'yml'])('saving %s external secret references', (format) => {
  const original = { name: 'dev', variables: [{ name: 'HOST', value: 'https://latest.example', enabled: true, type: 'text', secret: false }, { name: 'LOCAL_SECRET', value: '', enabled: true, type: 'text', secret: true }], extends: 'base', color: '#123456' };
  const prepare = async () => {
    await fs.writeFile(path.join(collectionPath, format === 'bru' ? 'bruno.json' : 'opencollection.yml'), format === 'bru' ? '{}' : 'name: Test');
    const environmentPath = path.join(collectionPath, 'environments', `dev.${format}`);
    await fs.writeFile(environmentPath, stringifyEnvironment(original, { format }));
    return environmentPath;
  };

  it('preserves latest variables, local secrets, inheritance and color', async () => {
    const environmentPath = await prepare();
    const before = parseEnvironment(await fs.readFile(environmentPath, 'utf8'), { format });
    await saveExternalSecrets(collectionPath, 'dev', refs);
    const after = parseEnvironment(await fs.readFile(environmentPath, 'utf8'), { format });
    expect(after.externalSecrets).toEqual(refs);
    delete after.externalSecrets;
    // YAML parsing generates session-local UIDs; they are not persisted fields.
    const withoutUids = (environment) => ({ ...environment, uid: undefined,
      variables: environment.variables.map((variable) => ({ ...variable, uid: undefined })) });
    expect(withoutUids(after)).toEqual(withoutUids(before));
    expect(validateAwsExternalSecrets).toHaveBeenCalledWith(refs);
  });

  it('removes references without losing ordinary variables', async () => {
    const environmentPath = await prepare();
    await saveExternalSecrets(collectionPath, 'dev', refs);
    await saveExternalSecrets(collectionPath, 'dev', { type: 'aws-secrets-manager', variables: [] });
    const after = parseEnvironment(await fs.readFile(environmentPath, 'utf8'), { format });
    expect(after.externalSecrets).toBeUndefined();
    expect(after.variables[0].value).toBe('https://latest.example');
  });
});

it.each(['../outside', 'nested/dev', '..', 'bad\\name'])('rejects unsafe environment name %s', async (name) => {
  await expect(saveExternalSecrets(collectionPath, name, refs)).rejects.toThrow('Invalid environment name');
});
