import { useEffect, useRef } from 'react';
import { haloText, THEME_LIGHT } from '../core/canvasDraw';
import { cel, phaseColor, toC } from '../core/colors';
import { useStore } from '../state/store';
import { useSize } from '../ui/useSize';
import { Segmented } from '../ui/controls';
import { COLOR } from '../ui/tokens';

/** 播放循环：按样本下标推进；不变反应平台内放慢，便于观察反应进程。 */
export function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      const n = s.trace.samples.length;
      const cur = s.trace.samples[Math.min(n - 1, Math.round(s.idx))];
      const rate = (cur.xi >= 0 ? 9 : 55) * s.speed;
      const next = s.idx + rate * dt;
      if (next >= n - 1) {
        s.setIdx(n - 1);
        s.setPlaying(false);
        return;
      }
      s.setIdx(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function drawCurve(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { trace, idx, diagram: d } = useStore.getState();
  const th = THEME_LIGHT;
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const S = trace.samples;
  const Tmax = S[0].T;
  const Tmin = S[S.length - 1].T;
  const tEnd = trace.tEnd || 1;
  const X = (t: number) => m.l + (t / tEnd) * pw;
  const Y = (T: number) => m.t + ((Tmax - T) / (Tmax - Tmin || 1)) * ph;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = th.grid;
  ctx.fillStyle = th.textDim;
  ctx.font = '10.5px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const step = (Tmax - Tmin) > 600 ? 200 : 100;
  for (let c = Math.ceil(toC(Tmin) / step) * step; c <= toC(Tmax); c += step) {
    ctx.beginPath();
    ctx.moveTo(m.l, Y(c + 273.15));
    ctx.lineTo(m.l + pw, Y(c + 273.15));
    ctx.stroke();
    ctx.fillText(`${c}`, m.l - 5, Y(c + 273.15));
  }
  ctx.save();
  ctx.translate(11, m.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('T / °C', 0, 0);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('冷却时间（恒定散热功率，任意单位 → 平台长度 ∝ 潜热）', m.l + pw / 2, h - 13);
  // 曲线
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = COLOR.ink;
  ctx.beginPath();
  S.forEach((s, i) => {
    if (i) ctx.lineTo(X(s.t), Y(s.T));
    else ctx.moveTo(X(s.t), Y(s.T));
  });
  ctx.stroke();
  // 已走过部分高亮
  const cur = S[Math.min(S.length - 1, Math.round(idx))];
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let i = 0; i <= Math.min(S.length - 1, Math.round(idx)); i++) {
    if (i) ctx.lineTo(X(S[i].t), Y(S[i].T));
    else ctx.moveTo(X(S[i].t), Y(S[i].T));
  }
  ctx.stroke();
  // 事件
  ctx.font = '600 10.5px system-ui, sans-serif';
  trace.events.forEach((e, k) => {
    if (e.kind === 'end') return;
    const sx = X(e.t);
    const sy = Y(e.T);
    ctx.fillStyle = e.plateau ? COLOR.component[0] : COLOR.accent;
    ctx.strokeStyle = COLOR.white;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    haloText(ctx, `${k + 1}`, sx + 7, sy - 3, th);
  });
  // 指针
  ctx.strokeStyle = COLOR.stateX0;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(X(cur.t), m.t);
  ctx.lineTo(X(cur.t), m.t + ph);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLOR.stateX0;
  ctx.beginPath();
  ctx.arc(X(cur.t), Y(cur.T), 5.5, 0, Math.PI * 2);
  ctx.fill();
  void d;
}

function drawFractions(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { trace, idx, diagram: d } = useStore.getState();
  const th = THEME_LIGHT;
  const m = { l: 34, r: 8, t: 10, b: 22 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const S = trace.samples;
  const tEnd = trace.tEnd || 1;
  const X = (t: number) => m.l + (t / tEnd) * pw;
  ctx.clearRect(0, 0, w, h);
  const ids = ['L', ...d.solids.map((s) => s.id)];
  const used = ids.filter((id) => S.some((s) => s.eq.phases.some((p) => p.id === id)));
  const cum = new Float64Array(S.length);
  for (const id of used) {
    ctx.fillStyle = phaseColor(d, id);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    S.forEach((s, i) => {
      const x = X(s.t);
      const y = m.t + ph * (1 - cum[i]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    const top = new Float64Array(S.length);
    S.forEach((s, i) => (top[i] = cum[i] + (s.eq.phases.find((p) => p.id === id)?.frac ?? 0)));
    for (let i = S.length - 1; i >= 0; i--) ctx.lineTo(X(S[i].t), m.t + ph * (1 - top[i]));
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < S.length; i++) cum[i] = top[i];
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(m.l, m.t, pw, ph);
  ctx.fillStyle = th.textDim;
  ctx.font = '10.5px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [0, 0.5, 1]) ctx.fillText(`${v * 100}%`, m.l - 4, m.t + ph * (1 - v));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('相分数（摩尔分数，杠杆规则）', m.l + pw / 2, h - 13);
  const cur = S[Math.min(S.length - 1, Math.round(idx))];
  ctx.strokeStyle = COLOR.stateX0;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(X(cur.t), m.t);
  ctx.lineTo(X(cur.t), m.t + ph);
  ctx.stroke();
  ctx.setLineDash([]);
  // 图例
  let lx = m.l + 6;
  ctx.font = '600 10.5px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const id of used) {
    ctx.fillStyle = phaseColor(d, id);
    ctx.fillRect(lx, m.t + 5, 9, 9);
    haloText(ctx, id, lx + 12, m.t + 10, th);
    lx += 12 + ctx.measureText(id).width + 10;
  }
}

function ChartCanvas({ draw, onSeek }: { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; onSeek: (frac: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w, h, dpr } = useSize(wrap);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
  }, [w, h, dpr, trace, idx, draw]);
  const dragging = useRef(false);
  const seek = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    onSeek((e.clientX - r.left) / r.width);
  };
  return (
    <div className="chart" ref={wrap}>
      <canvas
        ref={cv}
        style={{ width: w, height: h, cursor: 'ew-resize' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          seek(e);
        }}
        onPointerMove={(e) => dragging.current && seek(e)}
        onPointerUp={() => (dragging.current = false)}
      />
    </div>
  );
}

export function CoolingDock() {
  usePlayback();
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const setIdx = useStore((s) => s.setIdx);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const n = trace.samples.length;
  const cur = trace.samples[Math.min(n - 1, Math.round(idx))];
  const curEvent = (() => {
    let k = -1;
    trace.events.forEach((e, i) => {
      if (e.index <= Math.round(idx)) k = i;
    });
    return k;
  })();
  const seekT = (frac: number) => {
    const t = Math.min(1, Math.max(0, frac)) * trace.tEnd;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (trace.samples[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    setIdx(lo);
  };
  const jump = (dir: 1 | -1) => {
    const evs = trace.events.filter((e) => e.kind !== 'end').map((e) => e.index);
    const r = Math.round(idx);
    if (dir === 1) setIdx(evs.find((i) => i > r + 0) ?? n - 1);
    else setIdx([...evs].reverse().find((i) => i < r - 0) ?? 0);
  };
  return (
    <div className="dock">
      <div className="dock-left">
        <div className="transport">
          <button className="ico" title="回到起点（全液相）" onClick={() => { setPlaying(false); setIdx(0); }}>⏮</button>
          <button className="ico" title="上一事件" onClick={() => { setPlaying(false); jump(-1); }}>⏪</button>
          <button className="ico play" title={playing ? '暂停' : '播放冷却过程'} onClick={() => { if (!playing && idx >= n - 1) setIdx(0); setPlaying(!playing); }}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="ico" title="下一事件" onClick={() => { setPlaying(false); jump(1); }}>⏩</button>
          <Segmented size="sm" value={speed} onChange={setSpeed} options={[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]} />
          <span className="grow" />
          <span className="badge mono">{cel(cur.T, 1)}</span>
        </div>
        <ol className="events">
          {trace.events.map((e, i) => (
            <li key={i} className={`${i === curEvent ? 'cur' : ''} ${e.plateau ? 'plateau' : ''}`} onClick={() => { setPlaying(false); setIdx(e.index); }}>
              <span className="en">{i + 1}</span>
              <div>
                <div className="et">
                  <b className="mono">{cel(e.T)}</b> {e.title}
                  {e.plateau && <em>恒温平台</em>}
                </div>
                {i === curEvent && <div className="ed">{e.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <ChartCanvas draw={drawCurve} onSeek={seekT} />
      <ChartCanvas draw={drawFractions} onSeek={seekT} />
    </div>
  );
}
