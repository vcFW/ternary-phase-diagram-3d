import { expect, test } from '@playwright/test';
import { openPage, PAGES, PRESETS, VIEWPORTS } from './helpers';

for (const vp of VIEWPORTS)
  for (const preset of PRESETS)
    for (const route of PAGES) {
      test(`截图 ${route} · ${preset} · ${vp.width}×${vp.height}`, async ({ page }) => {
        await page.setViewportSize(vp);
        await openPage(page, route, preset);
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot(`${route}-${preset}-${vp.width}.png`, { animations: 'disabled' });
      });
    }
