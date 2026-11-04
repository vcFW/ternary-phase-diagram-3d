import { SQRT3_2, toXY } from './barycentric';
import { colormap } from './colormap';
import { hexToRgb, mixRgb, regionCss, solidColor, type RGB } from './colors';
import type { PhaseDiagram } from './diagram';
import type { IsoSection } from './isothermal';
import type { Comp } from './types';
import { COLOR } from '../ui/tokens';

/**
 * 画布底图：只负责区域填充与液相面着色（栅格，性能）。
 * 坐标轴 / 刻度 / 相界 / 标注 / 叠加层 / 交互一律由 viz/TernaryPlot（SVG）绘制，保证全站三元图一致。
 * 三维场景的纹理见 core/isoTexture.ts；垂直截面见 core/verticalDraw.ts。
 */
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
  text: COLOR.ink,
  textDim: COLOR.dim,
  grid: 'rgba(0,0,0,0.13)',
  line: COLOR.ink,
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

export function polyPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

/**
 * 等温截面底图：以液相色铺满三角形，再依次填充固相小块、两相区、三相区的多边形。
 * 精确追踪的两相区（非 fine）压在凸包小块之上；沿精确相界的衬底描边补上凸包小块与真实相界之间的缝隙。
 */
export function fillIso(ctx: CanvasRenderingContext2D, W: number, H: number, sec: IsoSection, d: PhaseDiagram, th: Theme, pad: number): TriLayout {
  const L = triLayout(W, H, pad);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  polyPath(ctx, [L.px([1, 0, 0]), L.px([0, 1, 0]), L.px([0, 0, 1])]);
  ctx.clip();
  ctx.fillStyle = regionCss(d, 'L', 1, th.dark);
  ctx.fillRect(0, 0, W, H);
  const order = { solid: 0, two: 1, three: 2 } as const;
  const regs = [...sec.regions].sort((a, b) => order[a.kind] + (a.fine ? 0 : 0.5) - (order[b.kind] + (b.fine ? 0 : 0.5)));
  if (sec.stripW) {
    const pa = L.px([1, 0, 0]);
    const pb = L.px([0, 1, 0]);
    ctx.lineWidth = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * sec.stripW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const a of sec.arcs) {
      if (a.approx) continue;
      ctx.strokeStyle = regionCss(d, a.si < 0 ? 'L' : d.solids[a.si].id, 1, th.dark);
      ctx.beginPath();
      a.pts.forEach((x, i) => {
        const p = L.px(x);
        if (i) ctx.lineTo(p[0], p[1]);
        else ctx.moveTo(p[0], p[1]);
      });
      ctx.stroke();
    }
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
  }
  for (const r of regs) {
    polyPath(ctx, r.poly.map((x) => L.px(x)));
    ctx.fillStyle = regionCss(d, r.key, 1, th.dark);
    ctx.fill();
    if (r.fine) {
      // 凸包小块：描同色细边以消除相邻小三角形之间的缝隙
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  ctx.restore();
  return L;
}

// ---------------------------------------------------------------- 液相面投影底图
export interface ProjOpts {
  pad: number;
  fillMode: 'field' | 'temperature';
  dpr: number;
}

interface ProjBase {
  key: string;
  canvas: HTMLCanvasElement;
}
let projBase: ProjBase | null = null;

/** 液相面底图：逐像素取初晶相与液相线温度（网格插值），按初晶相（浅色，随温度加深）或温度（parula）着色，相区交界处略加深。 */
function projectionBase(d: PhaseDiagram, W: number, H: number, th: Theme, o: ProjOpts): ProjBase {
  const k = o.dpr;
  const key = `${d.uid}|${W}|${H}|${k}|${o.pad}|${o.fillMode}`;
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
      const q = d.liquidusFast(x);
      Tl[j * W + i] = q.T;
      lab[j * W + i] = q.si;
    }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = lab[j * W + i];
      if (id < 0) continue;
      const p = (j * W + i) * 4;
      const t = Math.min(1, Math.max(0, (Tl[j * W + i] - range.Tmin) / (range.Tmax - range.Tmin)));
      let col: RGB;
      if (o.fillMode === 'field') col = mixRgb(cols[id], th.dark ? [14, 18, 34] : [255, 255, 255], 0.5 - 0.28 * t);
      else {
        const pc = colormap('parula', t);
        col = [pc[0] * 255, pc[1] * 255, pc[2] * 255];
      }
      const edge = (i + 1 < W && lab[j * W + i + 1] >= 0 && lab[j * W + i + 1] !== id) || (j + 1 < H && lab[(j + 1) * W + i] >= 0 && lab[(j + 1) * W + i] !== id);
      if (edge) col = mixRgb(col, th.dark ? [255, 255, 255] : [0, 0, 0], 0.5);
      img.data[p] = col[0];
      img.data[p + 1] = col[1];
      img.data[p + 2] = col[2];
      img.data[p + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  projBase = { key, canvas: cv };
  return projBase;
}

export function fillProjection(ctx: CanvasRenderingContext2D, W: number, H: number, d: PhaseDiagram, th: Theme, o: ProjOpts): TriLayout {
  const L = triLayout(W, H, o.pad);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(projectionBase(d, W, H, th, o).canvas, 0, 0, W, H);
  return L;
}
