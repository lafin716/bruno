jest.mock('nanoid', () => ({ customAlphabet: () => () => 'mock-uid' }));

import reducer, { setExternalSecretsDraft, saveExternalSecrets, clearExternalSecretsDraft } from './index';

const refs = (secretId) => ({ type: 'aws-secrets-manager', variables: [{ name: 'TOKEN', value: JSON.stringify({ secretId }) }] });
const payload = { collectionUid: 'c', environmentUid: 'e' };
const initial = () => ({ collections: [{ uid: 'c', environments: [{ uid: 'e', name: 'dev', variables: [{ name: 'HOST', value: 'original' }] }], environmentsDraft: { environmentUid: 'e', variables: [{ name: 'HOST', value: 'edited' }] } }] });

describe('external secret drafts', () => {
  it('saves references without replacing ordinary variables or their draft', () => {
    let state = reducer(initial(), setExternalSecretsDraft({ ...payload, externalSecrets: refs('dev/token') }));
    state = reducer(state, saveExternalSecrets({ ...payload, externalSecrets: refs('dev/token') }));
    const collection = state.collections[0];
    expect(collection.environments[0].externalSecrets).toEqual(refs('dev/token'));
    expect(collection.environments[0].variables[0].value).toBe('original');
    expect(collection.environmentsDraft.variables[0].value).toBe('edited');
    expect(collection.externalSecretsDrafts.e).toBeUndefined();
  });

  it('keeps newer edits when an earlier save completes', () => {
    let state = reducer(initial(), setExternalSecretsDraft({ ...payload, externalSecrets: refs('newer') }));
    state = reducer(state, saveExternalSecrets({ ...payload, externalSecrets: refs('older') }));
    expect(state.collections[0].externalSecretsDrafts.e).toEqual(refs('newer'));
    expect(state.collections[0].environments[0].externalSecrets).toEqual(refs('older'));
  });

  it('discards only the selected environment references', () => {
    let state = reducer(initial(), setExternalSecretsDraft({ ...payload, externalSecrets: refs('dev/token') }));
    state = reducer(state, setExternalSecretsDraft({ ...payload, environmentUid: 'other', externalSecrets: refs('other/token') }));
    state = reducer(state, clearExternalSecretsDraft(payload));
    expect(state.collections[0].externalSecretsDrafts.e).toBeUndefined();
    expect(state.collections[0].externalSecretsDrafts.other).toEqual(refs('other/token'));
    expect(state.collections[0].environmentsDraft.variables[0].value).toBe('edited');
  });
});
