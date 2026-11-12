import { expect } from '@playwright/test';
// Fictional office used by the tests to get past the mandatory first-run setup.
export const testOffice = {
  officeName: 'Escritório de Teste',
  userName: 'Pessoa de Teste',
  officeCity: 'Goiânia/GO',
  officeAddress: '',
  appName: 'Magnum Office',
  appDescription: 'Gestão jurídica local',
  lawyers: [{ name: 'Pessoa de Teste', oab: '12345', uf: 'GO', email: '' }],
  noLogo: true,
};
// Older versions (update tests) have no setup step: nothing to do there.
export async function completeTestSetup(page, office = testOffice) {
  const state = await page.evaluate(() => window.advocacia.state());
  if (!state.setupRequired) return;
  await page.evaluate(o => window.advocacia.completeSetup(o), office);
  await expect(page.getByRole('dialog', { name: 'Configure o seu escritório', exact: true })).toHaveCount(0);
}
export async function prepareTestApp(page) {
  const state = await page.evaluate(() => window.advocacia.state());
  if (!state.termsAccepted) {
    await page.getByRole('switch', { name: /^Li e aceito os termos/ }).check();
    await page.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Seu escritório, seus dados', exact: true })).toHaveCount(0);
  }
  await completeTestSetup(page);
  await page.evaluate(() => window.advocacia.saveSettings({ automatic: false, autoDownload: false }));
  await page.evaluate(() =>
    window.advocacia.configureBackups({
      enabled: false,
      dailyNotice: false,
      mode: 'local',
      recipient: '',
      acknowledged: true,
    }),
  );
}
