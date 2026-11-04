import { expect, test } from '@playwright/test';
import { openPage, overflowing, PAGES, PRESETS, VIEWPORTS } from './helpers';

for (const vp of VIEWPORTS)
  for (const preset of PRESETS)
    for (const route of PAGES) {
      test(`冒烟 ${route} · ${preset} · ${vp.width}×${vp.height}`, async ({ page }) => {
        await page.setViewportSize(vp);
        const errors: string[] = [];
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        page.on('pageerror', (e) => errors.push(String(e)));
        await openPage(page, route, preset);
        expect(await page.locator('.page-error').count(), '页面出现 ErrorBoundary').toBe(0);
        const text = await page.locator('body').innerText();
        expect(text).not.toMatch(/\bNaN\b|Infinity/);
        expect(errors).toEqual([]);
        expect(await overflowing(page), '外壳 / 工具条元素溢出').toEqual([]);
      });
    }
