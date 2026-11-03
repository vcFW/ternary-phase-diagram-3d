import { useEffect, useMemo, useRef, useState } from 'react';
import { drawIso, drawStatePoint, THEME_LIGHT, triLayout } from '../core/canvasDraw';
import { regionName, cel } from '../core/colors';
import { computeIso } from '../core/sections';
import { currentSpec, useStore } from '../state/store';
import { Segmented } from '../ui/controls';
import { useSize } from '../ui/useSize';
import type { Comp } from '../core/types';

export function IsoView() {
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const x0 = useStore((s) => s.x0);
  const sel = useStore((s) => s.selection);
  const vertOn = useStore((s) => s.vertOn);
  const section = useStore((s) => s.section);
  const setX0 = useStore((s) => s.setX0);
  const setSel = useStore((s) => s.setSel);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w, h, dpr } = useSize(wrap);
  const [mode, setMode] = useState<'pick' | 'region'>('pick');
  const [hover, setHover] = useState<{ x: Comp; key: string } | null>(null);
  const sec = useMemo(() => computeIso(d, T), [d, T]);
  const hi = sel?.kind === 'region' ? sel.key : null;

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fontPx = Math.max(10, Math.min(14, w / 30));
    const L = drawIso(ctx, w, h, sec, d, THEME_LIGHT, { pad: Math.max(26, fontPx * 2.4), grid: true, ticks: true, labels: true, ties: true, fontPx, highlight: hi });
    if (vertOn) {
      const spec = currentSpec(useStore.getState());
      const a = L.px(spec.p1);
      const b = L.px(spec.p2);
      ctx.strokeStyle = '#1f4e79';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawStatePoint(ctx, L.px(x0), fontPx, THEME_LIGHT);
  }, [sec, d, w, h, dpr, x0, hi, vertOn, section]);

  const toComp = (e: React.PointerEvent): Comp | null => {
    const r = cv.current!.getBoundingClientRect();
    const fontPx = Math.max(10, Math.min(14, w / 30));
    const L = triLayout(w, h, Math.max(26, fontPx * 2.4));
    const x = L.inv(e.clientX - r.left, e.clientY - r.top);
    if (x[0] < -0.01 || x[1] < -0.01 || x[2] < -0.01) return null;
    return [Math.max(0, x[0]), Math.max(0, x[1]), Math.max(0, x[2])];
  };
  const drag = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    const x = toComp(e);
    if (!x) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (mode === 'region') {
      setSel({ kind: 'region', key: d.equilibrium(x, T).key });
      return;
    }
    drag.current = true;
    setX0(x);
  };
  const onMove = (e: React.PointerEvent) => {
    const x = toComp(e);
    if (drag.current && x) setX0(x);
    setHover(x ? { x, key: d.equilibrium(x, T).key } : null);
  };
  const pct = (v: number) => (v * 100).toFixed(1);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <div className="view">
      <div className="view-tools">
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'pick', label: '单击/拖动设成分' }, { value: 'region', label: '单击选相区' }]} />
        <span className="grow" />
        <span className="badge">T = {cel(T)}</span>
      </div>
      <div className="view-canvas" ref={wrap}>
        <canvas ref={cv} style={{ width: w, height: h, cursor: 'crosshair' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = false)} onPointerLeave={() => setHover(null)} />
      </div>
      <div className="view-foot">
        {hover ? (
          <>
            <span className="mono">
              {sym[0]} {pct(hover.x[0])} · {sym[1]} {pct(hover.x[1])} · {sym[2]} {pct(hover.x[2])} %
            </span>
            <span>{regionName(hover.key)}</span>
          </>
        ) : (
          <span className="dim">等温截面 · 白色曲线为该温度的液相饱和线；虚线为连结线；悬停查询相区</span>
        )}
      </div>
    </div>
  );
}
