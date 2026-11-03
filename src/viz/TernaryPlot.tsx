import { useMemo, useRef, type ReactNode } from 'react';
import { SQRT3_2, toXY } from '../core/barycentric';
import { colormap } from '../core/colormap';
import { hexToRgb, mixRgb, solidColor } from '../core/colors';
import type { PhaseDiagram } from '../core/diagram';
import type { Comp } from '../core/types';
import { useSize } from '../ui/useSize';

/**
 * 可复用的三元成分三角形（SVG）。底图（初晶区 / 液相面温度）以栅格图像嵌入，
 * 其余对象（向量、连线、三角形、拖动手柄）由调用者以子元素绘制，坐标映射通过 render-prop 提供。
 */
export interface TriMap {
  px: (x: Comp) => [number, number];
  inv: (X: number, Y: number) => Comp;
  S: number;
  W: number;
  H: number;
}

export type Background = 'none' | 'fields' | 'temperature';

/** parula 色标，0–255 */
export function cm255(t: number): [number, number, number] {
  const c = colormap('parula', t);
  return [c[0] * 255, c[1] * 255, c[2] * 255];
}

const rasterCache = new Map<string, string>();

function raster(d: PhaseDiagram, mode: Background, n: number): string {
  const key = `${d.uid}|${mode}|${n}`;
  const hit = rasterCache.get(key);
  if (hit) return hit;
  const H = Math.round(n * SQRT3_2);
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(n, H);
  const { Tmin, Tmax } = d.tRange();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const v = (H - j - 0.5) / n;
      const c = v / SQRT3_2;
      const b = u - 0.5 * c;
      const a = 1 - b - c;
      const k = (j * n + i) * 4;
      if (a < -1e-9 || b < -1e-9 || c < -1e-9) {
        img.data[k + 3] = 0;
        continue;
      }
      const L = d.liquidus([Math.max(a, 1e-9), Math.max(b, 1e-9), Math.max(c, 1e-9)]);
      let rgb: [number, number, number];
      if (mode === 'temperature') rgb = cm255((L.T - Tmin) / (Tmax - Tmin));
      else rgb = mixRgb(hexToRgb(solidColor(L.si)), [255, 255, 255], 0.78);
      img.data[k] = rgb[0];
      img.data[k + 1] = rgb[1];
      img.data[k + 2] = rgb[2];
      img.data[k + 3] = mode === 'temperature' ? 150 : 255;
    }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  rasterCache.set(key, url);
  return url;
}

export interface TernaryPlotProps {
  d: PhaseDiagram;
  background?: Background;
  boundaries?: boolean;
  invariants?: boolean;
  solids?: boolean;
  grid?: boolean;
  /** 等温线间隔 / K（0 为不画） */
  isoStep?: number;
  pad?: number;
  /** 点击 / 拖动设定成分 */
  onPick?: (x: Comp, phase: 'down' | 'move' | 'up') => void;
  onHover?: (x: Comp | null) => void;
  children?: (m: TriMap) => ReactNode;
  minHeight?: number;
  className?: string;
  /** 自定义底图（fieldImage 生成），优先于 background */
  image?: string;
}

export function TernaryPlot({ d, background = 'fields', boundaries = true, invariants = true, solids = true, grid = true, isoStep = 0, pad = 30, onPick, onHover, children, minHeight = 260, className, image }: TernaryPlotProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(wrap);
  const S = Math.max(40, Math.min(w - 2 * pad, (h - 2 * pad) / SQRT3_2));
  const ox = (w - S) / 2;
  const oy = (h + S * SQRT3_2) / 2;
  const m: TriMap = useMemo(
    () => ({
      px: (x: Comp) => {
        const [u, v] = toXY(x);
        return [ox + u * S, oy - v * S];
      },
      inv: (X: number, Y: number) => {
        const u = (X - ox) / S;
        const v = (oy - Y) / S;
        const c = v / SQRT3_2;
        const b = u - 0.5 * c;
        return [1 - b - c, b, c];
      },
      S,
      W: w,
      H: h,
    }),
    [ox, oy, S, w, h],
  );
  const img = useMemo(() => image ?? (background !== 'none' ? raster(d, background, 220) : ''), [d, background, image]);
  const iso = useMemo(() => (isoStep > 0 ? isotherms(d, isoStep) : []), [d, isoStep]);
  const sym = d.params.components.map((c) => c.symbol);
  const drag = useRef(false);
  const ev = (e: React.PointerEvent, phase: 'down' | 'move' | 'up') => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = m.inv(e.clientX - r.left, e.clientY - r.top);
    const inside = x.every((v) => v > -0.002);
    if (onHover) onHover(inside ? clampC(x) : null);
    if (!onPick) return;
    if (phase === 'down' && inside && !(e.target as Element).closest('[data-handle]')) {
      drag.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      onPick(clampC(x), 'down');
    } else if (phase === 'move' && drag.current) onPick(clampC(x), 'move');
    else if (phase === 'up' && drag.current) {
      drag.current = false;
      onPick(clampC(x), 'up');
    }
  };
  const A = m.px([1, 0, 0]);
  const B = m.px([0, 1, 0]);
  const C = m.px([0, 0, 1]);
  const gridLines: ReactNode[] = [];
  if (grid)
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      for (let i = 0; i < 3; i++) {
        const p: Comp = [0, 0, 0];
        const q: Comp = [0, 0, 0];
        p[i] = t;
        q[i] = t;
        p[(i + 1) % 3] = 1 - t;
        q[(i + 2) % 3] = 1 - t;
        const P = m.px(p);
        const Q = m.px(q);
        gridLines.push(<line key={`${i}-${k}`} x1={P[0]} y1={P[1]} x2={Q[0]} y2={Q[1]} className="tp-grid" />);
      }
    }
  return (
    <div className={`tp ${className ?? ''}`} ref={wrap} style={{ minHeight }}>
      <svg width={w} height={h} onPointerDown={(e) => ev(e, 'down')} onPointerMove={(e) => ev(e, 'move')} onPointerUp={(e) => ev(e, 'up')} onPointerLeave={() => onHover?.(null)} style={{ cursor: onPick ? 'crosshair' : 'default' }}>
        {img && <image href={img} x={ox} y={oy - S * SQRT3_2} width={S} height={S * SQRT3_2} preserveAspectRatio="none" />}
        {gridLines}
        {iso.map((seg, k) => (
          <polyline key={`iso${k}`} points={seg.pts.map((x) => m.px(x).join(',')).join(' ')} className="tp-iso" />
        ))}
        {boundaries &&
          d.topo.curves.map((cv) =>
            cv.pieces.map((pc, k) => {
              const lo = Math.min(pc.i0, pc.i1);
              const hi = Math.max(pc.i0, pc.i1);
              return <polyline key={`${cv.id}-${k}`} points={cv.pts.slice(lo, hi + 1).map((x) => m.px(x).join(',')).join(' ')} className={`tp-bd ${pc.kind === 'peritectic' ? 'per' : ''}`} />;
            }),
          )}
        <polygon points={[A, B, C].map((p) => p.join(',')).join(' ')} className="tp-frame" />
        <text x={A[0] - 6} y={A[1] + 14} className="tp-vlab" textAnchor="end">{sym[0]}</text>
        <text x={B[0] + 6} y={B[1] + 14} className="tp-vlab">{sym[1]}</text>
        <text x={C[0]} y={C[1] - 7} className="tp-vlab" textAnchor="middle">{sym[2]}</text>
        {invariants &&
          d.topo.invariants.map((iv) => {
            const p = m.px(iv.x);
            return (
              <g key={iv.id}>
                <circle cx={p[0]} cy={p[1]} r={iv.rank === 'ternary' ? 3.4 : 2.6} className={`tp-inv ${iv.reaction.type}`} />
                <text x={p[0] + 5} y={p[1] - 5} className="tp-ilab">{iv.label}</text>
              </g>
            );
          })}
        {solids &&
          d.solids
            .filter((s) => s.kind === 'binary' || s.kind === 'ternary')
            .map((s) => {
              const p = m.px(s.n);
              return (
                <g key={s.id}>
                  <rect x={p[0] - 3.5} y={p[1] - 3.5} width={7} height={7} fill={solidColor(s.index)} stroke="#1d2229" strokeWidth={0.8} />
                  <text x={p[0] + 6} y={p[1] + 12} className="tp-ilab">{s.label}</text>
                </g>
              );
            })}
        {children?.(m)}
      </svg>
    </div>
  );
}

/** 任意标量场的三角形栅格图（返回 dataURL） */
export function fieldImage(f: (x: Comp) => [number, number, number] | null, n = 180): string {
  const H = Math.round(n * SQRT3_2);
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(n, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const v = (H - j - 0.5) / n;
      const c = v / SQRT3_2;
      const b = u - 0.5 * c;
      const a = 1 - b - c;
      const k = (j * n + i) * 4;
      if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue;
      const rgb = f([Math.max(a, 1e-7), Math.max(b, 1e-7), Math.max(c, 1e-7)]);
      if (!rgb) continue;
      img.data[k] = rgb[0];
      img.data[k + 1] = rgb[1];
      img.data[k + 2] = rgb[2];
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

function clampC(x: Comp): Comp {
  const a = Math.max(0, x[0]);
  const b = Math.max(0, x[1]);
  const c = Math.max(0, x[2]);
  const s = a + b + c || 1;
  return [a / s, b / s, c / s];
}

/** 液相面等温线（三角网格上的线性插值等值线，按温度分组的线段） */
const isoCache = new Map<string, { T: number; pts: Comp[] }[]>();
export function isotherms(d: PhaseDiagram, step: number, N = 90): { T: number; pts: Comp[] }[] {
  const key = `${d.uid}|${step}|${N}`;
  const hit = isoCache.get(key);
  if (hit) return hit;
  const idx = (i: number, j: number) => (i * (2 * N + 3 - i)) / 2 + j;
  const X: Comp[] = [];
  const T: number[] = [];
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N - i; j++) {
      const x: Comp = [Math.max(1e-6, i / N), Math.max(1e-6, j / N), Math.max(1e-6, (N - i - j) / N)];
      X.push(x);
      T.push(d.liquidus(x).T);
    }
  const { Tmin, Tmax } = d.tRange();
  const out: { T: number; pts: Comp[] }[] = [];
  for (let L = Math.ceil(Tmin / step) * step; L < Tmax; L += step) {
    const tri = (a: number, b: number, c: number) => {
      const v = [a, b, c];
      const pts: Comp[] = [];
      for (let k = 0; k < 3; k++) {
        const p = v[k];
        const q = v[(k + 1) % 3];
        if ((T[p] - L) * (T[q] - L) < 0) {
          const f = (L - T[p]) / (T[q] - T[p]);
          pts.push([X[p][0] + f * (X[q][0] - X[p][0]), X[p][1] + f * (X[q][1] - X[p][1]), X[p][2] + f * (X[q][2] - X[p][2])]);
        }
      }
      if (pts.length === 2) out.push({ T: L, pts });
    };
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N - i; j++) {
        tri(idx(i, j), idx(i + 1, j), idx(i, j + 1));
        if (i + j <= N - 2) tri(idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
      }
  }
  isoCache.set(key, out);
  return out;
}

/** 箭头（SVG）：从 p 到 q */
export function Arrow({ p, q, cls, head = 7 }: { p: [number, number]; q: [number, number]; cls?: string; head?: number }) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const h1 = [q[0] - head * ux + head * 0.45 * uy, q[1] - head * uy - head * 0.45 * ux];
  const h2 = [q[0] - head * ux - head * 0.45 * uy, q[1] - head * uy + head * 0.45 * ux];
  return (
    <g className={`arrow ${cls ?? ''}`}>
      <line x1={p[0]} y1={p[1]} x2={q[0] - ux * head * 0.6} y2={q[1] - uy * head * 0.6} />
      <polygon points={`${q[0]},${q[1]} ${h1[0]},${h1[1]} ${h2[0]},${h2[1]}`} />
    </g>
  );
}

/** 可拖动手柄 */
export function Handle({ m, x, onDrag, color = '#c00000', r = 6, label }: { m: TriMap; x: Comp; onDrag: (x: Comp) => void; color?: string; r?: number; label?: string }) {
  const p = m.px(x);
  const down = useRef(false);
  return (
    <g
      data-handle
      style={{ cursor: 'grab' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        down.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!down.current) return;
        const svg = (e.currentTarget as SVGGElement).ownerSVGElement!.getBoundingClientRect();
        onDrag(clampC(m.inv(e.clientX - svg.left, e.clientY - svg.top)));
      }}
      onPointerUp={() => (down.current = false)}
    >
      <circle cx={p[0]} cy={p[1]} r={r + 5} fill="transparent" />
      <circle cx={p[0]} cy={p[1]} r={r} fill="#fff" stroke={color} strokeWidth={2} />
      <circle cx={p[0]} cy={p[1]} r={2} fill={color} />
      {label && (
        <text x={p[0] + r + 3} y={p[1] - r} className="tp-hlab" fill={color}>
          {label}
        </text>
      )}
    </g>
  );
}
