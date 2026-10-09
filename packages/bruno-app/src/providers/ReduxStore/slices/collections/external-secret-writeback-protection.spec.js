jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'mock-uid'
}));

jest.mock('@usebruno/schema', () => ({
  collectionSchema: { validate: () => Promise.resolve() },
  environmentSchema: { validate: () => Promise.resolve() },
  itemSchema: { validate: () => Promise.resolve() }
}));

import { configureStore } from '@reduxjs/toolkit';
import collectionsReducer, {
  scriptEnvironmentUpdateEvent,
  runtimeVariablesUpdateEvent
} from 'providers/ReduxStore/slices/collections';
import globalEnvironmentsReducer, {
  globalEnvironmentsUpdateEvent
} from 'providers/ReduxStore/slices/global-environments';
import { collectionVariablesUpdateEvent } from 'providers/ReduxStore/slices/collections/actions';

const COLLECTION_UID = 'col-1';
const ENV_UID = 'env-1';
const GLOBAL_ENV_UID = 'global-env-1';

const makeVar = (name, value, extra = {}) => ({
  uid: `uid-${name}`,
  name,
  value,
  enabled: true,
  type: 'text',
  secret: false,
  ...extra
});

let invokedSaveArgs = [];

beforeEach(() => {
  invokedSaveArgs = [];
  window.ipcRenderer = {
    invoke: jest.fn((...args) => {
      invokedSaveArgs.push(args);
      return Promise.resolve(true);
    })
  };
});

const flushPromises = () => Promise.resolve().then(() => Promise.resolve());

const createCollectionsStore = (collectionOverrides = {}) => configureStore({
  reducer: {
    collections: collectionsReducer
  },
  preloadedState: {
    collections: {
      collections: [
        {
          uid: COLLECTION_UID,
          pathname: '/coll',
          root: {
            request: {
              headers: [],
              auth: { mode: 'none' },
              script: { req: '', res: '' },
              vars: { req: [], res: [] },
              tests: ''
            }
          },
          brunoConfig: { version: '1', name: 'test', type: 'collection' },
          environments: [],
          items: [],
          ...collectionOverrides
        }
      ],
      collectionSortOrder: 'default',
      activeWorkspaceUid: null
    }
  }
});

const createGlobalStore = (environment) => configureStore({
  reducer: {
    globalEnvironments: globalEnvironmentsReducer
  },
  preloadedState: {
    globalEnvironments: {
      globalEnvironments: [environment],
      activeGlobalEnvironmentUid: environment.uid,
      globalEnvironmentDraft: null,
      _scriptGlobalEnvBaseline: null
    }
  }
});

const getCollection = (store) => store.getState().collections.collections[0];
const getCollectionVars = (store) => getCollection(store).root.request.vars.req;
const getSavedCollectionRoot = () => invokedSaveArgs.find(([channel]) => channel === 'renderer:save-collection-root')?.[2];
const getSavedGlobalVariables = () => invokedSaveArgs.find(([channel]) => channel === 'renderer:save-global-environment')?.[1]?.variables;

describe('external secret writeback protection', () => {
  test('preserves an environment row when a protected name is omitted or conflicting', () => {
    const store = createCollectionsStore({
      activeEnvironmentUid: ENV_UID,
      environments: [
        {
          uid: ENV_UID,
          name: 'dev',
          variables: [
            makeVar('HOST', 'https://saved.example'),
            makeVar('API_TOKEN', 'original-token', { secret: true })
          ]
        }
      ]
    });

    store.dispatch(scriptEnvironmentUpdateEvent({
      collectionUid: COLLECTION_UID,
      envVariables: { HOST: 'https://script.example' },
      protectedNames: ['API_TOKEN']
    }));

    let variables = getCollection(store).environments[0].variables;
    expect(variables.find((v) => v.name === 'HOST').value).toBe('https://script.example');
    expect(variables.find((v) => v.name === 'API_TOKEN').value).toBe('original-token');

    store.dispatch(scriptEnvironmentUpdateEvent({
      collectionUid: COLLECTION_UID,
      envVariables: { HOST: 'https://script-2.example', API_TOKEN: 'must-not-enter-redux' },
      protectedNames: ['API_TOKEN']
    }));

    variables = getCollection(store).environments[0].variables;
    expect(variables.find((v) => v.name === 'HOST').value).toBe('https://script-2.example');
    expect(variables.find((v) => v.name === 'API_TOKEN').value).toBe('original-token');
  });

  test('preserves a draft environment value for a protected conflicting name', () => {
    const store = createCollectionsStore({
      activeEnvironmentUid: ENV_UID,
      environmentsDraft: {
        environmentUid: ENV_UID,
        variables: [
          makeVar('HOST', 'https://draft.example'),
          makeVar('API_TOKEN', 'draft-token', { secret: true })
        ]
      },
      environments: [
        {
          uid: ENV_UID,
          name: 'dev',
          variables: [
            makeVar('HOST', 'https://saved.example'),
            makeVar('API_TOKEN', 'saved-token', { secret: true })
          ]
        }
      ]
    });

    store.dispatch(scriptEnvironmentUpdateEvent({
      collectionUid: COLLECTION_UID,
      envVariables: {
        HOST: 'https://script.example',
        API_TOKEN: 'must-not-enter-redux'
      },
      protectedNames: ['API_TOKEN']
    }));

    const variables = getCollection(store).environments[0].variables;
    expect(variables.find((v) => v.name === 'HOST').value).toBe('https://script.example');
    expect(variables.find((v) => v.name === 'API_TOKEN').value).toBe('draft-token');
  });

  test('preserves runtime values for protected names and ignores conflicting incoming values', () => {
    const store = createCollectionsStore({
      runtimeVariables: {
        API_TOKEN: 'safe-existing-token',
        PAGE: '1'
      }
    });

    store.dispatch(runtimeVariablesUpdateEvent({
      collectionUid: COLLECTION_UID,
      runtimeVariables: {
        PAGE: '2',
        API_TOKEN: 'must-not-enter-redux'
      },
      protectedNames: ['API_TOKEN', 'COPIED_TOKEN']
    }));

    expect(getCollection(store).runtimeVariables).toEqual({
      API_TOKEN: 'safe-existing-token',
      PAGE: '2'
    });
  });

  test('preserves collection vars on disk and does not create omitted copied secrets', async () => {
    const store = createCollectionsStore({
      root: {
        request: {
          headers: [],
          auth: { mode: 'none' },
          script: { req: '', res: '' },
          vars: {
            req: [
              makeVar('HOST', 'https://saved.example'),
              makeVar('API_TOKEN', 'original-token', { secret: true })
            ],
            res: []
          },
          tests: ''
        }
      }
    });

    store.dispatch(collectionVariablesUpdateEvent({
      collectionUid: COLLECTION_UID,
      collectionVariables: {
        HOST: 'https://script.example',
        API_TOKEN: 'must-not-enter-redux'
      },
      protectedNames: ['API_TOKEN', 'COPIED_TOKEN']
    }));
    await flushPromises();

    const vars = getCollectionVars(store);
    expect(vars.find((v) => v.name === 'HOST').value).toBe('https://script.example');
    expect(vars.find((v) => v.name === 'API_TOKEN').value).toBe('original-token');
    expect(vars.find((v) => v.name === 'COPIED_TOKEN')).toBeUndefined();

    const savedVars = getSavedCollectionRoot().request.vars.req;
    expect(savedVars.find((v) => v.name === 'API_TOKEN').value).toBe('original-token');
    expect(savedVars.find((v) => v.name === 'COPIED_TOKEN')).toBeUndefined();
  });

  test('preserves global environment vars in state and persisted payload', async () => {
    const store = createGlobalStore({
      uid: GLOBAL_ENV_UID,
      name: 'global-dev',
      variables: [
        makeVar('REGION', 'ap-northeast-2'),
        makeVar('API_TOKEN', 'global-original-token', { secret: true })
      ]
    });

    store.dispatch(globalEnvironmentsUpdateEvent({
      globalEnvironmentVariables: {
        REGION: 'us-east-1',
        API_TOKEN: 'must-not-enter-redux'
      },
      protectedNames: ['API_TOKEN']
    }));
    await flushPromises();

    const variables = store.getState().globalEnvironments.globalEnvironments[0].variables;
    expect(variables.find((v) => v.name === 'REGION').value).toBe('us-east-1');
    expect(variables.find((v) => v.name === 'API_TOKEN').value).toBe('global-original-token');

    const savedVariables = getSavedGlobalVariables();
    expect(savedVariables.find((v) => v.name === 'API_TOKEN').value).toBe('global-original-token');
  });
});
