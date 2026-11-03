import { SQRT3_2, toXY } from './barycentric';
import { colormap } from './colormap';
import { hexToRgb, LIQUID_COLOR, mixRgb, phaseColor, regionCss, regionRgb, solidColor, toC, type RGB } from './colors';
import type { PhaseDiagram } from './diagram';
import type { IsoSection } from './isothermal';
import type { Trace } from './cooling';
import type { Comp, ReactionType } from './types';
import { uOfPoint, type VerticalRaster, type VerticalSpec } from './vertical';

/** 画布绘制：二维视图与三维平面纹理共用，保证"同源"。 */
export interface Theme {
  dark: boolean;
  text: string;
  textDim: string;
  grid: string;
  line: string;
  halo: string;
}

export const THEME_LIGHT: Theme = {
  dark: false,
  text: '#1d2229',
  textDim: '#4b5563',
  grid: 'rgba(0,0,0,0.13)',
  line: '#1d2229',
  halo: 'rgba(255,255,255,0.92)',
};

export function haloText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, th: Theme, color?: string) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = th.halo;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color ?? th.text;
  ctx.fillText(s, x, y);
}

/** 三角形布局：A 左下、B 右下、C 顶 */
export interface TriLayout {
  S: number;
  ox: number;
  oy: number;
  px: (x: Comp) => [number, number];
  inv: (X: number, Y: number) => Comp;
}

export function triLayout(W: number, H: number, pad: number): TriLayout {
  const S = Math.min(W - 2 * pad, (H - 2 * pad) / SQRT3_2);
  const ox = (W - S) / 2;
  const oy = (H + S * SQRT3_2) / 2;
  const px = (x: Comp): [number, number] => {
    const [u, v] = toXY(x);
    return [ox + u * S, oy - v * S];
  };
  const inv = (X: number, Y: number): Comp => {
    const u = (X - ox) / S;
    const v = (oy - Y) / S;
    const c = v / SQRT3_2;
    const b = u - 0.5 * c;
    return [1 - b - c, b, c];
  };
  return { S, ox, oy, px, inv };
}

function polyPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

export function drawTriangleFrame(ctx: CanvasRenderingContext2D, L: TriLayout, d: PhaseDiagram, th: Theme, opts: { grid: boolean; ticks: boolean; fontPx: number }) {
  const A = L.px([1, 0, 0]);
  const B = L.px([0, 1, 0]);
  const C = L.px([0, 0, 1]);
  if (opts.grid) {
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const q = (i + 2) % 3;
        const a: Comp = [0, 0, 0];
        const b: Comp = [0, 0, 0];
        a[i] = t;
        a[j] = 1 - t;
        b[i] = t;
        b[q] = 1 - t;
        const pa = L.px(a);
        const pb = L.px(b);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
    }
    ctx.stroke();
  }
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1.6;
  polyPath(ctx, [A, B, C]);
  ctx.stroke();
  const f = opts.fontPx;
  ctx.font = `600 ${f * 1.15}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sym = d.params.components.map((c) => c.symbol);
  haloText(ctx, sym[0], A[0] - f * 1.1, A[1] + f * 0.9, th, solidColor(0));
  haloText(ctx, sym[1], B[0] + f * 1.1, B[1] + f * 0.9, th, solidColor(1));
  haloText(ctx, sym[2], C[0], C[1] - f * 1.2, th, solidColor(2));
  if (opts.ticks) {
    ctx.font = `${f * 0.78}px system-ui, sans-serif`;
    ctx.fillStyle = th.textDim;
    for (let k = 2; k <= 8; k += 2) {
      const t = k / 10;
      // 边 AB 上刻 xB
      let p = L.px([1 - t, t, 0]);
      ctx.fillText(`${k * 10}`, p[0], p[1] + f * 1.0);
      // 边 BC 上刻 xC
      p = L.px([0, 1 - t, t]);
      ctx.fillText(`${k * 10}`, p[0] + f * 1.0, p[1]);
      // 边 CA 上刻 xA
      p = L.px([t, 0, 1 - t]);
      ctx.fillText(`${k * 10}`, p[0] - f * 1.0, p[1]);
    }
  }
}

/** 化合物（非纯组元）成分点标注 */
export function drawSolidPoints(ctx: CanvasRenderingContext2D, L: TriLayout, d: PhaseDiagram, th: Theme, fontPx: number) {
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of d.solids) {
    if (s.kind === 'element' || s.kind === 'solution') continue;
    const p = L.px(s.n);
    ctx.fillStyle = solidColor(s.index);
    ctx.strokeStyle = th.halo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p[0], p[1], fontPx * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    const off = s.kind === 'binary' ? [fontPx * 1.0, fontPx * 1.0] : [fontPx * 1.1, -fontPx * 0.2];
    haloText(ctx, s.label, p[0] + off[0], p[1] + off[1], th, solidColor(s.index));
  }
}

/** 等温截面：region 扇形 / 连结三角形 / 固相三角形 + 饱和弧 + 连结线 */
export function drawIso(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sec: IsoSection,
  d: PhaseDiagram,
  th: Theme,
  opts: { pad: number; grid: boolean; ticks: boolean; labels: boolean; ties: boolean; fontPx: number; highlight?: string | null; background?: boolean },
): TriLayout {
  const L = triLayout(W, H, opts.pad);
  const A = L.px([1, 0, 0]);
  const B = L.px([0, 1, 0]);
  const C = L.px([0, 0, 1]);
  if (opts.background !== false) {
    ctx.clearRect(0, 0, W, H);
  }
  ctx.save();
  polyPath(ctx, [A, B, C]);
  ctx.clip();
  ctx.fillStyle = regionCss(d, 'L', 1, th.dark);
  ctx.fillRect(0, 0, W, H);
  const order = { solid: 0, two: 1, three: 2 } as const;
  const regs = [...sec.regions].sort((a, b) => order[a.kind] - order[b.kind]);
  for (const r of regs) {
    const pts = r.poly.map((x) => L.px(x));
    polyPath(ctx, pts);
    ctx.fillStyle = regionCss(d, r.key, 1, th.dark);
    if (r.fine) {
      // 下凸包小块：描同色细边以消除相邻小三角形之间的缝隙
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      continue;
    }
    ctx.fill();
    if (opts.highlight && r.key === opts.highlight) {
      ctx.fillStyle = 'rgba(0,114,189,0.22)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  if (opts.ties) {
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const [a, b] of sec.ties) {
      const pa = L.px(a);
      const pb = L.px(b);
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 饱和弧（液相线与等温面的交线）
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1.4, opts.fontPx / 7);
  for (const a of sec.arcs) {
    ctx.beginPath();
    a.pts.forEach((x, i) => {
      const p = L.px(x);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    });
    ctx.stroke();
  }
  ctx.restore();
  drawTriangleFrame(ctx, L, d, th, { grid: opts.grid, ticks: opts.ticks, fontPx: opts.fontPx });
  drawSolidPoints(ctx, L, d, th, opts.fontPx);
  if (opts.labels) {
    ctx.font = `600 ${opts.fontPx * 0.95}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const agg = new Map<string, { a: number; x: number; y: number }>();
    for (const r of sec.regions) {
      const pts = r.poly.map((x) => L.px(x));
      const { area, cx, cy } = centroid(pts);
      if (r.fine) {
        const g = agg.get(r.key) ?? { a: 0, x: 0, y: 0 };
        const A = Math.abs(area);
        g.a += A;
        g.x += A * cx;
        g.y += A * cy;
        agg.set(r.key, g);
        continue;
      }
      if (Math.abs(area) < opts.fontPx * opts.fontPx * (r.kind === 'two' ? 4 : 3)) continue;
      haloText(ctx, r.key.replace(/\+/g, '+'), cx, cy, th);
    }
    agg.forEach((g, k) => {
      if (k === 'L' || g.a < opts.fontPx * opts.fontPx * 4) return;
      haloText(ctx, k, g.x / g.a, g.y / g.a, th);
    });
    // 液相区标签
    const lp = liquidLabelPos(d, sec.T);
    if (lp) {
      const p = L.px(lp);
      haloText(ctx, 'L', p[0], p[1], th);
    }
  }
  return L;
}

function centroid(pts: [number, number][]) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: pts[0][0], cy: pts[0][1] };
  return { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
}

function liquidLabelPos(d: PhaseDiagram, T: number): Comp | null {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  const N = 36;
  for (let i = 1; i < N; i++)
    for (let j = 1; j < N - i; j++) {
      const x: Comp = [i / N, j / N, (N - i - j) / N];
      if (d.th.liquidus(x).T < T) {
        sx += x[0];
        sy += x[1];
        sz += x[2];
        n++;
      }
    }
  if (n < 6) return null;
  return [sx / n, sy / n, sz / n];
}

export interface VLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  Tmin: number;
  Tmax: number;
  uToX: (u: number) => number;
  TToY: (T: number) => number;
  xToU: (X: number) => number;
  yToT: (Y: number) => number;
}

export function vLayout(W: number, H: number, Tmin: number, Tmax: number, m: { l: number; r: number; t: number; b: number }): VLayout {
  const x = m.l;
  const y = m.t;
  const w = W - m.l - m.r;
  const h = H - m.t - m.b;
  return {
    x,
    y,
    w,
    h,
    Tmin,
    Tmax,
    uToX: (u) => x + u * w,
    TToY: (T) => y + ((Tmax - T) / (Tmax - Tmin)) * h,
    xToU: (X) => (X - x) / w,
    yToT: (Y) => Tmax - ((Y - y) / h) * (Tmax - Tmin),
  };
}

const rasterCache = new WeakMap<VerticalRaster, HTMLCanvasElement>();

/** 垂直截面：栅格染色 + 边界 + 液相线 + 标注。返回布局供交互使用。 */
export function drawVertical(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  ras: VerticalRaster,
  d: PhaseDiagram,
  spec: VerticalSpec,
  th: Theme,
  opts: { margin: { l: number; r: number; t: number; b: number }; fontPx: number; labels: boolean; axes: boolean; endNames?: [string, string]; liquidAlpha?: number },
): VLayout {
  const lay = vLayout(W, H, ras.Tmin, ras.Tmax, opts.margin);
  let cv = rasterCache.get(ras);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = ras.W;
    cv.height = ras.H;
    const c2 = cv.getContext('2d')!;
    const img = c2.createImageData(ras.W, ras.H);
    const cols: RGB[] = ras.keys.map((k) => regionRgb(d, k, th.dark));
    const bd = th.dark ? 255 : 20;
    const liqA = opts.liquidAlpha ?? 255;
    for (let j = 0; j < ras.H; j++) {
      for (let i = 0; i < ras.W; i++) {
        const id = ras.labels[j * ras.W + i];
        let edge = false;
        if (i + 1 < ras.W && ras.labels[j * ras.W + i + 1] !== id) edge = true;
        if (j + 1 < ras.H && ras.labels[(j + 1) * ras.W + i] !== id) edge = true;
        const k = (j * ras.W + i) * 4;
        let c = cols[id];
        if (edge) c = mixRgb(c, [bd, bd, bd], 0.55);
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = id === 0 && !edge ? liqA : 255;
      }
    }
    c2.putImageData(img, 0, 0);
    rasterCache.set(ras, cv);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv, lay.x, lay.y, lay.w, lay.h);
  const f = opts.fontPx;
  // 液相线（沿截面）
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1.5, f / 6);
  const U = ras.liquidus.length;
  ctx.save();
  ctx.beginPath();
  ctx.rect(lay.x, lay.y, lay.w, lay.h);
  ctx.clip();
  ctx.beginPath();
  for (let k = 0; k < U; k++) {
    const X = lay.uToX(k / (U - 1));
    const Y = lay.TToY(ras.liquidus[k]);
    if (k) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  }
  ctx.stroke();
  ctx.restore();
  // 化合物竖线（成分点在截面线上）
  ctx.font = `600 ${f}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const comps = d.solids.filter((s) => s.kind === 'binary' || s.kind === 'ternary');
  const infos = d.topo.compounds;
  for (const s of d.solids) {
    if (s.sol) continue;
    const u = uOfPoint(spec, s.n, 1e-6);
    if (u === null) continue;
    const X = lay.uToX(u);
    ctx.strokeStyle = solidColor(s.index);
    ctx.lineWidth = 1.6;
    ctx.setLineDash(s.kind === 'element' ? [] : [5, 3]);
    ctx.beginPath();
    ctx.moveTo(X, lay.y + lay.h);
    ctx.lineTo(X, lay.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (opts.labels && s.kind !== 'element') haloText(ctx, s.label, X, lay.y + lay.h - 3, th, solidColor(s.index));
  }
  void comps;
  void infos;
  // 区域标签
  if (opts.labels) {
    const sum = new Map<number, { n: number; sx: number; sy: number }>();
    const step = Math.max(1, Math.floor(ras.W / 90));
    for (let j = 0; j < ras.H; j += step)
      for (let i = 0; i < ras.W; i += step) {
        const id = ras.labels[j * ras.W + i];
        const e = sum.get(id) ?? { n: 0, sx: 0, sy: 0 };
        e.n++;
        e.sx += i;
        e.sy += j;
        sum.set(id, e);
      }
    ctx.font = `600 ${f * 0.92}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const total = (ras.W / step) * (ras.H / step);
    sum.forEach((e, id) => {
      if (e.n < total * 0.012) return;
      const cx = lay.x + (e.sx / e.n / ras.W) * lay.w;
      const cy = lay.y + (e.sy / e.n / ras.H) * lay.h;
      // 重心若落在别的区域，则改用最近同类像素
      const ci = Math.min(ras.W - 1, Math.max(0, Math.round(((cx - lay.x) / lay.w) * ras.W)));
      const cj = Math.min(ras.H - 1, Math.max(0, Math.round(((cy - lay.y) / lay.h) * ras.H)));
      let X = cx;
      let Y = cy;
      if (ras.labels[cj * ras.W + ci] !== id) {
        let bestD = Infinity;
        for (let j = 0; j < ras.H; j += step)
          for (let i = 0; i < ras.W; i += step)
            if (ras.labels[j * ras.W + i] === id) {
              const dd = (i - ci) * (i - ci) + (j - cj) * (j - cj);
              if (dd < bestD) {
                bestD = dd;
                X = lay.x + ((i + 0.5) / ras.W) * lay.w;
                Y = lay.y + ((j + 0.5) / ras.H) * lay.h;
              }
            }
      }
      haloText(ctx, ras.keys[id], X, Y, th);
    });
  }
  if (opts.axes) {
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(lay.x, lay.y, lay.w, lay.h);
    ctx.fillStyle = th.textDim;
    ctx.font = `${f * 0.85}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const c0 = Math.ceil(toC(ras.Tmin) / 100) * 100;
    for (let c = c0; c <= toC(ras.Tmax); c += 100) {
      const Y = lay.TToY(c + 273.15);
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      ctx.moveTo(lay.x, Y);
      ctx.lineTo(lay.x + lay.w, Y);
      ctx.stroke();
      ctx.fillText(`${c}`, lay.x - 5, Y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const names = opts.endNames ?? ['', ''];
    ctx.fillStyle = th.text;
    ctx.font = `600 ${f}px system-ui, sans-serif`;
    ctx.fillText(names[0], lay.x + 4 + (names[0].length * f) / 4, lay.y + lay.h + 5);
    ctx.fillText(names[1], lay.x + lay.w - 4 - (names[1].length * f) / 4, lay.y + lay.h + 5);
    ctx.save();
    ctx.translate(f * 0.9, lay.y + lay.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = th.textDim;
    ctx.font = `${f * 0.85}px system-ui, sans-serif`;
    ctx.fillText('温度 T / °C', 0, 0);
    ctx.restore();
  }
  return lay;
}

// ---------------------------------------------------------------- 液相面投影

interface ProjBase {
  key: string;
  canvas: HTMLCanvasElement;
  levels: Map<number, [number, number][]>;
}
let projBase: ProjBase | null = null;

export interface ProjOpts {
  pad: number;
  fontPx: number;
  isoStep: number;
  isotherms: boolean;
  boundaries: boolean;
  arrows: boolean;
  invariants: boolean;
  alkemade: boolean;
  fillMode: 'field' | 'temperature';
  dpr: number;
}

function projectionBase(d: PhaseDiagram, W: number, H: number, th: Theme, o: ProjOpts): ProjBase {
  const k = o.dpr;
  const key = `${d.uid}|${W}|${H}|${k}|${o.pad}|${o.fillMode}|${o.isoStep}`;
  if (projBase && projBase.key === key) return projBase;
  W = Math.round(W * k);
  H = Math.round(H * k);
  const L = triLayout(W, H, o.pad * k);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(W, H);
  const Tl = new Float32Array(W * H);
  const lab = new Int16Array(W * H).fill(-1);
  const range = d.tRange();
  const cols = d.solids.map((_, i) => hexToRgb(solidColor(i)));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = L.inv(i + 0.5, j + 0.5);
      if (x[0] < 0 || x[1] < 0 || x[2] < 0) continue;
      const q = d.th.liquidus(x);
      Tl[j * W + i] = q.T;
      lab[j * W + i] = q.si;
    }
  const levels = new Map<number, [number, number][]>();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = lab[j * W + i];
      if (id < 0) continue;
      const k = (j * W + i) * 4;
      let col: RGB;
      if (o.fillMode === 'field') {
        const t = (Tl[j * W + i] - range.Tmin) / (range.Tmax - range.Tmin);
        col = mixRgb(cols[id], th.dark ? [14, 18, 34] : [255, 255, 255], 0.5 - 0.28 * Math.min(1, Math.max(0, t)));
      } else {
        const t = Math.min(1, Math.max(0, (Tl[j * W + i] - range.Tmin) / (range.Tmax - range.Tmin)));
        const pc = colormap('parula', t);
        col = [pc[0] * 255, pc[1] * 255, pc[2] * 255];
      }
      let edge = false;
      if (i + 1 < W && lab[j * W + i + 1] >= 0 && lab[j * W + i + 1] !== id) edge = true;
      if (j + 1 < H && lab[(j + 1) * W + i] >= 0 && lab[(j + 1) * W + i] !== id) edge = true;
      if (edge) col = mixRgb(col, th.dark ? [255, 255, 255] : [0, 0, 0], 0.5);
      // 等温线
      if (o.isotherms) {
        const here = Math.floor(toC(Tl[j * W + i]) / o.isoStep);
        const r = i + 1 < W && lab[j * W + i + 1] >= 0 ? Math.floor(toC(Tl[j * W + i + 1]) / o.isoStep) : here;
        const b = j + 1 < H && lab[(j + 1) * W + i] >= 0 ? Math.floor(toC(Tl[(j + 1) * W + i]) / o.isoStep) : here;
        if (r !== here || b !== here) {
          col = mixRgb(col, [0, 0, 0], 0.28);
          const lv = Math.max(r, here, b, here) * o.isoStep;
          const arr = levels.get(lv) ?? [];
          arr.push([i, j]);
          levels.set(lv, arr);
        }
      }
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  projBase = { key, canvas: cv, levels };
  return projBase;
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.62);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.7, -size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export const KIND_COLOR: Record<ReactionType, string> = {
  eutectic: '#1d2229',
  transition: '#D95319',
  peritectic: '#C00000',
};

export function drawProjection(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  d: PhaseDiagram,
  th: Theme,
  o: ProjOpts,
  extra: { x0: Comp; spec: VerticalSpec | null; trace: Trace | null; idx: number; selectedCurve?: string | null; selectedInv?: string | null; noState?: boolean },
): TriLayout {
  const L = triLayout(W, H, o.pad);
  const base = projectionBase(d, W, H, th, o);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base.canvas, 0, 0, W, H);
  const f = o.fontPx;
  // 等温线标注
  if (o.isotherms) {
    ctx.font = `${f * 0.78}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    base.levels.forEach((arr, lv) => {
      if (arr.length < 40) return;
      const p = arr[Math.floor(arr.length / 2)];
      haloText(ctx, `${lv}`, p[0] / o.dpr, p[1] / o.dpr, th, '#1d2229');
    });
  }
  drawTriangleFrame(ctx, L, d, th, { grid: false, ticks: true, fontPx: f });
  // Alkemade（相容三角形）连线
  if (o.alkemade) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.3;
    const seen = new Set<string>();
    ctx.beginPath();
    for (const t of d.facets()) {
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[0], t[2]],
      ]) {
        const k = `${a}-${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const pa = L.px(d.solids[a].n);
        const pb = L.px(d.solids[b].n);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 界线
  if (o.boundaries) {
    for (const cv of d.topo.curves) {
      const sel = extra.selectedCurve === cv.id;
      for (const pc of cv.pieces) {
        const lo = Math.min(pc.i0, pc.i1);
        const hi = Math.max(pc.i0, pc.i1);
        ctx.strokeStyle = th.halo;
        ctx.lineWidth = (sel ? 6 : 4.4) * (f / 11);
        ctx.beginPath();
        for (let k = lo; k <= hi; k++) {
          const p = L.px(cv.pts[k]);
          if (k > lo) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
        ctx.strokeStyle = KIND_COLOR[pc.kind];
        ctx.lineWidth = (sel ? 3.4 : 2.2) * (f / 11);
        ctx.stroke();
        if (o.arrows) {
          const km = Math.round((pc.i0 + pc.i1) / 2);
          const dir = pc.i1 >= pc.i0 ? 1 : -1;
          const k0 = Math.max(0, Math.min(cv.pts.length - 2, dir === 1 ? km : km - 1));
          const p0 = L.px(cv.pts[k0]);
          const p1 = L.px(cv.pts[k0 + 1]);
          const ang = Math.atan2(dir * (p1[1] - p0[1]), dir * (p1[0] - p0[0]));
          const mid: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const sz = f * 0.75;
          arrowHead(ctx, mid[0], mid[1], ang, sz, KIND_COLOR[pc.kind]);
          if (pc.kind !== 'eutectic') arrowHead(ctx, mid[0] - Math.cos(ang) * sz * 1.25, mid[1] - Math.sin(ang) * sz * 1.25, ang, sz, KIND_COLOR[pc.kind]);
        }
      }
      for (const mi of cv.maxima) {
        const p = L.px(cv.pts[mi]);
        ctx.fillStyle = '#EDB120';
        ctx.strokeStyle = '#1d2229';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1] - f * 0.55);
        ctx.lineTo(p[0] + f * 0.5, p[1]);
        ctx.lineTo(p[0], p[1] + f * 0.55);
        ctx.lineTo(p[0] - f * 0.5, p[1]);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
  }
  drawSolidPoints(ctx, L, d, th, f);
  // 初晶区标签
  ctx.font = `600 ${f * 0.9}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const fl of d.topo.fields) {
    if (fl.area < 0.02) continue;
    const p = L.px(fl.centroid);
    haloText(ctx, `${d.solids[fl.si].label} 初晶区`, p[0], p[1], th, '#1d2229');
  }
  // 不变点
  if (o.invariants) {
    for (const iv of d.topo.invariants) {
      const p = L.px(iv.x);
      const col = iv.reaction.type === 'eutectic' ? '#0072BD' : iv.reaction.type === 'transition' ? '#D95319' : '#A2142F';
      ctx.fillStyle = col;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p[0], p[1], f * (iv.rank === 'ternary' ? 0.52 : 0.36), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      ctx.font = `700 ${f * (iv.rank === 'ternary' ? 1.05 : 0.9)}px system-ui, sans-serif`;
      const nx = iv.x[2] > 0.001 && iv.x[0] > 0.001 && iv.x[1] > 0.001 ? 1 : 0;
      void nx;
      haloText(ctx, iv.label, p[0] + f * 0.95, p[1] - f * 0.8, th, col);
    }
  }
  // 冷却结晶路径
  if (extra.trace && extra.trace.liquidPath.length > 1) {
    const path = extra.trace.liquidPath;
    const cur = extra.trace.samples[Math.min(extra.trace.samples.length - 1, Math.round(extra.idx))];
    ctx.strokeStyle = '#7E2F8E';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    let last: [number, number] | null = null;
    for (const q of path) {
      if (q.t > cur.t + 1e-9) break;
      const p = L.px(q.x);
      if (!started) {
        ctx.moveTo(p[0], p[1]);
        started = true;
      } else ctx.lineTo(p[0], p[1]);
      last = p;
    }
    ctx.stroke();
    // 未走部分（淡）
    ctx.strokeStyle = 'rgba(126,47,142,0.4)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    path.forEach((q, i) => {
      const p = L.px(q.x);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (last) {
      ctx.fillStyle = '#7E2F8E';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(last[0], last[1], f * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
  }
  // 截面线
  if (extra.spec) {
    const a = L.px(extra.spec.p1);
    const b = L.px(extra.spec.p2);
    ctx.strokeStyle = '#1f4e79';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (!extra.noState) drawStatePoint(ctx, L.px(extra.x0), f, th);
  return L;
}

export function drawStatePoint(ctx: CanvasRenderingContext2D, p: [number, number], f: number, th: Theme) {
  ctx.strokeStyle = th.halo;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p[0], p[1], f * 0.62, 0, Math.PI * 2);
  ctx.moveTo(p[0] - f * 1.1, p[1]);
  ctx.lineTo(p[0] + f * 1.1, p[1]);
  ctx.moveTo(p[0], p[1] - f * 1.1);
  ctx.lineTo(p[0], p[1] + f * 1.1);
  ctx.stroke();
  ctx.strokeStyle = '#1d2229';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#c00000';
  ctx.beginPath();
  ctx.arc(p[0], p[1], f * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

export { LIQUID_COLOR, phaseColor };
