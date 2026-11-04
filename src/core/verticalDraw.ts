import { toC, regionRgb, type RGB } from './colors';
import type { PhaseDiagram } from './diagram';
import { uOfPoint, type VerticalRaster, type VerticalSpec } from './vertical';
import { COLOR } from '../ui/tokens';
import { haloText, type Theme } from './canvasDraw';
import { solidColor } from './colors';

/** 垂直截面（T–成分）的画布绘制：二维视图与三维平面纹理共用。 */
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
    const liqA = opts.liquidAlpha ?? 255;
    for (let j = 0; j < ras.H; j++) {
      for (let i = 0; i < ras.W; i++) {
        const id = ras.labels[j * ras.W + i];
        const k = (j * ras.W + i) * 4;
        const c = cols[id];
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = id === 0 ? liqA : 255;
      }
    }
    c2.putImageData(img, 0, 0);
    rasterCache.set(ras, cv);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv, lay.x, lay.y, lay.w, lay.h);
  const f = opts.fontPx;
  // 相界：由逐行交点按连续性连成的折线（光滑，不呈栅格台阶）
  ctx.save();
  ctx.beginPath();
  ctx.rect(lay.x, lay.y, lay.w, lay.h);
  ctx.clip();
  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,20,20,0.7)';
  ctx.lineWidth = Math.max(1, f / 9);
  ctx.lineJoin = 'round';
  for (const b of ras.boundaries) {
    ctx.beginPath();
    b.pts.forEach(([u, Tk], i) => {
      const X = lay.uToX(u);
      const Y = lay.TToY(Tk);
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    });
    ctx.stroke();
  }
  ctx.restore();
  // 液相线（沿截面）
  ctx.strokeStyle = COLOR.black;
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
