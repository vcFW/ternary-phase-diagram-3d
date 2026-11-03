// 片头/片尾逐帧渲染（1920×1080）
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('file://' + path.join(ROOT, 'title.html'), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
for (const [kind, dur] of [['intro', 5.5], ['outro', 7.5]]) {
  const dir = path.join(ROOT, 'frames', kind);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(dur * 30);
  for (let f = 0; f < n; f++) {
    await page.evaluate((k, t, d) => window.render(k, t, d), kind, f / 30, dur);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    fs.writeFileSync(path.join(dir, String(f).padStart(5, '0') + '.jpg'), buf);
  }
  console.log(kind, n);
}
await browser.close();
