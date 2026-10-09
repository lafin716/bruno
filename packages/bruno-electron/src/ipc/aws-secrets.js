const { ipcMain } = require('electron');
const { awsSecretsStore } = require('../store/aws-secrets');
const { testAwsSecret } = require('../services/aws-secrets');

const registerAwsSecretsIpc = () => {
  ipcMain.handle('renderer:get-aws-secrets-settings', async () => {
    return awsSecretsStore.getSettings();
  });

  ipcMain.handle('renderer:save-aws-secrets-settings', async (event, settings) => {
    return awsSecretsStore.saveSettings(settings);
  });

  ipcMain.handle('renderer:test-aws-secret', async (event, args) => {
    return testAwsSecret(args);
  });
};

module.exports = registerAwsSecretsIpc;
