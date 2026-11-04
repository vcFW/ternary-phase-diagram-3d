import { solidColor } from './colors';
import { fillIso, haloText, polyPath, triLayout, type Theme, type TriLayout } from './canvasDraw';
import type { PhaseDiagram } from './diagram';
import type { IsoSection } from './isothermal';
import type { Comp } from './types';
import { COLOR } from '../ui/tokens';

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

/** 等温截面的完整画布绘制（填充 + 坐标框 + 饱和弧 + 连结线 + 标签）：仅用于三维场景的等温面纹理；二维图窗改用 canvas 填充 + SVG（TernaryPlot）。 */
export function drawIsoTexture(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sec: IsoSection,
  d: PhaseDiagram,
  th: Theme,
  opts: { pad: number; grid: boolean; ticks: boolean; labels: boolean; ties: boolean; fontPx: number; highlight?: string | null; background?: boolean },
): TriLayout {
  const L = opts.background === false ? triLayout(W, H, opts.pad) : fillIso(ctx, W, H, sec, d, th, opts.pad);
  ctx.save();
  polyPath(ctx, [L.px([1, 0, 0]), L.px([0, 1, 0]), L.px([0, 0, 1])]);
  ctx.clip();
  for (const r of sec.regions) {
    if (r.fine) continue;
    polyPath(ctx, r.poly.map((x) => L.px(x)));
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
  ctx.strokeStyle = COLOR.black;
  ctx.lineWidth = Math.max(1.4, opts.fontPx / 7);
  for (const a of sec.arcs) {
    ctx.setLineDash(a.approx ? [4, 3] : []);
    ctx.beginPath();
    a.pts.forEach((x, i) => {
      const p = L.px(x);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
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

export function centroid(pts: [number, number][]) {
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

export function liquidLabelPos(d: PhaseDiagram, T: number): Comp | null {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  const N = 36;
  for (let i = 1; i < N; i++)
    for (let j = 1; j < N - i; j++) {
      const x: Comp = [i / N, j / N, (N - i - j) / N];
      if (d.liquidusFast(x).T < T) {
        sx += x[0];
        sy += x[1];
        sz += x[2];
        n++;
      }
    }
  if (n < 6) return null;
  return [sx / n, sy / n, sz / n];
}
