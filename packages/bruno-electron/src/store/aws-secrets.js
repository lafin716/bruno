const Store = require('electron-store');

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  region: '',
  profile: ''
});

class AwsSecretsStore {
  constructor() {
    this.store = new Store({
      name: 'aws-secrets'
    });
  }

  getSettings() {
    return {
      ...DEFAULT_SETTINGS,
      ...(this.store.get('settings') || {})
    };
  }

  saveSettings(settings = {}) {
    const next = {
      enabled: settings.enabled === true,
      region: typeof settings.region === 'string' ? settings.region.trim() : '',
      profile: typeof settings.profile === 'string' ? settings.profile.trim() : ''
    };
    this.store.set('settings', next);
    return next;
  }
}

const awsSecretsStore = new AwsSecretsStore();

module.exports = {
  awsSecretsStore,
  DEFAULT_SETTINGS
};
