import { useMemo, useState } from 'react';
import { inTriangle, polygonCentroid, toXY, VERTICES } from '../core/barycentric';
import { formatC, REGION_COLORS, regionName, regionTint } from '../core/phases';
import type { Comp } from '../core/types';
import { verticalLine } from '../core/verticalSection';
import { currentState, useStore } from '../state/store';
import { useSize } from '../ui/useSize';
import { makeTriMap, pathOf, TernaryAxes } from './TernaryAxes';

/** 等温截面：与三维水平切片同源（同一组精确多边形） */
export function IsothermalView({ mode }: { mode: 'comp' | 'select' }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const x = useStore((s) => s.comp);
  const sim = useStore((s) => s.sim);
  const vert = useStore((s) => s.vert);
  const showVert = useStore((s) => s.layers.vertSlice.visible);
  const selection = useStore((s) => s.selection);
  const setComp = useStore((s) => s.setComp);
  const select = useStore((s) => s.select);
  const sym = d.params.components.map((c) => c.symbol);
  const [hover, setHover] = useState<{ sx: number; sy: number; x: Comp } | null>(null);

  const m = useMemo(() => makeTriMap(size.w, size.h), [size.w, size.h]);
  const sec = useMemo(() => d.isothermalSection(T), [d, T]);
  const st = currentState(d, x, T, sim);

  if (!size.w) return <div ref={ref} className="chart-fill" />;

  // 两相区连结线扇
  const fans: [Comp, Comp][] = [];
  for (const c of sec.isotherms) {
    const n = c.points.length;
    for (let q = 1; q < 8; q++) fans.push([VERTICES[c.i], c.points[Math.round((q / 8) * (n - 1))]]);
  }

  const selRegion = selection?.startsWith('region:') ? selection.slice(7) : null;
  const line = verticalLine(vert);
  const [sx, sy] = m.px(x);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const c = m.inv(px, py);
    setHover(inTriangle(c, 1e-9) ? { sx: px, sy: py, x: c } : null);
  };
  const onClick = () => {
    if (!hover) return;
    if (mode === 'comp') setComp(hover.x);
    else select(`region:${d.classify(hover.x, T)}`);
  };

  return (
    <div ref={ref} className="chart-fill">
      <svg width={size.w} height={size.h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} className="chart-svg">
        {sec.regions.map((r) => (
          <path
            key={r.key}
            d={pathOf(m, r.polygon, true)}
            fill={regionTint(r.key, selRegion === r.key ? 0.6 : 0.3)}
            stroke={selRegion === r.key ? REGION_COLORS[r.key] : 'none'}
            strokeWidth={selRegion === r.key ? 2 : 0}
          />
        ))}
        <TernaryAxes m={m} sym={sym} />
        {fans.map(([a, b], n) => {
          const [x1, y1] = m.px(a);
          const [x2, y2] = m.px(b);
          return <line key={n} x1={x1} y1={y1} x2={x2} y2={y2} className="tie-line" />;
        })}
        {sec.triangles.map((t, n) => (
          <path key={n} d={pathOf(m, [VERTICES[t.i], t.m, VERTICES[t.j]], true)} className="phase-boundary" fill="none" />
        ))}
        {sec.isotherms.map((c, n) => (
          <path key={n} d={pathOf(m, c.points)} className="phase-boundary strong" fill="none" />
        ))}
        {sec.regions.map((r) => {
          const pts = r.polygon.map((p) => toXY(p));
          const { area, cx, cy } = polygonCentroid(pts);
          if (Math.abs(area) < 0.004) return null;
          const [lx, ly] = [m.ox + cx * m.side, m.oy - cy * m.side];
          return (
            <text key={`lab${r.key}`} x={lx} y={ly} className="region-label" textAnchor="middle">
              {regionName(r.key, sym)}
            </text>
          );
        })}
        {showVert && (
          <path d={pathOf(m, [line.p1, line.p2])} className="section-line" />
        )}

        {/* 状态点、液相点与连结线 */}
        {st.liquid && st.region !== 'L' && (
          <>
            {st.phases
              .filter((p) => p.phase !== 'L')
              .map((p, n) => {
                const [a, b] = m.px(p.comp);
                const [c, dd] = m.px(st.liquid!);
                return <line key={n} x1={a} y1={b} x2={c} y2={dd} className="tie-active" />;
              })}
            <circle cx={m.px(st.liquid)[0]} cy={m.px(st.liquid)[1]} r={4.5} className="liquid-pt" />
          </>
        )}
        <circle cx={sx} cy={sy} r={4.5} className="state-pt" />

        {sec.invariant && (
          <text x={m.w / 2} y={16} className="chart-note" textAnchor="middle">
            T = T_E：四相平衡平面 L + {sym.join(' + ')}
          </text>
        )}
        <text x={8} y={16} className="chart-note">
          T = {formatC(T)}
        </text>
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: hover.sx + 12, top: hover.sy + 12 }}>
          <div className="tt-title">{regionName(d.classify(hover.x, T), sym)}</div>
          <div className="tt-row mono">
            {hover.x.map((v, n) => (
              <span key={n}>
                x({sym[n]}) {(Math.max(0, v) * 100).toFixed(1)}%
              </span>
            ))}
          </div>
          <div className="tt-row">{mode === 'comp' ? '单击设定成分点' : '单击选中相区'}</div>
        </div>
      )}
    </div>
  );
}
