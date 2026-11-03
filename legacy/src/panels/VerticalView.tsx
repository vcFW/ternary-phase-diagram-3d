import { useEffect, useMemo, useRef, useState } from 'react';
import { lerpComp } from '../core/barycentric';
import { ALL_REGIONS } from '../core/diagram';
import { formatC, hexToRgb, regionName, regionTint } from '../core/phases';
import type { CompIndex } from '../core/types';
import {
  axisComponent,
  axisRange,
  projectOnLine,
  rasterizeVertical,
  verticalLine,
  verticalSectionCurves,
} from '../core/verticalSection';
import { useStore } from '../state/store';
import { useSize } from '../ui/useSize';

const PAD = { l: 52, r: 16, t: 14, b: 38 };

/** 垂直截面（变温截面）：相界由三维几何精确求交，填色为逐像素相区判定 */
export function VerticalView() {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const d = useStore((s) => s.diagram);
  const vert = useStore((s) => s.vert);
  const T = useStore((s) => s.T);
  const x = useStore((s) => s.comp);
  const setT = useStore((s) => s.setT);
  const setComp = useStore((s) => s.setComp);
  const sym = d.params.components.map((c) => c.symbol);
  const tr = d.tRange;
  const [hover, setHover] = useState<{ px: number; py: number; s: number; T: number } | null>(null);

  const line = useMemo(() => verticalLine(vert), [vert.mode, vert.k, vert.value]);
  const geo = useMemo(() => verticalSectionCurves(d, line), [d, line]);
  const aComp = axisComponent(vert);
  const [, aMax] = axisRange(vert);

  const W = Math.max(10, size.w - PAD.l - PAD.r);
  const Hh = Math.max(10, size.h - PAD.t - PAD.b);
  const sx = (s: number) => PAD.l + s * W;
  const ty = (t: number) => PAD.t + ((tr[1] - t) / (tr[1] - tr[0])) * Hh;

  // 逐像素填色
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(W * dpr);
    const h = Math.floor(Hh * dpr);
    cv.width = w;
    cv.height = h;
    const raster = rasterizeVertical(d, line, w, h, tr);
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const pal = ALL_REGIONS.map((k) => hexToRgb(regionTint(k, 0.3)));
    for (let n = 0; n < raster.length; n++) {
      const c = pal[raster[n]];
      img.data[n * 4] = c[0];
      img.data[n * 4 + 1] = c[1];
      img.data[n * 4 + 2] = c[2];
      img.data[n * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [d, line, W, Hh]);

  // 区域标注：低分辨率栅格的连通域 + 距离变换取内点
  const labels = useMemo(() => regionLabels(d, line, tr), [d, line]);

  if (!size.w) return <div ref={ref} className="chart-fill" />;

  const toPath = (pts: { s: number; T: number }[]) =>
    pts.map((p, n) => `${n ? 'L' : 'M'}${sx(p.s).toFixed(2)},${ty(p.T).toFixed(2)}`).join('');

  const proj = projectOnLine(line, x);
  const onLine = proj.dist < 2e-3 && proj.s >= -1e-6 && proj.s <= 1 + 1e-6;
  const tTicks: number[] = [];
  for (let t = Math.ceil((tr[0] - 273.15) / 100) * 100; t <= tr[1] - 273.15 + 1e-6; t += 100) tTicks.push(t);
  const sTicks: number[] = [];
  const step = aMax > 0.5 ? 0.1 : 0.05;
  for (let v = 0; v <= aMax + 1e-9; v += step) sTicks.push(v);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const s = (px - PAD.l) / W;
    const t = tr[1] - ((py - PAD.t) / Hh) * (tr[1] - tr[0]);
    if (s < 0 || s > 1 || t < tr[0] || t > tr[1]) setHover(null);
    else setHover({ px, py, s, T: t });
  };
  const onClick = () => {
    if (!hover) return;
    setComp(lerpComp(line.p1, line.p2, hover.s));
    setT(hover.T);
  };

  const title =
    vert.mode === 'const'
      ? `x(${sym[vert.k]}) = ${vert.value.toFixed(3)} 等含量截面`
      : `过 ${sym[vert.k]} 顶点定比截面  x(${sym[(vert.k + 1) % 3]}) : x(${sym[(vert.k + 2) % 3]}) = ${vert.value.toFixed(2)} : ${(1 - vert.value).toFixed(2)}`;
  const hx = hover ? lerpComp(line.p1, line.p2, hover.s) : null;

  return (
    <div ref={ref} className="chart-fill">
      <canvas ref={canvasRef} className="chart-canvas" style={{ left: PAD.l, top: PAD.t, width: W, height: Hh }} />
      <svg width={size.w} height={size.h} className="chart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
        {tTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + W} y1={ty(t + 273.15)} y2={ty(t + 273.15)} className="grid-line" />
            <text x={PAD.l - 6} y={ty(t + 273.15) + 3.5} className="tick-label" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {sTicks.map((v) => {
          const s = aMax > 0 ? v / aMax : 0;
          return (
            <g key={v}>
              <line y1={PAD.t} y2={PAD.t + Hh} x1={sx(s)} x2={sx(s)} className="grid-line" />
              <text x={sx(s)} y={PAD.t + Hh + 14} className="tick-label" textAnchor="middle">
                {v.toFixed(step < 0.1 ? 2 : 1)}
              </text>
            </g>
          );
        })}
        {geo.curves.map((c, n) => (
          <path
            key={n}
            d={toPath(c.points)}
            fill="none"
            className={c.kind === 'liquidus' ? 'phase-boundary strong' : c.kind === 'eutectic' ? 'phase-boundary eut' : 'phase-boundary'}
          />
        ))}
        {labels.map((l, n) => {
          const name = regionName(l.key, sym);
          const half = name.length * 3.6 + 2;
          const x0 = Math.min(PAD.l + W - half, Math.max(PAD.l + half, sx(l.s)));
          return (
            <text key={n} x={x0} y={ty(l.T) + 4} className="region-label" textAnchor="middle">
              {name}
            </text>
          );
        })}
        <rect x={PAD.l} y={PAD.t} width={W} height={Hh} className="plot-frame" />
        {/* 当前等温面位置 */}
        <line x1={PAD.l} x2={PAD.l + W} y1={ty(T)} y2={ty(T)} className="current-T" />
        <text x={PAD.l + W - 4} y={ty(T) - 4} className="chart-note blue" textAnchor="end">
          {formatC(T)}
        </text>
        {onLine ? (
          <>
            <line x1={sx(proj.s)} x2={sx(proj.s)} y1={PAD.t} y2={PAD.t + Hh} className="state-vline" />
            <circle cx={sx(proj.s)} cy={ty(d.liquidus(x).T)} r={4} className="liq-cross" />
            <circle cx={sx(proj.s)} cy={ty(T)} r={4.5} className="state-pt" />
          </>
        ) : (
          <text x={PAD.l + 6} y={PAD.t + 14} className="chart-note">
            成分点不在此截面上（启用"锁定成分点"可联动）
          </text>
        )}
        <text x={PAD.l + W / 2} y={size.h - 6} className="axis-label" textAnchor="middle">
          x({sym[aComp as CompIndex]})
        </text>
        <text transform={`translate(13,${PAD.t + Hh / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">
          T / °C
        </text>
        <text x={PAD.l + 4} y={PAD.t + Hh - 6} className="chart-note">
          {title}
        </text>
      </svg>
      {hover && hx && (
        <div className="tooltip" style={{ left: hover.px + 12, top: hover.py + 12 }}>
          <div className="tt-title">{regionName(d.classify(hx, hover.T), sym)}</div>
          <div className="tt-row mono">
            {hx.map((v, n) => (
              <span key={n}>
                x({sym[n]}) {(Math.max(0, v) * 100).toFixed(1)}%
              </span>
            ))}
          </div>
          <div className="tt-row mono">T = {formatC(hover.T)}</div>
          <div className="tt-row">单击设定成分与温度</div>
        </div>
      )}
    </div>
  );
}

function regionLabels(
  d: ReturnType<typeof useStore.getState>['diagram'],
  line: { p1: [number, number, number]; p2: [number, number, number] },
  tr: [number, number],
) {
  const w = 120;
  const h = 90;
  const r = rasterizeVertical(d, line, w, h, tr);
  const comp = new Int32Array(w * h).fill(-1);
  const out: { key: string; s: number; T: number }[] = [];
  let label = 0;
  for (let n = 0; n < w * h; n++) {
    if (comp[n] >= 0) continue;
    const cls = r[n];
    const stack = [n];
    const members: number[] = [];
    comp[n] = label;
    while (stack.length) {
      const q = stack.pop()!;
      members.push(q);
      const qx = q % w;
      const qy = (q / w) | 0;
      const nb = [qx > 0 ? q - 1 : -1, qx < w - 1 ? q + 1 : -1, qy > 0 ? q - w : -1, qy < h - 1 ? q + w : -1];
      for (const v of nb) {
        if (v >= 0 && comp[v] < 0 && r[v] === cls) {
          comp[v] = label;
          stack.push(v);
        }
      }
    }
    if (members.length > 60) {
      // 选取离边界最远的像素（棋盘距离）
      const set = new Set(members);
      let best = members[0];
      let bestD = -1;
      for (const q of members) {
        const qx = q % w;
        const qy = (q / w) | 0;
        let dist = 0;
        while (dist < 40) {
          const k = dist + 1;
          const pts = [q - k, q + k, q - k * w, q + k * w];
          const okx = qx - k >= 0 && qx + k < w;
          const oky = qy - k >= 0 && qy + k < h;
          if (!okx || !oky || pts.some((p) => !set.has(p))) break;
          dist++;
        }
        // 横向更宽松：标签为横排文字
        if (dist > bestD) {
          bestD = dist;
          best = q;
        }
      }
      if (bestD >= 2) {
        const bx = best % w;
        const by = (best / w) | 0;
        out.push({ key: ALL_REGIONS[cls], s: (bx + 0.5) / w, T: tr[1] - ((by + 0.5) / h) * (tr[1] - tr[0]) });
      }
    }
    label++;
  }
  return out;
}
