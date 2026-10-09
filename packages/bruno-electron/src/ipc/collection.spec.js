const { ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

jest.mock('electron', () => {
  const handlers = {};
  return {
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
      on: jest.fn(),
      emit: jest.fn(),
      _getHandler: (channel) => handlers[channel]
    },
    app: {
      getPath: jest.fn(() => require('node:os').tmpdir()),
      getVersion: jest.fn(() => '2.0.0')
    },
    dialog: {
      showOpenDialog: jest.fn()
    }
  };
});

jest.mock('../utils/filesystem', () => ({
  ...jest.requireActual('../utils/filesystem'),
  copyPathTo: jest.fn(),
  writeFile: jest.fn(async () => {}),
  removePath: jest.fn(),
  getPaths: jest.fn(async (src) => [src]),
  withDirLock: jest.fn((dir, cb) => cb()),
  getUniqueRenamePath: jest.fn((p) => p)
}));

jest.mock('../cache/requestUids', () => ({
  moveRequestUid: jest.fn(),
  deleteRequestUid: jest.fn(),
  syncExampleUidsCache: jest.fn()
}));

jest.mock('../utils/constants', () => ({
  REQUEST_TYPES: ['http-request', 'graphql-request', 'grpc-request', 'ws-request']
}));

jest.mock('../app/collection-watcher', () => {
  const path = require('node:path');
  const os = require('node:os');
  return {
    getAllWatcherPaths: jest.fn(() => [
      path.join(os.tmpdir(), 'fake', 'source'),
      path.join(os.tmpdir(), 'fake', 'target')
    ])
  };
});

jest.mock('@usebruno/filestore', () => ({
  parseRequest: jest.fn(() => ({})),
  stringifyRequest: jest.fn(() => 'mock-content-stringified'),
  parseEnvironment: jest.fn(),
  stringifyEnvironment: jest.fn()
}));

const fsPromises = require('node:fs').promises;
jest.spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});
jest.spyOn(fsPromises, 'readFile').mockImplementation(async () => 'mock-content');

// Load collection.js to register IPC handlers
const registerCollectionsIpc = require('./collection');

const { copyPathTo } = require('../utils/filesystem');
const { moveRequestUid } = require('../cache/requestUids');

describe('IPC collection handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerCollectionsIpc({}, {});
  });

  it('preserves references from disk when an ordinary variable save has a stale snapshot', async () => {
    const { parseEnvironment, stringifyEnvironment } = require('@usebruno/filestore');
    const references = { type: 'aws-secrets-manager', variables: [{ name: 'TOKEN', value: '{"secretId":"new/reference"}' }] };
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const existsSpy = jest.spyOn(require('fs-extra'), 'existsSync').mockReturnValue(true);
    const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('latest-environment');
    parseEnvironment.mockReturnValue({ name: 'dev', variables: [], externalSecrets: references });
    stringifyEnvironment.mockImplementation((environment) => JSON.stringify(environment));
    const staleEnvironment = { name: 'dev', variables: [{ name: 'HOST', value: 'edited', enabled: true, secret: false }] };
    await ipcMain._getHandler('renderer:save-environment')({}, path.join(os.tmpdir(), 'fake', 'source'), staleEnvironment);
    expect(stringifyEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      externalSecrets: references,
      variables: staleEnvironment.variables
    }), { format: 'yml' });
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });

  describe('renderer:move-item', () => {
    it('calls moveRequestUid before copyPathTo to prevent observed uid mismatches', async () => {
      const moveItemHandler = ipcMain._getHandler('renderer:move-item');

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      let callOrder = [];
      moveRequestUid.mockImplementation(() => callOrder.push('moveRequestUid'));
      copyPathTo.mockImplementation(async () => callOrder.push('copyPathTo'));

      await moveItemHandler({}, {
        targetDirname: path.join(os.tmpdir(), 'fake', 'target'),
        sourcePathname: path.join(os.tmpdir(), 'fake', 'source', 'request.bru')
      });

      expect(callOrder).toEqual(['moveRequestUid', 'copyPathTo']);
    });
  });

  describe('renderer:move-item-cross-format', () => {
    it('calls moveRequestUid before writing the target file', async () => {
      const moveItemCrossFormatHandler = ipcMain._getHandler('renderer:move-item-cross-format');

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      let callOrder = [];
      moveRequestUid.mockImplementation(() => callOrder.push('moveRequestUid'));
      fsPromises.writeFile.mockImplementation(async () => callOrder.push('writeFile'));

      await moveItemCrossFormatHandler({}, {
        targetDirname: path.join(os.tmpdir(), 'fake', 'target'),
        sourcePathname: path.join(os.tmpdir(), 'fake', 'source', 'request.bru'),
        sourceFormat: 'bru',
        targetFormat: 'yml'
      });

      expect(callOrder).toEqual(['moveRequestUid', 'writeFile']);
    });
  });
});
