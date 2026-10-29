import { test, expect } from '@playwright/test';
import { createFixtureServer } from '../ios/account-flow-fixture.mjs';

test('native simulator fixture completes signup, trial and erasure request through HTTP', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ios', 'iOS bridge fixture check');
  const { server, state } = createFixtureServer();
  await new Promise<void>(resolve => server.listen(54329, '127.0.0.1', resolve));
  try {
    await page.addInitScript(() => Object.assign(window, { webkit: { messageHandlers: { bridge: { postMessage() {} } } } }));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http://127.0.0.1:5187','http://127.0.0.1:54329'].includes(url.origin) ? route.continue() : route.abort();
    });
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click();
    await page.getByLabel('Ad Soyad', { exact: true }).fill('Simulator User');
    await page.getByLabel('İşletme adı', { exact: true }).fill('Simulator Perde');
    await page.getByLabel('E-posta', { exact: true }).fill('ios-smoke@example.test');
    await page.getByLabel('Şifre', { exact: true }).fill('synthetic-password-123');
    await page.getByRole('button', { name: 'Hesabımı oluştur' }).click();
    await expect(page.getByRole('heading', { name: 'E-postanızı doğrulayın' })).toBeVisible();
    await page.getByRole('button', { name: 'Doğruladım, devam et' }).click();
    await expect(page.getByRole('heading', { name: 'Yönetici Paneli' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Diğer', exact: true }).click();
    await page.getByRole('link', { name: 'Ayarlar', exact: true }).click();
    await page.getByRole('button', { name: 'Hesabımı sil', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('deletion-confirmation.png'), fullPage: true });
    await page.getByRole('checkbox').check();
    await page.getByLabel('Silme onayı').fill('SIL');
    await page.getByRole('button', { name: 'Kalıcı silme talebini gönder' }).click();
    await expect(page.getByRole('status')).toContainText('Hesabınız henüz silinmedi');
    await page.getByRole('button', { name: 'Talebin durumunu kontrol et' }).click();
    await expect(page.getByRole('status')).toContainText('Kalıcı hesap silme talebiniz alındı');
    expect(state.signups).toBe(1); expect(state.companies).toBe(1); expect(state.deletionRequests).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('deletion-receipt.png'), fullPage: true });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
