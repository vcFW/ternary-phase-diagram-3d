// 发布会演示视频逐帧录制：虚拟时钟 + 真实鼠标事件 + 叠加光标/字幕；输出 1920×1080 JPEG 帧序列
// 每个场景自行导航到对应页面并设置状态，可单独重录：node capture.mjs s3_rules
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = path.join(ROOT, 'frames');
// 被录制的应用地址（先在项目根目录运行 npm run dev）
const APP_URL = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const FPS = 30;
const VW = 1536;
const VH = 864;
const DPR = 1920 / VW;
const ONLY = process.argv.slice(2); // 可选：只录这些场景

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
});
const page = await browser.newPage();
await browser.defaultBrowserContext().overridePermissions(new URL(APP_URL).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
page.on('pageerror', (e) => console.error('pageerror', e.message));

// 虚拟时钟：rAF 时间戳与 performance.now 由脚本推进
await page.evaluateOnNewDocument(() => {
  let vnow = 1000;
  let realFrom = -1; // ≥ 0 时 performance.now 暂时随真实时间流动（用于页面内的计时显示）
  const realNow = performance.now.bind(performance);
  const now = () => (realFrom >= 0 ? vnow + realNow() - realFrom : vnow);
  window.__vclock = {
    advance: (ms) => (vnow += ms),
    real: (on) => {
      if (on && realFrom < 0) realFrom = realNow();
      if (!on && realFrom >= 0) {
        vnow += realNow() - realFrom;
        realFrom = -1;
      }
    },
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(now()));
  Object.defineProperty(performance, 'now', { value: now, configurable: true });
  try {
    localStorage.setItem('nav-collapsed', '0');
  } catch {}
});
await page.goto(APP_URL + '#/workspace', { waitUntil: 'networkidle0' });
// 确认打开的是本应用的开发模式页面（端口可能被其他项目占用）
const ready = await page
  .waitForFunction(() => window.__store && document.querySelector('.shell'), { timeout: 15000 })
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
await sleep(1500);

// 叠加层：光标、点击波纹、字幕
await page.addStyleTag({
  content: `
  #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));opacity:0}
  #demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2.5px solid #1e88e5;z-index:99998;pointer-events:none;opacity:0}
  #demo-cap{position:fixed;z-index:99997;pointer-events:none;display:flex;gap:16px;align-items:flex-start;width:392px;box-sizing:border-box;
    background:linear-gradient(100deg,rgba(9,18,34,.95),rgba(14,28,52,.93));color:#fff;padding:15px 20px 16px 16px;border-radius:8px;
    box-shadow:0 14px 36px rgba(0,0,0,.30);border-left:3px solid #38bdf8;opacity:0;font-family:-apple-system,'PingFang SC',sans-serif}
  #demo-cap .num{font:600 27px 'SF Mono',Menlo,monospace;color:#38bdf8;line-height:1;padding-top:17px;letter-spacing:.02em}
  #demo-cap .en{font:500 11px 'SF Mono',Menlo,monospace;color:#7dd3fc;letter-spacing:.24em}
  #demo-cap .t{font-size:19px;font-weight:600;letter-spacing:.03em;margin-top:5px;line-height:1.35}
  #demo-cap .s{font-size:13.5px;color:#cbd5e1;margin-top:7px;line-height:1.6}
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
  cap.innerHTML = '<div class="num"></div><div><div class="en"></div><div class="t"></div><div class="s"></div></div>';
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
    // 字幕保持屏幕上的固定位置与大小：随放大窗口反向平移、缩放
    const k = st.clip;
    const z = k.z;
    cap.style.opacity = st.capA;
    cap.style.bottom = innerHeight - (k.y + k.h) + 24 / z + 'px';
    cap.style.top = 'auto';
    if (st.cap?.pos === 'br') {
      cap.style.left = 'auto';
      cap.style.right = innerWidth - (k.x + k.w) + 24 / z + 'px';
      cap.style.transformOrigin = 'right bottom';
    } else {
      cap.style.right = 'auto';
      cap.style.left = k.x + 24 / z + 'px';
      cap.style.transformOrigin = 'left bottom';
    }
    cap.style.transform = `translateY(${((1 - st.capA) * 14) / z}px) scale(${1 / z})`;
    if (st.cap) {
      cap.querySelector('.num').textContent = st.cap.num;
      cap.querySelector('.en').textContent = st.cap.en;
      cap.querySelector('.t').textContent = st.cap.title;
      cap.querySelector('.s').textContent = st.cap.sub;
    }
  };

  // 页面内工具
  window.__el = (sel, text) => {
    const e = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim() === text);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  // SliderRow：按标签文字找到滑块，返回把 v 映射到像素的参数
  window.__slider = (label, nth = 0) => {
    const rows = [...document.querySelectorAll('.slider-row')].filter((r) => r.querySelector('.slabel')?.textContent.includes(label));
    const inp = rows[nth]?.querySelector('input[type=range]');
    if (!inp) return null;
    const r = inp.getBoundingClientRect();
    return { left: r.left, width: r.width, y: r.top + r.height / 2, min: +inp.min, max: +inp.max, value: +inp.value };
  };
  // TernaryPlot：由三角形边框求 成分 → 像素
  window.__tp = (k, c) => {
    const poly = document.querySelectorAll('polygon.tp-frame')[k];
    const svg = poly.ownerSVGElement.getBoundingClientRect();
    const P = poly.getAttribute('points').split(' ').map((s) => s.split(',').map(Number));
    return [svg.left + c[0] * P[0][0] + c[1] * P[1][0] + c[2] * P[2][0], svg.top + c[0] * P[0][1] + c[1] * P[1][1] + c[2] * P[2][1]];
  };
  // 工作台图 1 中 x₀ 标记的像素位置
  window.__x0px = () => {
    const ci = [...document.querySelectorAll('.f2-svg circle')].find((e) => e.getAttribute('r') === '7.5');
    const r = ci.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  // 三维相机绕目标转动（方位角 / 仰角增量，单位度）
  window.__orbitBase = null;
  window.__orbit = (dAz, dEl, zoom = 1) => {
    const sc = window.__scene;
    if (!sc) return;
    if (!window.__orbitBase) {
      const p = sc.camera.position;
      const t = sc.controls.target;
      const v = [p.x - t.x, p.y - t.y, p.z - t.z];
      const r = Math.hypot(...v);
      window.__orbitBase = { t: [t.x, t.y, t.z], r, az: Math.atan2(v[0], v[2]), el: Math.asin(v[1] / r) };
    }
    const b = window.__orbitBase;
    const az = b.az + (dAz * Math.PI) / 180;
    const el = b.el + (dEl * Math.PI) / 180;
    const r = b.r * zoom;
    sc.setCamera({ pos: [b.t[0] + r * Math.cos(el) * Math.sin(az), b.t[1] + r * Math.sin(el), b.t[2] + r * Math.cos(el) * Math.cos(az)], target: b.t });
  };
});

// ------------------------------------------------------------------ 帧与状态
const cdp = await page.createCDPSession();
const S = { cx: 760, cy: 460, cursorOn: false, ripple: -1, rT: 0, rx: 0, ry: 0, cap: null, capIn: 0, capOut: 99, zoom: { z: 1, x: VW / 2, y: VH / 2 } };
let sceneDir = null;
let fi = 0;
let st = 0; // 场景内时间 / s
let onFrame = null; // 每帧回调（场景内持续动画，如相机环绕）

function beginScene(name, cap, dur) {
  sceneDir = path.join(FRAMES, name);
  fs.rmSync(sceneDir, { recursive: true, force: true });
  fs.mkdirSync(sceneDir, { recursive: true });
  fi = 0;
  st = 0;
  onFrame = null;
  S.cap = cap;
  S.capIn = 0.6;
  S.capOut = dur - 0.6;
  S.zoom = { z: 1, x: VW / 2, y: VH / 2 };
  S.rT = 0;
  console.log('scene', name);
}

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function frame() {
  await page.evaluate((ms) => window.__vclock.advance(ms), 1000 / FPS);
  if (onFrame) await onFrame(st);
  const capA = S.cap ? clamp((st - S.capIn) / 0.5, 0, 1) * clamp((S.capOut - st) / 0.5, 0, 1) : 0;
  const ripple = S.rT > 0 ? 1 - S.rT : -1;
  if (S.rT > 0) S.rT = Math.max(0, S.rT - 1 / (FPS * 0.45));
  const z = S.zoom.z;
  const w = VW / z;
  const h = VH / z;
  const x = clamp(S.zoom.x - w / 2, 0, VW - w);
  const y = clamp(S.zoom.y - h / 2, 0, VH - h);
  await page.evaluate((o) => window.__overlay(o), { ...S, capA: ease(capA), ripple, clip: { x, y, w, h, z } });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x, y, width: w, height: h, scale: z * DPR }, captureBeyondViewport: false });
  fs.writeFileSync(path.join(sceneDir, String(fi).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'));
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
/** 按住拖动：沿一组像素点（Catmull-Rom 平滑）移动 */
async function dragPath(pts, dur) {
  await page.mouse.down();
  const all = [[S.cx, S.cy], ...pts];
  const seg = all.length - 1;
  await tween(dur, async (p) => {
    const u = p * seg;
    const i = Math.min(seg - 1, Math.floor(u));
    const t = u - i;
    const P0 = all[Math.max(0, i - 1)];
    const P1 = all[i];
    const P2 = all[i + 1];
    const P3 = all[Math.min(seg, i + 2)];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    S.cx = cr(P0[0], P1[0], P2[0], P3[0]);
    S.cy = cr(P0[1], P1[1], P2[1], P3[1]);
    await page.mouse.move(S.cx, S.cy);
  });
  await page.mouse.up();
}
async function click() {
  await page.mouse.down();
  await page.mouse.up();
  S.rT = 1;
  S.rx = S.cx;
  S.ry = S.cy;
}
async function clickAt(pt, dur = 0.8) {
  await moveTo(pt[0], pt[1], dur);
  await hold(0.12);
  await click();
}
async function zoomTo(z, x, y, dur) {
  const a = { ...S.zoom };
  await tween(dur, async (p) => {
    S.zoom = { z: a.z + (z - a.z) * p, x: a.x + (x - a.x) * p, y: a.y + (y - a.y) * p };
  });
}

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const store = (code) => page.evaluate(`(() => { const s = window.__store.getState(); ${code} })()`);
const el = async (sel, text) => {
  const p = await ev((s, t) => window.__el(s, t), sel, text ?? null);
  if (!p) throw new Error(`element not found: ${sel} ${text ?? ''}`);
  return p;
};
const slider = async (label, nth = 0) => {
  const s = await ev((l, n) => window.__slider(l, n), label, nth);
  if (!s) throw new Error('slider not found: ' + label);
  const px = (v) => s.left + 8 + ((v - s.min) / (s.max - s.min)) * (s.width - 16);
  return { ...s, px, at: (v) => [px(v), s.y], thumb: [px(s.value), s.y] };
};
const tp = (k, c) => ev((k, c) => window.__tp(k, c), k, c);
const C2K = (c) => c + 273.15;

/** 场景间：切换页面 / 状态（不录帧），等待渲染稳定 */
async function go(hash, setup = '') {
  await ev((h) => {
    if (location.hash.split('?')[0] !== h) location.hash = h;
  }, hash);
  await sleep(600);
  if (setup) await store(setup);
  await settle(1200);
}
async function settle(ms) {
  const n = Math.round(ms / 33);
  for (let k = 0; k < n; k++) {
    await ev(() => window.__vclock.advance(33));
    await ev(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await sleep(200);
}

const BASE = `s.setMode('composition'); s.setPlaying(false);`;
const scenes = [];
const scene = (name, fn) => scenes.push({ name, fn });

// ================================================================== S1 相图工作台
scene('s1_workspace', async () => {
  await go('#/workspace', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)}); s.setCamera(null);`);
  await ev(() => (window.__orbitBase = null));
  await ev(() => window.__scene?.setView('iso'));
  await settle(1500);
  beginScene('s1_workspace', { num: '01', pos: 'br', title: '相图工作台', en: 'WORKSPACE', sub: '三维液相面、二维截面与检查器同屏联动：拖动状态点，平衡相、相分数与自由度即时求解' }, 17);
  S.capIn = 3.2;
  onFrame = (t) => ev((t) => window.__orbit(-30 * Math.sin((t / 17) * Math.PI * 0.9), 5 * Math.sin((t / 17) * Math.PI), 1), t);
  // 开场：放大三维视图，随后拉远露出整个工作台
  S.zoom = { z: 1.75, x: 880, y: 500 };
  S.cx = 560;
  S.cy = 700;
  await hold(2.2);
  await zoomTo(1, VW / 2, VH / 2, 1.6);
  S.cursorOn = true;
  await hold(0.2);
  const x0 = await ev(() => window.__x0px());
  await moveTo(x0[0], x0[1], 1.0);
  await hold(0.2);
  // 以 x₀ 标记为起点按像素位移拖动（图 1 为画布绘制，没有可查询的三角形边框）
  await dragPath(
    [
      [x0[0] + 40, x0[1] + 10],
      [x0[0] + 85, x0[1] - 25],
      [x0[0] + 60, x0[1] - 80],
      [x0[0] + 10, x0[1] - 55],
    ],
    4.2,
  );
  await hold(0.6);
  const sl = await slider('截面温度');
  await moveTo(sl.thumb[0], sl.thumb[1], 0.9);
  await dragPath([sl.at(760), sl.at(560), sl.at(700)], 4.4);
  await hold(2.0);
  onFrame = null;
});

// ================================================================== S2 线性代数
scene('s2_linear', async () => {
  await go('#/linear/lever', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)});`);
  beginScene('s2_linear', { num: '02', title: '线性代数 · 相分数即线性方程组', en: 'LINEAR ALGEBRA', sub: '杠杆规则与重心规则是同一个约束线性系统 A f = b：秩、奇异值、条件数与列主元消元逐步展开' }, 12);
  S.cursorOn = true;
  S.cx = 700;
  S.cy = 420;
  await hold(0.5);
  const sl = await slider('f(L)');
  await moveTo(sl.thumb[0], sl.thumb[1], 1.0);
  await dragPath([sl.at(0.55), sl.at(0.3), sl.at(0.62)], 3.8);
  await hold(0.4);
  await zoomTo(1.55, 1215, 520, 1.3);
  await hold(2.2);
  await zoomTo(1, VW / 2, VH / 2, 1.1);
  await hold(1.4);
});

// ================================================================== S3 规则与定理
scene('s3_rules', async () => {
  await go('#/rules/alkemade', `${BASE} s.loadPreset('binary-congruent');`);
  await settle(800);
  // 选择 D/C 界线（与 D–C 连线相交，存在温度极大点）
  const opt = await ev(() => {
    const sel = document.querySelector('.ap-main select');
    const o = [...sel.options].find((o) => o.textContent.includes('D/C') || o.textContent.includes('C/D'));
    return o ? o.value : null;
  });
  if (opt !== null) await page.select('.ap-main select', opt);
  await settle(800);
  beginScene('s3_rules', { num: '03', title: '相图规则 · 每条都有推导', en: 'RULES & THEOREMS', sub: 'Alkemade 定理由 Gibbs–Duhem 方程的线性相关推出 dT = 0；每条规则五层展开：假设 · 几何 · 推导 · 物理 · 反例' }, 12);
  S.cursorOn = true;
  S.cx = 820;
  S.cy = 640;
  await hold(0.5);
  const sl = await slider('位置');
  await moveTo(sl.thumb[0], sl.thumb[1], 1.0);
  await dragPath([sl.at(0.05), sl.at(0.95), sl.at(0.5)], 4.6);
  await hold(0.4);
  await zoomTo(1.5, 1260, 420, 1.3);
  await hold(2.4);
  await zoomTo(1, VW / 2, VH / 2, 1.0);
  await hold(0.6);
});

// ================================================================== S4 吉布斯自由能
scene('s4_thermo', async () => {
  await go('#/thermo/binary', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)});`);
  beginScene('s4_thermo', { num: '04', title: '吉布斯自由能 · 公切线', en: 'GIBBS ENERGY', sub: '稳定相组合 = 自由能曲线的下凸包；拖动温度，公切线、化学势与 T–x 相图同步生成' }, 12);
  S.cursorOn = true;
  S.cx = 900;
  S.cy = 300;
  await hold(0.4);
  await clickAt(await el('.ap-main button', '固溶体演示模型'), 0.9);
  await hold(0.9);
  const sl = await slider('T');
  await moveTo(sl.thumb[0], sl.thumb[1], 0.9);
  // 固溶体演示模型的两相区约在 1040–1320 °C：在这一段来回拖动，公切线始终可见
  await dragPath([sl.at(1305), sl.at(1060), sl.at(1190)], 5.2);
  await hold(1.0);
  await zoomTo(1.35, 760, 300, 1.0);
  await hold(1.0);
  await zoomTo(1, VW / 2, VH / 2, 0.8);
});

// ================================================================== S5 三元公切面 = 线性规划
scene('s5_lp', async () => {
  await go('#/thermo/ternary', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)});`);
  beginScene('s5_lp', { num: '05', title: '吉布斯能最小化 = 线性规划', en: 'OPTIMIZATION', sub: '原问题求相分数（杠杆），对偶变量就是化学势（公切面）；与构造式求解器独立对照，差值 < 10⁻⁸ J/mol' }, 10);
  S.cursorOn = true;
  S.cx = 900;
  S.cy = 600;
  await hold(0.4);
  await zoomTo(1.3, 1260, 330, 1.2);
  await hold(1.4);
  await zoomTo(1, VW / 2, VH / 2, 1.0);
  const a = await tp(0, [0.4, 0.3, 0.3]);
  await moveTo(a[0], a[1], 0.9);
  const pts = [];
  for (const c of [[0.3, 0.42, 0.28], [0.22, 0.38, 0.4], [0.35, 0.25, 0.4], [0.42, 0.3, 0.28]]) pts.push(await tp(0, c));
  await dragPath(pts, 3.6);
  await hold(1.3);
});

// ================================================================== S6 凝固路径
scene('s6_path', async () => {
  await go('#/path/equilibrium', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setMode('cooling'); s.setIdx(0); s.setSpeed(1);`);
  // 让整段冷却约 7.5 秒播完
  const n = await ev(() => window.__store.getState().trace.samples.length);
  const plat = await ev(() => window.__store.getState().trace.samples.filter((s) => s.xi >= 0).length);
  const speed = (plat / 9 + (n - plat) / 55) / 7.5;
  await store(`s.setSpeed(${speed.toFixed(3)});`);
  beginScene('s6_path', { num: '06', title: '凝固路径 · 逐步推演', en: 'SOLIDIFICATION', sub: '平衡冷却的每一时刻都满足 x₀ = Σ fᵢcᵢ：事件、守恒残差与反应矩阵随温度逐步给出' }, 12.5);
  S.cursorOn = true;
  S.cx = 700;
  S.cy = 650;
  await hold(0.4);
  await clickAt(await el('.ap-main button', '播放'), 0.9);
  await hold(0.5);
  S.cursorOn = false;
  await zoomTo(1.25, 1060, 400, 1.4);
  await hold(5.2);
  await zoomTo(1, VW / 2, VH / 2, 1.2);
  await hold(2.6);
});

// ================================================================== S7 数学实验与验证
scene('s7_lab', async () => {
  await go('#/lab/validation', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)});`);
  await ev(() => document.querySelector('.ap-main')?.scrollTo(0, 0));
  beginScene('s7_lab', { num: '07', title: '数学实验 · 可复现验证', en: 'VERIFIED', sub: '10 组验证算例与自动测试同源：解析解、独立数值方法与文献公式三方对照，误差与容差逐项列出' }, 11);
  S.cursorOn = true;
  S.cx = 900;
  S.cy = 400;
  await hold(0.4);
  await ev(() => window.__vclock.real(true));
  await clickAt(await el('.ap-main button', '重新运行'), 0.9);
  await sleep(300);
  await ev(() => window.__vclock.real(false));
  await hold(0.5);
  await zoomTo(1.6, 700, 200, 1.0);
  await hold(1.4);
  await zoomTo(1, VW / 2, VH / 2, 0.9);
  S.cursorOn = false;
  const h = await ev(() => {
    const m = document.querySelector('.ap-main');
    return m.scrollHeight - m.clientHeight;
  });
  await tween(5.0, (p) => ev((y) => document.querySelector('.ap-main').scrollTo(0, y), p * Math.min(h, 2600)));
  await hold(0.8);
});

// ================================================================== S8 全局状态 · 拓扑实时重算
scene('s8_live', async () => {
  await go('#/workspace', `${BASE} s.loadPreset('binary-incongruent'); s.setX0([0.4,0.3,0.3], true, true); s.setT(${C2K(653)}); s.setCamera(null);`);
  await ev(() => (window.__orbitBase = null));
  await ev(() => window.__scene?.setView('iso'));
  await settle(1500);
  beginScene('s8_live', { num: '08', pos: 'br', title: '一个全局状态 · 拓扑实时重算', en: 'LIVE MODEL', sub: '调大化合物稳定度：不一致熔融 → 一致熔融，转熔线、过渡点与温度极大点随之出现；整个状态写入可分享的深链接' }, 13);
  S.cursorOn = true;
  S.cx = 1000;
  S.cy = 300;
  await hold(0.4);
  await clickAt(await el('.gbar button', '热力学参数'), 1.0);
  await hold(0.7);
  const sl = await slider('化合物稳定度');
  await moveTo(sl.thumb[0], sl.thumb[1], 0.9);
  await hold(0.2);
  await dragPath([sl.at(sl.value + 0.6), sl.at(3.2), sl.at(5.2)], 5.0);
  await hold(1.2);
  // 关闭弹出框，放大三维视图看重算后的拓扑
  await clickAt([620, 120], 0.8);
  await hold(0.3);
  S.cursorOn = false;
  onFrame = (t) => ev((u) => window.__orbit(-34 * u, 6 * u, 1), clamp((t - 9.1) / 3.9, 0, 1));
  await zoomTo(1.6, 880, 500, 1.3);
  await hold(2.6);
});

// ------------------------------------------------------------------ 执行
for (const sc of scenes) {
  if (ONLY.length && !ONLY.includes(sc.name)) continue;
  await sc.fn();
}
await browser.close();
console.log('done');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
