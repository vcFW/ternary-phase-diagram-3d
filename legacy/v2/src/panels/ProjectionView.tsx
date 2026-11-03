import { useEffect, useRef, useState } from 'react';
import { drawProjection, THEME_LIGHT, triLayout } from '../core/canvasDraw';
import { currentSpec, useStore } from '../state/store';
import { Segmented, Toggle } from '../ui/controls';
import { useSize } from '../ui/useSize';
import { cel } from '../core/colors';
import type { Comp } from '../core/types';
import { liquidusInfo } from './helpers';

export function ProjectionView() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const vertOn = useStore((s) => s.vertOn);
  const section = useStore((s) => s.section);
  const sel = useStore((s) => s.selection);
  const setX0 = useStore((s) => s.setX0);
  const setSel = useStore((s) => s.setSel);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w, h, dpr } = useSize(wrap);
  const [iso, setIso] = useState(true);
  const [alk, setAlk] = useState(true);
  const [fill, setFill] = useState<'field' | 'temperature'>('field');
  const [hover, setHover] = useState<string | null>(null);
  const pad = Math.max(26, Math.min(14, w / 30) * 2.4);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext('2d')!;
    const f = Math.max(10, Math.min(14, w / 30));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 栅格底图在设备像素尺度生成，叠加层在 CSS 像素尺度绘制
    ctx.scale(dpr, dpr);
    drawProjection(ctx, w, h, d, THEME_LIGHT, { pad, fontPx: f, isoStep: 50, isotherms: iso, boundaries: true, arrows: true, invariants: true, alkemade: alk, fillMode: fill, dpr }, {
      x0,
      spec: vertOn ? currentSpec(useStore.getState()) : null,
      trace,
      idx,
      selectedCurve: sel?.kind === 'curve' ? sel.id : null,
      selectedInv: sel?.kind === 'invariant' ? sel.id : null,
    });
  }, [d, w, h, dpr, x0, trace, idx, iso, alk, fill, vertOn, section, sel, pad]);

  const toPt = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const drag = useRef(false);
  const pick = (X: number, Y: number): boolean => {
    const L = triLayout(w, h, pad);
    // 先判不变点、界线
    for (const iv of d.topo.invariants) {
      const p = L.px(iv.x);
      if (Math.hypot(p[0] - X, p[1] - Y) < 10) {
        setSel({ kind: 'invariant', id: iv.id });
        useStore.getState().setTab('info');
        return true;
      }
    }
    for (const cv2 of d.topo.curves) {
      for (let k = 0; k < cv2.pts.length - 1; k += 1) {
        const a = L.px(cv2.pts[k]);
        const b = L.px(cv2.pts[k + 1]);
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((X - a[0]) * dx + (Y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(a[0] + t * dx - X, a[1] + t * dy - Y) < 5) {
          setSel({ kind: 'curve', id: cv2.id });
          useStore.getState().setTab('info');
          return true;
        }
      }
    }
    return false;
  };
  const onDown = (e: React.PointerEvent) => {
    const [X, Y] = toPt(e);
    if (pick(X, Y)) return;
    const L = triLayout(w, h, pad);
    const x = L.inv(X, Y);
    if (x.some((v) => v < -0.01)) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = true;
    setX0([Math.max(0, x[0]), Math.max(0, x[1]), Math.max(0, x[2])] as Comp, false);
  };
  const onMove = (e: React.PointerEvent) => {
    const [X, Y] = toPt(e);
    const L = triLayout(w, h, pad);
    const x = L.inv(X, Y);
    const inside = x.every((v) => v > -0.001);
    if (drag.current && inside) setX0([Math.max(0, x[0]), Math.max(0, x[1]), Math.max(0, x[2])] as Comp, false);
    if (inside) {
      const info = liquidusInfo(d, [Math.max(0, x[0]), Math.max(0, x[1]), Math.max(0, x[2])]);
      setHover(`${info.phase} 初晶面 · 液相线 ${cel(info.T)}`);
    } else setHover(null);
  };
  return (
    <div className="view">
      <div className="view-tools">
        <Segmented size="sm" value={fill} onChange={setFill} options={[{ value: 'field', label: '初晶区' }, { value: 'temperature', label: '温度色图' }]} />
        <Toggle checked={iso} onChange={setIso} label="等温线" />
        <Toggle checked={alk} onChange={setAlk} label="相容三角形" hint="Alkemade 线（副三角形划分）" />
      </div>
      <div className="view-canvas" ref={wrap}>
        <canvas ref={cv} style={{ width: w, height: h, cursor: 'crosshair' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = false)} onPointerLeave={() => setHover(null)} />
      </div>
      <div className="view-foot">
        {hover ? <span>{hover}</span> : <span className="dim">液相面投影 · 单击界线/不变点查看说明；单击空白处设定成分（温度自动取液相线下 40 K）</span>}
      </div>
      <div className="legend-row">
        <span><i className="ln" style={{ background: '#1d2229' }} />共晶线（单箭头）</span>
        <span><i className="ln" style={{ background: '#c00000' }} />转熔线（双箭头）</span>
        <span><i className="dia" />温度极值点</span>
        <span><i className="ln dashed" />Alkemade 线</span>
      </div>
    </div>
  );
}
