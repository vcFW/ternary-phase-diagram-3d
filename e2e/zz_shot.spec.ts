import { test } from '@playwright/test';
test('shot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/rules/phaserule?p=binary-incongruent');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/shot-a.png' });
  await page.goto('/#/linear/lever?p=binary-incongruent');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/shot-b.png' });
});
