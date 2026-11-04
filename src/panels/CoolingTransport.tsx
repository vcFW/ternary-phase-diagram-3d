import { useEffect } from 'react';
import { cel } from '../core/colors';
import { useStore } from '../state/store';
import { Segmented } from '../ui/controls';

/** 播放循环：按样本下标推进；不变反应平台内放慢，便于观察反应进程。（只在 CoolingTransport 内调用一次） */
function usePlayback() {
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

/**
 * 冷却时间轴：全站唯一的冷却播放控件（工作台底部与凝固路径页共用同一组件、同一状态）。
 * 播放 / 单步到事件 / 进度 / 速度 / 事件刻度。
 */
export function CoolingTransport() {
  usePlayback();
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const setIdx = useStore((s) => s.setIdx);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const xi = useStore((s) => s.xi);
  const n = trace.samples.length;
  const r = Math.min(n - 1, Math.round(idx));
  const cur = trace.samples[r];
  const events = trace.events.filter((e) => e.kind !== 'end');
  let curEvent = -1;
  events.forEach((e, i) => {
    if (e.index <= r) curEvent = i;
  });
  const jump = (dir: 1 | -1) => {
    setPlaying(false);
    const idxs = events.map((e) => e.index);
    if (dir === 1) setIdx(idxs.find((i) => i > r) ?? n - 1);
    else setIdx([...idxs].reverse().find((i) => i < r) ?? 0);
  };
  const ev = curEvent >= 0 ? events[curEvent] : null;
  return (
    <div className="ct" role="group" aria-label="冷却时间轴">
      <div className="ct-btns">
        <button className="ico" title="回到起点（全液相）" onClick={() => { setPlaying(false); setIdx(0); }}>⏮</button>
        <button className="ico" title="上一事件" onClick={() => jump(-1)}>⏪</button>
        <button className="ico play" title={playing ? '暂停' : '播放冷却过程'} onClick={() => { if (!playing && idx >= n - 1) setIdx(0); setPlaying(!playing); }}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className="ico" title="下一事件" onClick={() => jump(1)}>⏩</button>
      </div>
      <div className="ct-track">
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={r}
          aria-label="冷却进度"
          style={{ ['--p' as string]: `${(r / Math.max(1, n - 1)) * 100}%` } as React.CSSProperties}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
        />
        <div className="ct-ticks">
          {events.map((e, i) => (
            <button
              key={i}
              className={`ct-tick ${e.plateau ? 'plateau' : ''} ${i === curEvent ? 'cur' : ''}`}
              style={{ left: `${(e.index / Math.max(1, n - 1)) * 100}%` }}
              title={`${cel(e.T)} · ${e.title}${e.plateau ? '（恒温平台）' : ''}`}
              onClick={() => { setPlaying(false); setIdx(e.index); }}
            />
          ))}
        </div>
      </div>
      <Segmented size="sm" value={speed} onChange={setSpeed} options={[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]} />
      <span className="ct-T mono">{cel(cur.T, 1)}{xi >= 0 ? ` · ξ ${(xi * 100).toFixed(0)}%` : ''}</span>
      <span className="ct-ev" title={ev?.detail}>{ev ? `${ev.title}${ev.plateau ? '（恒温平台）' : ''}` : '液相冷却'}</span>
    </div>
  );
}
