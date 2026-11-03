import { useEffect, useMemo, useRef, useState } from 'react';
import { inTriangle, VERTICES } from '../core/barycentric';
import { colormap } from '../core/colormap';
import { regionKey1 } from '../core/diagram';
import { formatC, regionTint, REGION_COLORS } from '../core/phases';
import type { Comp, CompIndex } from '../core/types';
import { verticalLine } from '../core/verticalSection';
import { isothermLevels } from '../scene/geometry';
import { currentState, useStore } from '../state/store';
import { useSize } from '../ui/useSize';
import { makeTriMap, pathOf, TernaryAxes, type TriMap } from './TernaryAxes';

/**
 * 液相面投影图（常规二维三元相图）：初晶区、液相等温线、单变线（箭头指向降温方向）、
 * 二元/三元共晶点、结晶路径。与三维视图联动选中/高亮。
 */
export function ProjectionView({ fill }: { fill: 'field' | 'temperature' }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const x = useStore((s) => s.comp);
  const sim = useStore((s) => s.sim);
  const vert = useStore((s) => s.vert);
  const showVert = useStore((s) => s.layers.vertSlice.visible);
  const cmap = useStore((s) => s.cmap);
  const selection = useStore((s) => s.selection);
  const linked = useStore((s) => s.hover?.id ?? null);
  const select = useStore((s) => s.select);
  const setComp = useStore((s) => s.setComp);
  const setLinkedHover = useStore((s) => s.setLinkedHover);
  const sym = d.params.components.map((c) => c.symbol);
  const [hover, setHover] = useState<{ sx: number; sy: number; x: Comp; id: string } | null>(null);

  const m = useMemo(() => makeTriMap(size.w, size.h), [size.w, size.h]);

  const contours = useMemo(() => {
    const lv = isothermLevels(d, 50);
    const out: { T: number; major: boolean; pts: Comp[] }[] = [];
    for (const L of lv) {
      for (const i of [0, 1, 2] as CompIndex[]) {
        const c = d.isotherm(i, L, 48);
        if (c) out.push({ T: L, major: Math.round(L - 273.15) % 100 === 0, pts: c.points });
      }
    }
    return out;
  }, [d]);
  const fields = useMemo(() => ([0, 1, 2] as CompIndex[]).map((i) => d.primaryFieldPolygon(i)), [d]);
  const curT = useMemo(() => d.isothermalSection(T).isotherms, [d, T]);

  // 温度色图填充（逐像素精确计算液相面温度）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || fill !== 'temperature') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.floor(size.w * dpr);
    cv.height = Math.floor(size.h * dpr);
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cv.width, cv.height);
    const [t0, t1] = d.tRange;
    for (let py = 0; py < cv.height; py++) {
      for (let px = 0; px < cv.width; px++) {
        const c = m.inv(px / dpr, py / dpr);
        if (!inTriangle(c, 0)) continue;
        const col = colormap(cmap, (d.liquidus(c).T - t0) / (t1 - t0));
        const o = (py * cv.width + px) * 4;
        img.data[o] = col[0] * 255;
        img.data[o + 1] = col[1] * 255;
        img.data[o + 2] = col[2] * 255;
        img.data[o + 3] = 200;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [d, m, fill, cmap, size.w, size.h]);

  if (!size.w) return <div ref={ref} className="chart-fill" />;

  const active = (id: string) => id === selection || id === linked || id === hover?.id;
  const line = verticalLine(vert);

  const pickAt = (px: number, py: number): string | null => {
    for (const p of d.specialPoints) {
      const [a, b] = m.px(p.comp);
      if (Math.hypot(a - px, b - py) < 8) return p.id;
    }
    for (const mono of Object.values(d.mono)) {
      for (let n = 1; n < mono.samples.length; n += 2) {
        if (distSeg(m, px, py, mono.samples[n - 1].y, mono.samples[n].y) < 5) return `mono:${mono.id}`;
      }
    }
    const c = m.inv(px, py);
    if (!inTriangle(c, 1e-9)) return null;
    return `field:${d.liquidus(c).primary}`;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const id = pickAt(px, py);
    const c = m.inv(px, py);
    if (!id) {
      setHover(null);
      setLinkedHover(null);
      return;
    }
    setHover({ sx: px, sy: py, x: c, id });
    setLinkedHover(id);
  };
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!hover) return;
    if (e.shiftKey) setComp(hover.x);
    else select(hover.id);
  };

  const [sx, sy] = m.px(x);
  const st = currentState(d, x, T, sim);
  const path = sim.result.path;
  const doneIdx = path.findIndex((q) => q.T < T);
  const done = doneIdx < 0 ? path : path.slice(0, Math.max(1, doneIdx));
  const hoverInfo = hover ? describeHover(hover, d, sym) : null;

  return (
    <div ref={ref} className="chart-fill">
      {fill === 'temperature' && <canvas ref={canvasRef} className="chart-canvas" style={{ width: size.w, height: size.h }} />}
      <svg
        width={size.w}
        height={size.h}
        className="chart-svg"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          setLinkedHover(null);
        }}
        onClick={onClick}
        onDoubleClick={() => hover && setComp(hover.x)}
      >
        {fill === 'field' &&
          fields.map((poly, i) => (
            <path
              key={i}
              d={pathOf(m, poly, true)}
              fill={regionTint(regionKey1(i as CompIndex), active(`field:${i}`) ? 0.5 : 0.22)}
              stroke={active(`field:${i}`) ? REGION_COLORS[regionKey1(i as CompIndex)] : 'none'}
              strokeWidth={2}
            />
          ))}
        <TernaryAxes m={m} sym={sym} grid={fill === 'field'} />
        {contours.map((c, n) => (
          <path key={n} d={pathOf(m, c.pts)} className={c.major ? 'contour major' : 'contour'} fill="none" />
        ))}
        {contours
          .filter((c) => c.major && c.pts.length > 10)
          .map((c, n) => {
            const p = c.pts[Math.floor(c.pts.length * 0.5)];
            const [a, b] = m.px(p);
            return (
              <text key={`cl${n}`} x={a} y={b + 3} className="contour-label" textAnchor="middle">
                {Math.round(c.T - 273.15)}
              </text>
            );
          })}
        {curT.map((c, n) => (
          <path key={`ct${n}`} d={pathOf(m, c.points)} className="current-isotherm" fill="none" />
        ))}

        {Object.values(d.mono).map((mono) => {
          const id = `mono:${mono.id}`;
          const pts = mono.samples.map((s) => s.y);
          const mid = Math.floor(pts.length * 0.45);
          const [a, b] = m.px(pts[mid]);
          const [c, dd] = m.px(pts[mid + 8]);
          const ang = (Math.atan2(dd - b, c - a) * 180) / Math.PI;
          return (
            <g key={id}>
              <path d={pathOf(m, pts)} className={active(id) ? 'mono-line active' : 'mono-line'} fill="none" />
              <path d="M-5,-4 L4,0 L-5,4 Z" transform={`translate(${a},${b}) rotate(${ang})`} className={active(id) ? 'mono-arrow active' : 'mono-arrow'} />
            </g>
          );
        })}

        {showVert && <path d={pathOf(m, [line.p1, line.p2])} className="section-line" />}

        {path.length > 1 && (
          <>
            <path d={pathOf(m, path.map((q) => q.comp))} className="cryst-path" fill="none" />
            <path d={pathOf(m, done.map((q) => q.comp))} className="cryst-path done" fill="none" />
          </>
        )}

        {d.specialPoints
          .filter((p) => p.kind !== 'melting')
          .map((p) => {
            const [a, b] = m.px(p.comp);
            const big = p.kind === 'ternaryEutectic';
            const off = labelOffset(p.comp);
            return (
              <g key={p.id}>
                <circle cx={a} cy={b} r={active(p.id) ? 6 : big ? 4.5 : 3.6} className={active(p.id) ? 'sp-pt active' : 'sp-pt'} />
                <text x={a + off[0]} y={b + off[1]} className="sp-label" textAnchor={Math.abs(off[0]) < 3 ? 'middle' : off[0] < 0 ? 'end' : 'start'}>
                  {p.label}
                </text>
              </g>
            );
          })}
        {VERTICES.map((v, n) => {
          const [a, b] = m.px(v);
          const off = [
            [-14, 26],
            [14, 26],
            [22, 4],
          ][n];
          return (
            <text key={n} x={a + off[0]} y={b + off[1]} className="tm-label" textAnchor="middle">
              {Math.round(d.params.components[n].Tm - 273.15)} °C
            </text>
          );
        })}
        <circle cx={sx} cy={sy} r={4.5} className="state-pt" />
        {st.liquid && st.region !== 'L' && <circle cx={m.px(st.liquid)[0]} cy={m.px(st.liquid)[1]} r={4} className="liquid-pt" />}
      </svg>
      {hoverInfo && hover && (
        <div className="tooltip" style={{ left: hover.sx + 12, top: hover.sy + 12 }}>
          <div className="tt-title">{hoverInfo.title}</div>
          {hoverInfo.rows.map((r, n) => (
            <div key={n} className="tt-row mono">
              {r}
            </div>
          ))}
          <div className="tt-row">单击选中 · 双击设定成分</div>
        </div>
      )}
    </div>
  );
}

function describeHover(h: { x: Comp; id: string }, d: ReturnType<typeof useStore.getState>['diagram'], sym: string[]) {
  if (h.id.startsWith('pt:')) {
    const p = d.specialPoints.find((q) => q.id === h.id)!;
    return {
      title: p.kind === 'ternaryEutectic' ? '三元共晶点 E' : `二元共晶点 ${p.label}`,
      rows: [p.comp.map((v, n) => `x(${sym[n]}) ${(v * 100).toFixed(1)}%`).join('  '), `T = ${formatC(p.T)}`],
    };
  }
  if (h.id.startsWith('mono:')) {
    const mono = d.mono[h.id.slice(5)];
    return {
      title: `单变线 E_${sym[mono.i]}${sym[mono.j]} → E`,
      rows: [`L → ${sym[mono.i]} + ${sym[mono.j]}`, `${formatC(mono.samples[0].T, 0)} → ${formatC(d.eutectic.T, 0)}`],
    };
  }
  const L = d.liquidus(h.x);
  return {
    title: `${sym[L.primary]} 初晶区`,
    rows: [h.x.map((v, n) => `x(${sym[n]}) ${(Math.max(0, v) * 100).toFixed(1)}%`).join('  '), `T_liq = ${formatC(L.T)}`],
  };
}

function labelOffset(c: Comp): [number, number] {
  // 二元共晶点在边上：标签沿质心方向向内偏移；三元共晶点：右下方
  const u = c[1] + 0.5 * c[2] - 0.5;
  const v = c[2] - 1 / 3;
  const len = Math.hypot(u, v) || 1;
  const onEdge = Math.min(c[0], c[1], c[2]) < 1e-6;
  if (!onEdge) return [8, 14];
  return [(-u / len) * 12 + (u > 0 ? -2 : 2), (v / len) * 12 + 4];
}

function distSeg(m: TriMap, px: number, py: number, a: Comp, b: Comp): number {
  const [x1, y1] = m.px(a);
  const [x2, y2] = m.px(b);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

