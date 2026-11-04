import type { Page } from '@playwright/test';

export const PAGES = ['workspace', 'linear', 'rules', 'thermo', 'path', 'lab'] as const;
export const PRESETS = ['binary-incongruent', 'ss-eutectic'] as const;
export const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;
export const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const;

export async function openPage(page: Page, route: string, preset: string) {
  await page.goto(`/#/${route}?p=${preset}`);
  await page.waitForSelector('.gbar');
  // 等待懒加载页面与首次计算完成
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

/** 容易溢出的外壳 / 工具条类元素 */
export const OVERFLOW_SELECTORS = ['.gbar', '.tstrip', '.vp-toolbar', '.mfig-title', '.insp-tabs'];

/** 返回 scrollWidth > clientWidth + 2 的元素描述 */
export async function overflowing(page: Page, selectors = OVERFLOW_SELECTORS): Promise<string[]> {
  return page.evaluate((sels) => {
    const out: string[] = [];
    for (const s of sels)
      document.querySelectorAll<HTMLElement>(s).forEach((el) => {
        if (el.offsetParent === null) return;
        if (el.scrollWidth > el.clientWidth + 2) out.push(`${s}: ${el.scrollWidth} > ${el.clientWidth}`);
      });
    return out;
  }, selectors);
}
