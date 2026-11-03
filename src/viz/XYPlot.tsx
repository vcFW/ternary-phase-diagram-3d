import { useRef, type ReactNode } from 'react';
import { useSize } from '../ui/useSize';

/** 轻量科学绘图（SVG）：坐标轴、刻度、网格、多条曲线、标记线与点。 */
export interface Series {
  id: string;
  pts: [number, number][];
  color: string;
  width?: number;
  dash?: string;
  label?: string;
}

export interface XYMap {
  X: (x: number) => number;
  Y: (y: number) => number;
  invX: (px: number) => number;
  invY: (py: number) => number;
  box: { l: number; t: number; w: number; h: number };
}

export interface XYPlotProps {
  series: Series[];
  xlim?: [number, number];
  ylim?: [number, number];
  xlabel?: string;
  ylabel?: string;
  xfmt?: (v: number) => string;
  yfmt?: (v: number) => string;
  vlines?: { x: number; color?: string; label?: string; dash?: string }[];
  hlines?: { y: number; color?: string; label?: string; dash?: string }[];
  points?: { x: number; y: number; color?: string; r?: number; label?: string }[];
  onPick?: (x: number, y: number, phase: 'down' | 'move' | 'up') => void;
  children?: (m: XYMap) => ReactNode;
  height?: number;
  legend?: boolean;
  margin?: { l: number; r: number; t: number; b: number };
}

function niceTicks(lo: number, hi: number, n = 6): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nf = raw / mag;
  const step = (nf < 1.5 ? 1 : nf < 3 ? 2 : nf < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function XYPlot({ series, xlim, ylim, xlabel, ylabel, xfmt, yfmt, vlines, hlines, points, onPick, children, height = 220, legend = true, margin }: XYPlotProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const { w } = useSize(wrap);
  const m = margin ?? { l: 54, r: 12, t: 10, b: 34 };
  const all = series.flatMap((s) => s.pts).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  // 无数据时退回单位区间，避免 NaN 坐标
  const xs = xlim ?? (all.length ? [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))] : [0, 1]);
  let ys = ylim ?? (all.length ? [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))] : [0, 1]);
  if (!ylim) {
    const pad = (ys[1] - ys[0]) * 0.06 || 1;
    ys = [ys[0] - pad, ys[1] + pad];
  }
  const pw = Math.max(10, w - m.l - m.r);
  const ph = Math.max(10, height - m.t - m.b);
  const X = (x: number) => m.l + ((x - xs[0]) / (xs[1] - xs[0] || 1)) * pw;
  const Y = (y: number) => m.t + ((ys[1] - y) / (ys[1] - ys[0] || 1)) * ph;
  const map: XYMap = {
    X,
    Y,
    invX: (px) => xs[0] + ((px - m.l) / pw) * (xs[1] - xs[0]),
    invY: (py) => ys[1] - ((py - m.t) / ph) * (ys[1] - ys[0]),
    box: { l: m.l, t: m.t, w: pw, h: ph },
  };
  const xt = niceTicks(xs[0], xs[1], Math.max(3, Math.floor(pw / 70)));
  const yt = niceTicks(ys[0], ys[1], Math.max(3, Math.floor(ph / 36)));
  const drag = useRef(false);
  const ev = (e: React.PointerEvent, phase: 'down' | 'move' | 'up') => {
    if (!onPick) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = map.invX(e.clientX - r.left);
    const y = map.invY(e.clientY - r.top);
    if (phase === 'down') {
      drag.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      onPick(x, y, 'down');
    } else if (drag.current) {
      if (phase === 'up') drag.current = false;
      onPick(x, y, phase);
    }
  };
  const fx = xfmt ?? ((v: number) => String(+v.toPrecision(6)));
  const fy = yfmt ?? ((v: number) => String(+v.toPrecision(6)));
  const clipId = useRef(`clip${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="xy" ref={wrap}>
      <svg width={w} height={height} onPointerDown={(e) => ev(e, 'down')} onPointerMove={(e) => ev(e, 'move')} onPointerUp={(e) => ev(e, 'up')} style={{ cursor: onPick ? 'crosshair' : 'default' }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        <rect x={m.l} y={m.t} width={pw} height={ph} className="xy-bg" />
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ph} className="xy-grid" />
            <text x={X(v)} y={m.t + ph + 14} className="xy-tick" textAnchor="middle">{fx(v)}</text>
          </g>
        ))}
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + pw} y1={Y(v)} y2={Y(v)} className="xy-grid" />
            <text x={m.l - 5} y={Y(v) + 3.5} className="xy-tick" textAnchor="end">{fy(v)}</text>
          </g>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {hlines?.map((l, k) => <line key={`h${k}`} x1={m.l} x2={m.l + pw} y1={Y(l.y)} y2={Y(l.y)} stroke={l.color ?? '#7b8490'} strokeDasharray={l.dash ?? '4 3'} strokeWidth={1} />)}
          {vlines?.map((l, k) => <line key={`v${k}`} x1={X(l.x)} x2={X(l.x)} y1={m.t} y2={m.t + ph} stroke={l.color ?? '#7b8490'} strokeDasharray={l.dash ?? '4 3'} strokeWidth={1} />)}
          {series.map((s) => (
            <polyline key={s.id} points={s.pts.filter((p) => Number.isFinite(p[1])).map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} strokeLinejoin="round" />
          ))}
          {points?.map((p, k) => (
            <g key={`p${k}`}>
              <circle cx={X(p.x)} cy={Y(p.y)} r={p.r ?? 3.5} fill="#fff" stroke={p.color ?? '#c00000'} strokeWidth={1.6} />
              {p.label && <text x={X(p.x) + 6} y={Y(p.y) - 6} className="xy-lab" fill={p.color ?? '#c00000'}>{p.label}</text>}
            </g>
          ))}
          {children?.(map)}
        </g>
        {vlines?.filter((l) => l.label).map((l, k) => <text key={`vl${k}`} x={X(l.x) + 3} y={m.t + 11} className="xy-lab" fill={l.color ?? '#4b5563'}>{l.label}</text>)}
        {hlines?.filter((l) => l.label).map((l, k) => <text key={`hl${k}`} x={m.l + pw - 3} y={Y(l.y) - 4} className="xy-lab" textAnchor="end" fill={l.color ?? '#4b5563'}>{l.label}</text>)}
        <rect x={m.l} y={m.t} width={pw} height={ph} className="xy-frame" />
        {xlabel && <text x={m.l + pw / 2} y={height - 4} className="xy-axl" textAnchor="middle">{xlabel}</text>}
        {ylabel && <text transform={`translate(12 ${m.t + ph / 2}) rotate(-90)`} className="xy-axl" textAnchor="middle">{ylabel}</text>}
      </svg>
      {legend && series.some((s) => s.label) && (
        <div className="xy-legend">
          {series.filter((s) => s.label).map((s) => (
            <span key={s.id}>
              <i style={{ background: s.color, height: s.dash ? 0 : 2, borderTop: s.dash ? `2px dashed ${s.color}` : undefined }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
