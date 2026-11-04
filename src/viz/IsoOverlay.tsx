import { centroid, liquidLabelPos } from '../core/isoTexture';
import type { PhaseDiagram } from '../core/diagram';
import type { IsoSection } from '../core/isothermal';
import { COLOR } from '../ui/tokens';
import type { TriMap } from './TernaryPlot';

/** 等温截面的 SVG 叠加层：相区轮廓、饱和弧（相界）、连结线、相区标签、液相区标签。填充由 canvas 底图负责。 */
export function IsoOverlay({ sec, d, m, fontPx }: { sec: IsoSection; d: PhaseDiagram; m: TriMap; fontPx: number }) {
  const pts = (poly: IsoSection['regions'][number]['poly']) => poly.map((x) => m.px(x).join(',')).join(' ');
  const agg = new Map<string, { a: number; x: number; y: number }>();
  const labels: { key: string; x: number; y: number }[] = [];
  for (const r of sec.regions) {
    const { area, cx, cy } = centroid(r.poly.map((x) => m.px(x)));
    if (r.fine) {
      const g = agg.get(r.key) ?? { a: 0, x: 0, y: 0 };
      const A = Math.abs(area);
      g.a += A;
      g.x += A * cx;
      g.y += A * cy;
      agg.set(r.key, g);
      continue;
    }
    if (Math.abs(area) >= fontPx * fontPx * (r.kind === 'two' ? 4 : 3)) labels.push({ key: r.key, x: cx, y: cy });
  }
  agg.forEach((g, k) => {
    if (k !== 'L' && g.a >= fontPx * fontPx * 4) labels.push({ key: k, x: g.x / g.a, y: g.y / g.a });
  });
  const lp = liquidLabelPos(d, sec.T);
  if (lp) {
    const p = m.px(lp);
    labels.push({ key: 'L', x: p[0], y: p[1] });
  }
  return (
    <g className="iso-overlay" pointerEvents="none">
      {sec.regions
        .filter((r) => !r.fine)
        .map((r, k) => (
          <polygon key={`r${k}`} points={pts(r.poly)} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={0.8} />
        ))}
      {sec.ties.length > 0 && (
        <path d={sec.ties.map(([a, b]) => `M${m.px(a).join(',')}L${m.px(b).join(',')}`).join('')} fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {sec.arcs.map((a, k) => (
        <polyline key={`a${k}`} points={a.pts.map((x) => m.px(x).join(',')).join(' ')} fill="none" stroke={COLOR.black} strokeWidth={Math.max(1.4, fontPx / 7)} strokeDasharray={a.approx ? '4 3' : undefined} />
      ))}
      {labels.map((l, k) => (
        <text key={`l${k}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="f2-lab iso-lab" style={{ fontSize: fontPx * 0.95 }}>
          {l.key}
        </text>
      ))}
    </g>
  );
}
