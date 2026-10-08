const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnvironment, stringifyEnvironment } = require('@usebruno/filestore');
const { validateAwsExternalSecrets } = require('@usebruno/requests');
const { getCollectionFormat, withFileLock, writeFile } = require('../utils/filesystem');

// Read under the same lock as ordinary environment saves, so changing references
// does not overwrite variable edits that reached disk while the editor was open.
const saveExternalSecrets = async (collectionPath, environmentName, externalSecrets) => {
  if (typeof environmentName !== 'string' || !environmentName.trim()
    || environmentName === '.' || environmentName === '..'
    || /[/\\\0]/.test(environmentName)) {
    throw new Error('Invalid environment name');
  }
  if (externalSecrets && (externalSecrets.type !== 'aws-secrets-manager' || !Array.isArray(externalSecrets.variables))) {
    throw new Error('Invalid AWS external secret references');
  }
  validateAwsExternalSecrets(externalSecrets);
  const format = getCollectionFormat(collectionPath);
  const filePath = path.join(collectionPath, 'environments', `${environmentName}.${format === 'yml' ? 'yml' : 'bru'}`);
  await withFileLock(filePath, async () => {
    const content = await fs.readFile(filePath, 'utf8');
    const environment = await parseEnvironment(content, { format });
    if (externalSecrets?.variables?.length) {
      environment.externalSecrets = externalSecrets;
    } else {
      delete environment.externalSecrets;
    }
    await writeFile(filePath, await stringifyEnvironment(environment, { format }));
  });
};

module.exports = { saveExternalSecrets };
