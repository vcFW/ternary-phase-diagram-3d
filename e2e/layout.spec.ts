import { expect, test } from '@playwright/test';
import { openPage, overflowing, PAGES, SIZES } from './helpers';

/** P3.5：四个尺寸 × 每个页面，顶栏 / 工具条 / 图窗标题条 / 检查器标签均无溢出 */
for (const vp of SIZES)
  for (const route of PAGES) {
    test(`布局无溢出 ${route} · ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openPage(page, route, 'binary-incongruent');
      expect(await overflowing(page)).toEqual([]);
    });
  }

test('x₀ 可编辑输入框只在顶栏；模式切换与冷却播放各只有一处', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ['workspace', 'linear', 'path']) {
    await openPage(page, route, 'binary-incongruent');
    // 顶栏 x₀：3 个输入；T：1 个
    expect(await page.locator('.gbar .numfield input').count(), `${route} 顶栏数值输入`).toBe(4);
    expect(await page.locator('.page .numfield input').count(), `${route} 页面内不应有 x₀ / T 数值输入`).toBe(0);
    expect(await page.locator('.gbar-mode').count()).toBe(1);
    expect(await page.locator('[role="tablist"] button:has-text("成分探索")').count()).toBe(1);
    expect(await page.locator('button[title*="播放冷却"], button[title="暂停"]').count()).toBeLessThanOrEqual(1);
  }
});

test('检查器只有 4 个标签；被移出的内容可在分析页找到', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, 'workspace', 'binary-incongruent');
  expect(await page.locator('.insp-tabs button').count()).toBe(4);
  await openPage(page, 'linear', 'binary-incongruent');
  await page.goto('/#/linear/vectors?p=binary-incongruent');
  await expect(page.getByText('当前状态的向量与连结线').first()).toBeVisible();
  await page.goto('/#/thermo/stability?p=binary-incongruent');
  await expect(page.getByText('平衡解是否为全局最小').first()).toBeVisible();
  await page.goto('/#/path/equilibrium?p=binary-incongruent');
  await expect(page.getByText('演化：冷却与成分探索').first()).toBeVisible();
});

test('空闲预取后切换页面不再出现加载骨架', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, 'workspace', 'binary-incongruent');
  await page.waitForTimeout(3500); // 等待 requestIdleCallback 预取
  await page.evaluate(() => {
    (window as unknown as { __skel: number }).__skel = 0;
    new MutationObserver(() => {
      if (document.querySelector('.page-skel')) (window as unknown as { __skel: number }).__skel++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  for (const r of ['linear', 'rules', 'thermo', 'path', 'lab', 'workspace']) {
    await page.locator(`.nav a[href^="#/${r}"]`).click();
    await page.waitForTimeout(250);
  }
  expect(await page.evaluate(() => (window as unknown as { __skel: number }).__skel)).toBe(0);
});
