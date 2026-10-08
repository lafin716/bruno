const { describe, it, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('@usebruno/filestore', () => ({
  parseEnvironment: jestObj.fn(),
  stringifyEnvironment: jestObj.fn(),
  stringifyCollection: jestObj.fn()
}), { virtual: true });

const {
  mergeScriptVarsIntoEnvList,
  mergeScriptVarsIntoCollectionVarsList
} = require('../../src/utils/persist-variables');

describe('AWS external secret persistence guards', () => {
  it('preserves protected env names and omits copied protected values', () => {
    const merged = mergeScriptVarsIntoEnvList(
      [
        { name: 'TOKEN', value: 'old', enabled: true, type: 'text', secret: false },
        { name: 'host', value: 'old-host', enabled: true, type: 'text', secret: false }
      ],
      { TOKEN: 'secret', host: 'new-host', copied: 'prefix-secret-suffix', __name__: 'dev' },
      { protectedNames: new Set(['TOKEN']), protectedValues: new Set(['secret']) }
    );

    const byName = Object.fromEntries(merged.map((v) => [v.name, v]));
    expect(byName.TOKEN.value).toBe('old');
    expect(byName.host.value).toBe('new-host');
    expect(byName.copied).toBeUndefined();
  });

  it('preserves protected collection names and omits copied protected values', () => {
    const merged = mergeScriptVarsIntoCollectionVarsList(
      [
        { name: 'TOKEN', value: 'old', enabled: true, type: 'request' },
        { name: 'keep', value: '1', enabled: true, type: 'request' }
      ],
      { TOKEN: 'secret', keep: '2', copied: 'prefix-secret-suffix' },
      { protectedNames: new Set(['TOKEN']), protectedValues: new Set(['secret']) }
    );

    const byName = Object.fromEntries(merged.map((v) => [v.name, v]));
    expect(byName.TOKEN.value).toBe('old');
    expect(byName.keep.value).toBe('2');
    expect(byName.copied).toBeUndefined();
  });
});
