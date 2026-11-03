import { useMemo, useRef, useState, type ReactNode } from 'react';
import { SQRT3_2, toXY } from '../core/barycentric';
import type { Comp } from '../core/types';
import { useSize } from '../ui/useSize';

/**
 * 轴测（正交）三维视图（SVG）。观察本身就是一个线性投影：
 *   屏幕坐标 s = V·w，V 为 2×3 矩阵（相机基的前两行），rank V = 2，零空间 = 视线方向。
 * 因此"看三维图"与"把液相面投影到底面"在数学上是同一类操作，只是零空间方向不同。
 *
 * 世界坐标 w = (u − ½, (v − √3/6), z)，(u, v) 为三角形笛卡尔坐标，z ∈ [0, h] 由数值范围线性映射。
 */
export interface AxoMap {
  /** 成分 + 纵坐标值 → 屏幕 */
  p: (x: Comp, val: number) => [number, number];
  /** 深度（越大越靠近观察者） */
  depth: (x: Comp, val: number) => number;
  V: number[][];
  view: { az: number; el: number };
}

export interface Surface {
  N: number;
  f: (x: Comp) => number;
  color: (x: Comp, val: number) => string;
  opacity?: number;
  stroke?: boolean;
}

export function Axo3D({
  zlim,
  zlabel,
  zfmt,
  surfaces,
  children,
  height = 340,
  labels = ['A', 'B', 'C'],
  initial,
  onView,
}: {
  zlim: [number, number];
  zlabel?: string;
  zfmt?: (v: number) => string;
  surfaces?: Surface[];
  children?: (m: AxoMap) => ReactNode;
  height?: number;
  labels?: string[];
  initial?: { az: number; el: number };
  onView?: (v: { az: number; el: number }) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { w } = useSize(wrap);
  const [view, setView] = useState(initial ?? { az: -0.62, el: 0.42 });
  const Hz = 0.85;
  const V = useMemo(() => {
    const { az, el } = view;
    // 相机右向量 r 与上向量 u（世界 z 轴向上）
    const r = [Math.cos(az), Math.sin(az), 0];
    const u = [-Math.sin(el) * Math.sin(az), Math.sin(el) * Math.cos(az), Math.cos(el)];
    const fwd = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
    return [r, u, fwd];
  }, [view]);
  const world = (x: Comp, val: number): number[] => {
    const [u, v] = toXY(x);
    const z = ((val - zlim[0]) / (zlim[1] - zlim[0] || 1)) * Hz - Hz * 0.45;
    return [u - 0.5, v - SQRT3_2 / 3, z];
  };
  // 自动取景：使三棱柱 6 个角点的投影恰好放入视口
  const corners: number[][] = [];
  for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Comp[]) for (const z of zlim) corners.push(world(c, z));
  const sx = corners.map((wv) => V[0][0] * wv[0] + V[0][1] * wv[1] + V[0][2] * wv[2]);
  const sy = corners.map((wv) => V[1][0] * wv[0] + V[1][1] * wv[1] + V[1][2] * wv[2]);
  const bw = Math.max(...sx) - Math.min(...sx) || 1;
  const bh = Math.max(...sy) - Math.min(...sy) || 1;
  const scale = Math.min((w - 70) / bw, (height - 44) / bh);
  const cx = w / 2 + 14 - (scale * (Math.max(...sx) + Math.min(...sx))) / 2;
  const cy = height / 2 - 4 + (scale * (Math.max(...sy) + Math.min(...sy))) / 2;
  const m: AxoMap = {
    p: (x, val) => {
      const wv = world(x, val);
      return [cx + scale * (V[0][0] * wv[0] + V[0][1] * wv[1] + V[0][2] * wv[2]), cy - scale * (V[1][0] * wv[0] + V[1][1] * wv[1] + V[1][2] * wv[2])];
    },
    depth: (x, val) => {
      const wv = world(x, val);
      return V[2][0] * wv[0] + V[2][1] * wv[1] + V[2][2] * wv[2];
    },
    V: [V[0], V[1]],
    view,
  };
  const tris = useMemo(() => {
    const out: { pts: Comp[]; vals: number[]; c: string; op: number; stroke: boolean }[] = [];
    for (const s of surfaces ?? []) {
      const N = s.N;
      const at = (i: number, j: number): Comp => [Math.max(1e-6, i / N), Math.max(1e-6, j / N), Math.max(1e-6, (N - i - j) / N)];
      const vals = new Map<string, number>();
      const val = (i: number, j: number) => {
        const k = `${i},${j}`;
        let v = vals.get(k);
        if (v === undefined) vals.set(k, (v = s.f(at(i, j))));
        return v;
      };
      const push = (a: [number, number], b: [number, number], c: [number, number]) => {
        const xs = [at(...a), at(...b), at(...c)];
        const vs = [val(...a), val(...b), val(...c)];
        if (vs.some((v) => !Number.isFinite(v))) return;
        const xc: Comp = [(xs[0][0] + xs[1][0] + xs[2][0]) / 3, (xs[0][1] + xs[1][1] + xs[2][1]) / 3, (xs[0][2] + xs[1][2] + xs[2][2]) / 3];
        out.push({ pts: xs, vals: vs, c: s.color(xc, (vs[0] + vs[1] + vs[2]) / 3), op: s.opacity ?? 0.92, stroke: s.stroke ?? true });
      };
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N - i; j++) {
          push([i, j], [i + 1, j], [i, j + 1]);
          if (i + j <= N - 2) push([i + 1, j], [i + 1, j + 1], [i, j + 1]);
        }
    }
    return out;
  }, [surfaces]);
  const sorted = useMemo(
    () =>
      tris
        .map((t) => ({ t, d: (m.depth(t.pts[0], t.vals[0]) + m.depth(t.pts[1], t.vals[1]) + m.depth(t.pts[2], t.vals[2])) / 3 }))
        .sort((a, b) => a.d - b.d),
    [tris, view, w, height],
  );
  const drag = useRef<{ x: number; y: number; v: typeof view } | null>(null);
  const V3: Comp[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => zlim[0] + t * (zlim[1] - zlim[0]));
  const fz = zfmt ?? ((v: number) => v.toFixed(0));
  return (
    <div className="axo" ref={wrap}>
      <svg
        width={w}
        height={height}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-handle]')) return;
          drag.current = { x: e.clientX, y: e.clientY, v: view };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const nv = { az: drag.current.v.az - (e.clientX - drag.current.x) * 0.008, el: Math.max(-0.1, Math.min(Math.PI / 2, drag.current.v.el + (e.clientY - drag.current.y) * 0.006)) };
          setView(nv);
          onView?.(nv);
        }}
        onPointerUp={() => (drag.current = null)}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        {/* 底面三角形与竖棱 */}
        <polygon points={V3.map((x) => m.p(x, zlim[0]).join(',')).join(' ')} className="axo-base" />
        {V3.map((x, i) => {
          const a = m.p(x, zlim[0]);
          const b = m.p(x, zlim[1]);
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="axo-edge" />;
        })}
        {ticks.map((t, k) => {
          const a = m.p(V3[0], t);
          return (
            <g key={k}>
              <line x1={a[0] - 4} y1={a[1]} x2={a[0]} y2={a[1]} className="axo-edge" />
              <text x={a[0] - 6} y={a[1] + 3} className="axo-tick" textAnchor="end">{fz(t)}</text>
            </g>
          );
        })}
        {zlabel && (() => {
          const a = m.p(V3[0], zlim[1]);
          return <text x={a[0] - 6} y={a[1] - 10} className="axo-tick" textAnchor="end">{zlabel}</text>;
        })()}
        {sorted.map(({ t }, k) => (
          <polygon key={k} points={t.pts.map((x, i) => m.p(x, t.vals[i]).join(',')).join(' ')} fill={t.c} fillOpacity={t.op} stroke={t.stroke ? 'rgba(0,0,0,0.12)' : t.c} strokeWidth={t.stroke ? 0.4 : 0.6} />
        ))}
        <polygon points={V3.map((x) => m.p(x, zlim[1]).join(',')).join(' ')} className="axo-top" />
        {V3.map((x, i) => {
          const a = m.p(x, zlim[0]);
          return (
            <text key={i} x={a[0]} y={a[1] + 14} className="axo-vlab" textAnchor="middle">
              {labels[i]}
            </text>
          );
        })}
        {children?.(m)}
      </svg>
      <div className="axo-hint">拖动旋转 · 方位 {((view.az * 180) / Math.PI).toFixed(0)}° · 仰角 {((view.el * 180) / Math.PI).toFixed(0)}°</div>
    </div>
  );
}
