import { expect, test } from '@playwright/test';
import { openPage } from './helpers';

/** 性能预算：PerformanceObserver(longtask) 记录主线程长任务 */
async function observe(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] });
  });
}
const longTasks = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);

test.describe('性能预算', () => {
  test('切换到 ss-eutectic：无 > 100 ms 长任务', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPage(page, 'workspace', 'binary-incongruent');
    await observe(page);
    await page.evaluate(() => (window as unknown as { __store: { getState: () => { loadPreset: (id: string) => void } } }).__store.getState().loadPreset('ss-eutectic'));
    await page.waitForFunction(() => !(window as unknown as { __store: { getState: () => { computing: boolean } } }).__store.getState().computing, null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const lt = await longTasks(page);
    console.log('切换体系长任务(ms):', lt.map((v) => v.toFixed(0)).join(', ') || '无');
    expect(Math.max(0, ...lt)).toBeLessThanOrEqual(100);
  });

  for (const [preset, budget] of [['binary-incongruent', 50], ['ss-eutectic', 80]] as const) {
    test(`${preset}：连续设置 T、x₀ 各 10 次，单次长任务 ≤ ${budget} ms`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openPage(page, 'workspace', preset);
      await page.waitForTimeout(1500);
      await observe(page);
      await page.evaluate(async () => {
        const st = (window as unknown as { __store: { getState: () => { T: number; setT: (T: number) => void; setX0: (x: number[], k?: boolean) => void } } }).__store;
        const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
        const T0 = st.getState().T;
        for (let i = 0; i < 10; i++) {
          st.getState().setT(T0 - 5 * i);
          await frame();
        }
        for (let i = 0; i < 10; i++) {
          const a = 0.4 + 0.01 * i;
          st.getState().setX0([a, 0.3, 0.7 - a], true);
          await frame();
        }
      });
      await page.waitForTimeout(2500);
      const lt = await longTasks(page);
      console.log(`${preset} 长任务(ms):`, lt.map((v) => v.toFixed(0)).join(', ') || '无');
      expect(Math.max(0, ...lt)).toBeLessThanOrEqual(budget);
    });
  }
});
