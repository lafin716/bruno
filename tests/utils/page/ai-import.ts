import { Page } from '@playwright/test';
import { buildCommonLocators } from './locators';

export const buildAiImportLocators = (page: Page) => ({
  tab: () => page.getByTestId('ai-import-tab'),
  url: () => page.getByTestId('ai-import-url'),
  generate: () => page.getByTestId('ai-import-generate'),
  cancel: () => page.getByTestId('ai-import-cancel'),
  preview: () => page.getByTestId('ai-import-preview'),
  continue: () => page.getByTestId('ai-import-continue'),
  error: () => page.getByTestId('import-error-message'),
  locationModal: () => page.getByTestId('import-collection-location-modal'),
  location: () => page.locator('#collection-location'),
  import: () => page.getByTestId('import-collection-location-modal-submit-btn'),
  localSettingsTab: () => page.getByTestId('ai-tab-local'),
  executable: (provider: string) => page.getByTestId(`ai-local-${provider}-executable`),
  testConnection: (provider: string) => page.getByTestId(`ai-local-${provider}-test`),
  connectionFeedback: (provider: string) => page.getByTestId(`ai-local-${provider}-feedback`)
});

export const openAiImport = async (page: Page) => {
  const common = buildCommonLocators(page);
  await common.plusMenu.button().click();
  await common.plusMenu.importCollection().click();
  await buildAiImportLocators(page).tab().click();
};
