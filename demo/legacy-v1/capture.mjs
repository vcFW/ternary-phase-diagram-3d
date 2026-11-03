// 演示视频逐帧录制：虚拟时钟 + 真实鼠标事件 + 叠加光标/字幕；输出 1920×1080 JPEG 帧序列
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = path.join(ROOT, 'frames');
// 被录制的应用地址（先运行 npm run dev）
const APP_URL = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const FPS = 30;
const VW = 1536;
const VH = 864;
const DPR = 1920 / VW;
const ONLY = process.argv[2]; // 可选：只录某一场景

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
});
const page = await browser.newPage();

// 虚拟时钟：rAF 时间戳与 performance.now 由脚本推进
await page.evaluateOnNewDocument(() => {
  let vnow = 1000;
  window.__vclock = { advance: (ms) => (vnow += ms) };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(vnow));
  Object.defineProperty(performance, 'now', { value: () => vnow, configurable: true });
});
await page.goto(APP_URL, { waitUntil: 'networkidle0' });
// 确认打开的是本应用的开发模式页面（端口可能被其他项目占用）
const ready = await page
  .waitForFunction(() => window.__store && window.__r3f, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
if (!ready) {
  const title = await page.title();
  console.error(`\n${APP_URL} 打开的页面是「${title}」，不是本应用的开发模式页面。`);
  console.error('请在项目根目录运行 npm run dev，并用终端显示的地址重试，例如：');
  console.error('  DEMO_URL=http://127.0.0.1:5174/ npm run capture\n');
  await browser.close();
  process.exit(1);
}
await sleep(2500);

// 叠加层：光标、点击波纹、字幕
await page.addStyleTag({
  content: `
  #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));opacity:0}
  #demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2.5px solid #1e88e5;z-index:99998;pointer-events:none;opacity:0}
  #demo-cap{position:fixed;left:24px;bottom:22px;z-index:99997;pointer-events:none;display:flex;gap:16px;align-items:stretch;
    background:linear-gradient(100deg,rgba(9,18,34,.94),rgba(14,28,52,.90));color:#fff;padding:14px 22px 14px 16px;border-radius:6px;
    box-shadow:0 10px 30px rgba(0,0,0,.28);border-left:3px solid #38bdf8;opacity:0;max-width:760px;font-family:-apple-system,'PingFang SC',sans-serif}
  #demo-cap .num{font:600 26px 'SF Mono',Menlo,monospace;color:#38bdf8;line-height:1;padding-top:2px;letter-spacing:.02em}
  #demo-cap .t{font-size:20px;font-weight:600;letter-spacing:.04em}
  #demo-cap .t em{font-style:normal;font-weight:400;color:#93c5fd;font-size:14px;margin-left:10px;letter-spacing:.08em}
  #demo-cap .s{font-size:14px;color:#cbd5e1;margin-top:5px;line-height:1.5}
  .vp-hint{opacity:0}`,
});
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(c);
  const r = document.createElement('div');
  r.id = 'demo-ripple';
  document.body.appendChild(r);
  const cap = document.createElement('div');
  cap.id = 'demo-cap';
  cap.innerHTML = '<div class="num"></div><div><div class="t"></div><div class="s"></div></div>';
  document.body.appendChild(cap);
  window.__overlay = (st) => {
    c.style.opacity = st.cursorOn ? 1 : 0;
    c.style.left = st.cx + 'px';
    c.style.top = st.cy + 'px';
    if (st.ripple >= 0) {
      r.style.left = st.rx + 'px';
      r.style.top = st.ry + 'px';
      r.style.opacity = String(Math.max(0, 1 - st.ripple));
      r.style.transform = `scale(${0.4 + st.ripple * 0.9})`;
    } else r.style.opacity = 0;
    cap.style.opacity = st.capA;
    cap.style.transform = `translateY(${(1 - st.capA) * 14}px)`;
    if (st.cap) {
      cap.querySelector('.num').textContent = st.cap.num;
      cap.querySelector('.t').innerHTML = `${st.cap.title}<em>${st.cap.en}</em>`;
      cap.querySelector('.s').textContent = st.cap.sub;
    }
  };
});

// ------------------------------------------------------------------ 帧与状态
const cdp = await page.createCDPSession();
const S = { cx: 760, cy: 460, cursorOn: false, ripple: -1, rT: 0, rx: 0, ry: 0, cap: null, capIn: 0, capOut: 99, zoom: { z: 1, x: VW / 2, y: VH / 2 } };
let sceneDir = null;
let fi = 0;
let st = 0; // 场景内时间 / s
let skip = false;

function beginScene(name, cap, dur) {
  skip = !!ONLY && ONLY !== name;
  sceneDir = path.join(FRAMES, name);
  if (!skip) {
    fs.rmSync(sceneDir, { recursive: true, force: true });
    fs.mkdirSync(sceneDir, { recursive: true });
  }
  fi = 0;
  st = 0;
  S.cap = cap;
  S.capIn = 0.5;
  S.capOut = dur - 0.6;
  console.log('scene', name, skip ? '(skip render)' : '');
}

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function frame() {
  await page.evaluate((ms) => window.__vclock.advance(ms), 1000 / FPS);
  const capA = S.cap ? clamp((st - S.capIn) / 0.5, 0, 1) * clamp((S.capOut - st) / 0.5, 0, 1) : 0;
  const ripple = S.rT > 0 ? 1 - S.rT : -1;
  if (S.rT > 0) S.rT = Math.max(0, S.rT - 1 / (FPS * 0.45));
  await page.evaluate((o) => window.__overlay(o), { ...S, capA: ease(capA), ripple });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (!skip) {
    const z = S.zoom.z;
    const w = VW / z;
    const h = VH / z;
    const x = clamp(S.zoom.x - w / 2, 0, VW - w);
    const y = clamp(S.zoom.y - h / 2, 0, VH - h);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x, y, width: w, height: h, scale: z * DPR }, captureBeyondViewport: false });
    fs.writeFileSync(path.join(sceneDir, String(fi).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'));
  }
  fi++;
  st += 1 / FPS;
}

async function tween(dur, fn) {
  const n = Math.max(1, Math.round(dur * FPS));
  for (let k = 1; k <= n; k++) {
    await fn(ease(k / n), k / n);
    await frame();
  }
}
const hold = (dur) => tween(dur, async () => {});

async function moveTo(x, y, dur = 0.8, during) {
  const x0 = S.cx;
  const y0 = S.cy;
  await tween(dur, async (p, lin) => {
    S.cx = x0 + (x - x0) * p;
    S.cy = y0 + (y - y0) * p - Math.sin(Math.PI * p) * 18;
    await page.mouse.move(S.cx, S.cy);
    if (during) await during(p, lin);
  });
}
async function click() {
  await page.mouse.down();
  await page.mouse.up();
  S.rT = 1;
  S.rx = S.cx;
  S.ry = S.cy;
}
async function zoomTo(z, x, y, dur) {
  const a = { ...S.zoom };
  await tween(dur, async (p) => {
    S.zoom = { z: a.z + (z - a.z) * p, x: a.x + (x - a.x) * p, y: a.y + (y - a.y) * p };
  });
}

// 页面内工具：世界坐标投影、元素中心
await page.evaluate(() => {
  const SQ = Math.sqrt(3) / 2;
  window.__w = (c, T) => {
    const tr = window.__store.getState().diagram.tRange;
    const u = c[1] + 0.5 * c[2];
    const v = SQ * c[2];
    return [u - 0.5, ((T - tr[0]) / (tr[1] - tr[0])) * 0.72 - 0.36, -(v - SQ / 3)];
  };
  window.__proj = (c, T) => {
    const { camera } = window.__r3f;
    const p = window.__w(c, T);
    const v = camera.position.clone().set(p[0], p[1], p[2]).project(camera);
    const r = document.querySelector('.viewport canvas').getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  };
  window.__el = (sel, text) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.trim() === text);
    const e = els[0];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  window.__setCam = (az, el, rad) => {
    const { camera, controls } = window.__r3f;
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    camera.position.set(rad * Math.cos(e) * Math.sin(a), rad * Math.sin(e), rad * Math.cos(e) * Math.cos(a));
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.update();
  };
  // 三角图像素映射（与 TernaryAxes.makeTriMap 一致）
  window.__tri = (sel, c) => {
    const svg = document.querySelector(sel + ' svg.chart-svg');
    const r = svg.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    const side = Math.min(w - 68, ((h - 70) * 2) / Math.sqrt(3));
    const triH = (side * Math.sqrt(3)) / 2;
    const ox = 34 + (w - 68 - side) / 2;
    const oy = 26 + (h - 70 - triH) / 2 + triH;
    const u = c[1] + 0.5 * c[2];
    const v = SQ * c[2];
    return [r.left + ox + u * side, r.top + oy - v * side];
  };
});
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const store = (code) => page.evaluate(`(() => { const s = window.__store.getState(); ${code} })()`);
const el = (sel, text) => ev((s, t) => window.__el(s, t), sel, text ?? null);
const proj = (c, T) => ev((c, T) => window.__proj(c, T), c, T);
const C2K = (c) => c + 273.15;

// 初始：最大化三维视图
await store(`s.setT(${C2K(780)}); s.setComp([0.6,0.25,0.15]); s.select(null);`);
await page.click('.viewport-card .card-head .btn');
await sleep(500);

// ================================================================== S1 全景环绕
beginScene('s1_orbit', { num: '01', title: '三维相图全景', en: '3D PHASE DIAGRAM', sub: '成分三角形 × 温度轴：液相面、单变线、二元与三元共晶点均由相平衡方程精确求解' }, 9);
S.cursorOn = false;
await tween(9, async (p, lin) => {
  await ev((a) => window.__setCam(a[0], a[1], a[2]), [-78 + 92 * lin, 30 + 10 * lin, 2.75 - 0.4 * p]);
});

// ================================================================== S2 拾取与查询
beginScene('s2_pick', { num: '02', title: '点 · 线 · 面 交互拾取', en: 'PICK & QUERY', sub: '悬停显示成分与温度，单击选中初晶面、单变线或不变点并查看物理意义' }, 10);
await ev(() => window.__setCam(-12, 38, 2.3));
S.cx = 1100;
S.cy = 640;
S.cursorOn = true;
await hold(0.4);
{
  const c = [0.1, 0.12, 0.78];
  const T = await ev((c) => window.__store.getState().diagram.liquidus(c).T, c);
  const [x, y] = await proj(c, T);
  await moveTo(x, y, 1.1);
  await hold(0.9);
  await click();
  await hold(1.2);
  const m = await ev(() => {
    const s = window.__store.getState().diagram.mono['02'].samples[150];
    return [s.y, s.T];
  });
  const [mx, my] = await proj(m[0], m[1]);
  await moveTo(mx, my, 1.0);
  await hold(0.8);
  await click();
  await hold(1.1);
  const E = await ev(() => window.__store.getState().diagram.eutectic);
  const [ex, ey] = await proj(E.comp, E.T);
  await moveTo(ex, ey, 0.9);
  await hold(1.6);
}
await store(`s.select(null); s.setHover(null);`);

// 还原布局（场景间剪切）
await page.click('.viewport-card .card-head .btn');
await sleep(400);
await store(`s.setT(${C2K(1150)}); s.setView('iso');`);
for (let k = 0; k < 20; k++) await ev((ms) => window.__vclock.advance(ms), 33);
await sleep(300);

// ================================================================== S3 等温截面
beginScene('s3_iso', { num: '03', title: '等温截面 · 拖动切片', en: 'ISOTHERMAL SECTION', sub: '拖动三维切片改变温度，截面多边形由等温线与连结三角形精确构造，二维视图实时同步' }, 13);
S.cursorOn = true;
S.cx = 700;
S.cy = 700;
{
  const c = [0.28, 0.34, 0.38];
  const [gx, gy] = await proj(c, C2K(1150));
  await moveTo(gx, gy, 0.9);
  await hold(0.3);
  await page.mouse.down();
  const [tx, ty] = await proj(c, C2K(700));
  await moveTo(tx, ty, 4.2);
  await page.mouse.up();
  await hold(0.6);
  // 二维等温截面：切换为"选相区"并单击 L+A+B 连结三角形
  const [bx, by] = await el('.tri-card button', '单击选相区');
  await zoomTo(1.45, 1240, 260, 1.2);
  await moveTo(bx, by, 0.8);
  await click();
  await hold(0.3);
  const cen = await ev(() => {
    const d = window.__store.getState().diagram;
    const m = d.monoAt(0, 1, window.__store.getState().T);
    return [(1 + 0 + m[0]) / 3, (0 + 1 + m[1]) / 3, m[2] / 3];
  });
  const [lx, ly] = await ev((c) => window.__tri('.tri-card', c), cen);
  await moveTo(lx, ly, 0.8);
  await click();
  await hold(0.4);
  await zoomTo(1, VW / 2, VH / 2, 1.2);
  await hold(1.6);
}
await store(`s.select(null);`);
await page.click('.tri-card button:nth-of-type(1)').catch(() => {});
{
  const b = await el('.tri-card button', '单击设成分');
  if (b) await page.mouse.click(b[0], b[1]);
}

// ================================================================== S4 垂直截面
beginScene('s4_vert', { num: '04', title: '垂直截面 · 几何求交', en: 'VERTICAL SECTION', sub: '截平面与液相面、直纹面、共晶面实时求交；锁定模式下成分点随截面联动' }, 11);
S.cursorOn = true;
{
  const [cx, cy] = await ev(() => {
    const lab = [...document.querySelectorAll('label.toggle')].find((l) => l.textContent.trim() === '垂直截面');
    const r = lab.getBoundingClientRect();
    return [r.left + 8, r.top + r.height / 2];
  });
  await moveTo(cx, cy, 0.9);
  await click();
  await hold(0.6);
  const gc = [0.425, 0.425, 0.15];
  const [gx, gy] = await proj(gc, C2K(1380));
  await moveTo(gx, gy, 0.9);
  await hold(0.2);
  await page.mouse.down();
  const [tx, ty] = await proj([0.31, 0.31, 0.38], C2K(1380));
  await moveTo(tx, ty, 3.2);
  await page.mouse.up();
  await hold(0.3);
  await zoomTo(1.45, 1240, 580, 1.1);
  await hold(1.8);
  await zoomTo(1, VW / 2, VH / 2, 1.0);
  await hold(0.4);
}

// ================================================================== S5 液相面投影
beginScene('s5_proj', { num: '05', title: '液相面投影 · 二维与三维联动', en: 'LIQUIDUS PROJECTION', sub: '等温线、单变线（箭头指向降温方向）、共晶点与结晶路径投影到成分三角形' }, 11);
S.cursorOn = true;
await store(`s.setLayer('vertSlice',{visible:false}); s.setComp([0.6,0.25,0.15]); s.setT(${C2K(700)});`);
{
  const [px, py] = await el('.tri-card button', '液相面投影');
  await moveTo(px, py, 0.9);
  await click();
  await hold(0.5);
  await zoomTo(1.5, 1240, 250, 1.1);
  const [tx, ty] = await el('.tri-card button', '温度色图');
  await moveTo(tx, ty, 0.8);
  await click();
  await hold(1.0);
  const m = await ev(() => window.__store.getState().diagram.mono['12'].samples[200].y);
  const [mx, my] = await ev((c) => window.__tri('.tri-card', c), m);
  await moveTo(mx, my, 1.0);
  await hold(0.4);
  await zoomTo(1.0, VW / 2, VH / 2, 1.2);
  await hold(1.0);
  const [fx, fy] = await el('.tri-card button', '初晶区');
  await moveTo(fx, fy, 0.9);
  await click();
  await hold(0.8);
}

// ================================================================== S6 冷却模拟
beginScene('s6_cool', { num: '06', title: '平衡冷却模拟', en: 'COOLING SIMULATION', sub: '初晶析出 → 二元共晶 → 三元共晶恒温反应：杠杆规则实时计算相分数，示意冷却曲线出现平台' }, 15);
await store(`s.setLinkedHover(null); s.setHover(null); s.setT(${C2K(1150)}); s.seek(0); s.setSpeed(2);`);
{
  const [ix, iy] = await el('.tri-card button', '等温截面');
  await page.mouse.click(ix, iy);
  S.cursorOn = true;
  const [bx, by] = await el('button[title="播放"]');
  await moveTo(bx, by, 0.9);
  await click();
  await zoomTo(1.25, 640, 560, 1.4);
  await hold(4.0);
  await zoomTo(1.3, 1180, 420, 1.4);
  await hold(4.6);
  await zoomTo(1, VW / 2, VH / 2, 1.2);
  await hold(1.2);
}
await store(`s.pause();`);

// ================================================================== S7 模型切换
beginScene('s7_model', { num: '07', title: '可扩展的模型架构', en: 'EXTENSIBLE MODELS', sub: '理想 / 正规溶液模型一键切换，参数可编辑；预留 Fe–C–Mn、Fe–C–Cr 等真实体系数据接口' }, 9);
await store(`s.setT(${C2K(820)});`);
S.cursorOn = true;
{
  const [sx, sy] = await el('.left select');
  await moveTo(sx, sy, 1.0);
  await click();
  await page.select('.left select', 'edu-ideal');
  await hold(1.4);
  await page.click('.viewport-card .card-head .btn');
  await hold(0.6);
  const [tx, ty] = await el('.vp-toolbar button', '俯视');
  await moveTo(tx, ty, 0.8);
  await click();
  await hold(2.0);
  const [ix, iy] = await el('.vp-toolbar button', '重置视角');
  await moveTo(ix, iy, 0.7);
  await click();
  await hold(1.8);
}

await browser.close();
console.log('done');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
