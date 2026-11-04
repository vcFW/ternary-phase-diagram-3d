import { defineConfig } from '@playwright/test';

/**
 * 端到端测试：使用本机 Chrome（channel: 'chrome'），避免下载浏览器。
 * 视觉回归基线用 `npm run e2e:update` 生成。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
});
