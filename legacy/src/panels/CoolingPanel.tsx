import { useEffect, useMemo, useRef } from 'react';
import { sampleAt, timeAtT } from '../core/cooling';
import { COMPONENT_COLORS, formatC } from '../core/phases';
import { useStore } from '../state/store';
import { Icon } from '../ui/Icon';
import { useSize } from '../ui/useSize';

const DURATION = 24; // 1× 速度下完整冷却过程的播放时长 / s
const STEP_C = 5; // 单步降温 / K

/** 冷却模拟：播放/暂停/回放/单步，冷却曲线与相分数随时间变化 */
export function CoolingPanel() {
  const sim = useStore((s) => s.sim);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const seek = useStore((s) => s.seek);
  const setSpeed = useStore((s) => s.setSpeed);
  const T = useStore((s) => s.T);
  const r = sim.result;

  // 播放驱动
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!sim.playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const s = useStore.getState();
      if (!s.sim.playing) return;
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      const t = s.sim.t + (dt / DURATION) * s.sim.speed;
      if (t >= 1) {
        s.seek(1);
        s.pause();
        return;
      }
      s.seek(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim.playing]);

  const cur = sampleAt(r, sim.t);
  const p = r.plateau;

  const step = (dir: 1 | -1) => {
    pause();
    const t = sim.t;
    const inPlateau = t >= p.t0 - 1e-9 && t <= p.t1 + 1e-9 && p.t1 > p.t0;
    const dq = (p.t1 - p.t0) / 10;
    if (inPlateau && !(dir < 0 && t <= p.t0 + 1e-9) && !(dir > 0 && t >= p.t1 - 1e-9)) {
      seek(Math.min(p.t1, Math.max(p.t0, t + dir * dq)));
      return;
    }
    const T2 = cur.T - dir * STEP_C;
    let t2 = timeAtT(r, T2);
    if (dir > 0 && t < p.t0 - 1e-9 && t2 > p.t0) t2 = p.t0;
    if (dir < 0 && t > p.t1 + 1e-9 && t2 < p.t1) t2 = p.t1;
    if (dir < 0 && t <= p.t0 + 1e-9 && t > p.t0 - 1e-9) t2 = timeAtT(r, p.T + STEP_C);
    seek(t2);
  };
  const jumpEvent = (dir: 1 | -1) => {
    pause();
    const ts = r.events.map((e) => e.t);
    const target = dir > 0 ? ts.find((t) => t > sim.t + 1e-6) : [...ts].reverse().find((t) => t < sim.t - 1e-6);
    seek(target ?? (dir > 0 ? 1 : 0));
  };

  const activeEvent = [...r.events].reverse().find((e) => e.t <= sim.t + 1e-9);

  return (
    <div className="cooling">
      <div className="cool-left">
        <div className="transport">
          <button className="btn icon" title="回到起点" onClick={() => { pause(); seek(0); }}>
            <Icon name="first" />
          </button>
          <button className="btn icon" title="上一事件" onClick={() => jumpEvent(-1)}>
            <Icon name="prevEvent" />
          </button>
          <button className="btn icon" title={`后退一步（+${STEP_C} °C）`} onClick={() => step(-1)}>
            <Icon name="stepBack" />
          </button>
          <button className="btn icon primary" title={sim.playing ? '暂停' : '播放'} onClick={() => (sim.playing ? pause() : play())}>
            <Icon name={sim.playing ? 'pause' : 'play'} />
          </button>
          <button className="btn icon" title={`前进一步（−${STEP_C} °C）`} onClick={() => step(1)}>
            <Icon name="stepFwd" />
          </button>
          <button className="btn icon" title="下一事件" onClick={() => jumpEvent(1)}>
            <Icon name="nextEvent" />
          </button>
          <select className="select sm" value={sim.speed} onChange={(e) => setSpeed(Number(e.target.value))} title="播放速度">
            {[0.25, 0.5, 1, 2, 4].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </div>
        <input
          className="slider progress"
          type="range"
          min={0}
          max={1}
          step={0.0005}
          value={sim.t}
          style={{ ['--pct' as string]: `${sim.t * 100}%`, ['--accent' as string]: '#C00000' }}
          onChange={(e) => {
            pause();
            seek(parseFloat(e.target.value));
          }}
        />
        <div className="cool-status mono small">
          T = {formatC(T)} · f(L) = {(cur.fL * 100).toFixed(1)}%{cur.xi !== undefined ? ` · 反应进度 ${(cur.xi * 100).toFixed(0)}%` : ''}
        </div>
        <ol className="events">
          {r.events.map((e, n) => (
            <li key={n} className={activeEvent === e ? 'on' : ''} onClick={() => { pause(); seek(e.t); }}>
              <div className="ev-head">
                <span className="ev-T mono">{formatC(e.T)}</span>
                <span>{e.title}</span>
              </div>
              {activeEvent === e && <div className="ev-detail">{e.detail}</div>}
            </li>
          ))}
        </ol>
      </div>
      <div className="cool-chart">
        <div className="chart-title">示意冷却曲线 T–t（恒定散热速率，无过冷）</div>
        <CoolingCurve />
      </div>
      <div className="cool-chart">
        <div className="chart-title">相分数 f–t（杠杆规则）</div>
        <FractionChart />
        <div className="constituents">
          <span className="muted">最终组织：</span>
          {r.constituents.map((c, n) => (
            <span key={n} className="mono small">
              {c.name} {(c.fraction * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const CP = { l: 44, r: 10, t: 8, b: 22 };

function useChartScales(w: number, h: number) {
  const W = Math.max(10, w - CP.l - CP.r);
  const H = Math.max(10, h - CP.t - CP.b);
  return { W, H, x: (t: number) => CP.l + t * W, inv: (px: number) => (px - CP.l) / W };
}

function Scrubber({ w, h, inv }: { w: number; h: number; inv: (px: number) => number }) {
  const seek = useStore((s) => s.seek);
  const pause = useStore((s) => s.pause);
  const drag = useRef(false);
  const go = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    seek(Math.min(1, Math.max(0, inv(e.clientX - r.left))));
  };
  return (
    <rect
      x={0}
      y={0}
      width={w}
      height={h}
      fill="transparent"
      style={{ cursor: 'ew-resize' }}
      onPointerDown={(e) => {
        drag.current = true;
        pause();
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => drag.current && go(e)}
      onPointerUp={() => (drag.current = false)}
    />
  );
}

function CoolingCurve() {
  const [ref, size] = useSize<HTMLDivElement>();
  const sim = useStore((s) => s.sim);
  const r = sim.result;
  const { W, H, x, inv } = useChartScales(size.w, size.h);
  const T0 = r.samples[r.samples.length - 1].T;
  const T1 = r.samples[0].T;
  const y = (T: number) => CP.t + ((T1 - T) / (T1 - T0)) * H;
  const path = useMemo(
    () => r.samples.map((s, n) => `${n ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.T).toFixed(1)}`).join(''),
    [r, size.w, size.h],
  );
  if (!size.w) return <div ref={ref} className="chart-fill" />;
  const cur = sampleAt(r, sim.t);
  const ticks: number[] = [];
  const stepC = T1 - T0 > 600 ? 200 : 100;
  for (let t = Math.ceil((T0 - 273.15) / stepC) * stepC; t <= T1 - 273.15; t += stepC) ticks.push(t);
  return (
    <div ref={ref} className="chart-fill">
      <svg width={size.w} height={size.h} className="chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CP.l} x2={CP.l + W} y1={y(t + 273.15)} y2={y(t + 273.15)} className="grid-line" />
            <text x={CP.l - 5} y={y(t + 273.15) + 3.5} className="tick-label" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {r.events.map((e, n) => (
          <g key={n}>
            <line x1={x(e.t)} x2={x(e.t)} y1={CP.t} y2={CP.t + H} className="event-line" />
          </g>
        ))}
        <path d={path} className="curve" fill="none" />
        <rect x={CP.l} y={CP.t} width={W} height={H} className="plot-frame" />
        <line x1={x(sim.t)} x2={x(sim.t)} y1={CP.t} y2={CP.t + H} className="cursor-line" />
        <circle cx={x(sim.t)} cy={y(cur.T)} r={4} className="state-pt" />
        <text x={CP.l + W / 2} y={size.h - 5} className="axis-label" textAnchor="middle">
          时间（归一化）
        </text>
        <text transform={`translate(11,${CP.t + H / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">
          T / °C
        </text>
        <Scrubber w={size.w} h={size.h} inv={inv} />
      </svg>
    </div>
  );
}

function FractionChart() {
  const [ref, size] = useSize<HTMLDivElement>();
  const sim = useStore((s) => s.sim);
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  const r = sim.result;
  const { W, H, x, inv } = useChartScales(size.w, size.h);
  const y = (f: number) => CP.t + (1 - f) * H;
  const areas = useMemo(() => {
    // 堆叠：A、B、C 固相，自下而上；液相在顶部
    const layers = [0, 1, 2].map((k) => ({ k, top: [] as string[], bottom: [] as string[] }));
    const liquid: string[] = [];
    for (const s of r.samples) {
      let acc = 0;
      for (const L of layers) {
        L.bottom.push(`${x(s.t).toFixed(1)},${y(acc).toFixed(1)}`);
        acc += s.fs[L.k];
        L.top.push(`${x(s.t).toFixed(1)},${y(acc).toFixed(1)}`);
      }
      liquid.push(`${x(s.t).toFixed(1)},${y(acc).toFixed(1)}`);
    }
    return {
      solids: layers.map((L) => ({ k: L.k, d: `M${L.top.join('L')}L${[...L.bottom].reverse().join('L')}Z` })),
      liquid: `M${liquid.join('L')}L${x(1)},${y(1)}L${x(0)},${y(1)}Z`,
    };
  }, [r, size.w, size.h]);
  if (!size.w) return <div ref={ref} className="chart-fill" />;
  const cur = sampleAt(r, sim.t);
  return (
    <div ref={ref} className="chart-fill">
      <svg width={size.w} height={size.h} className="chart-svg">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={CP.l} x2={CP.l + W} y1={y(f)} y2={y(f)} className="grid-line" />
            <text x={CP.l - 5} y={y(f) + 3.5} className="tick-label" textAnchor="end">
              {(f * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        <path d={areas.liquid} fill="#dfe8f2" />
        {areas.solids.map((a) => (
          <path key={a.k} d={a.d} fill={COMPONENT_COLORS[a.k]} fillOpacity={0.55} stroke={COMPONENT_COLORS[a.k]} strokeWidth={0.6} />
        ))}
        <rect x={CP.l} y={CP.t} width={W} height={H} className="plot-frame" />
        <line x1={x(sim.t)} x2={x(sim.t)} y1={CP.t} y2={CP.t + H} className="cursor-line" />
        <g className="legend" transform={`translate(${CP.l + 6},${CP.t + 12})`}>
          <rect x={-3} y={-11} width={86} height={52} fill="rgba(255,255,255,0.85)" />
          <rect x={0} y={-8} width={9} height={9} fill="#dfe8f2" stroke="#9fb3c8" />
          <text x={13} y={0}>L {(cur.fL * 100).toFixed(1)}%</text>
          {sym.map((s, k) => (
            <g key={k} transform={`translate(0,${12 * (k + 1)})`}>
              <rect x={0} y={-8} width={9} height={9} fill={COMPONENT_COLORS[k]} fillOpacity={0.55} />
              <text x={13} y={0}>
                {s} {(cur.fs[k] * 100).toFixed(1)}%
              </text>
            </g>
          ))}
        </g>
        <text x={CP.l + W / 2} y={size.h - 5} className="axis-label" textAnchor="middle">
          时间（归一化）
        </text>
        <Scrubber w={size.w} h={size.h} inv={inv} />
      </svg>
    </div>
  );
}
