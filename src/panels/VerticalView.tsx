import { useEffect, useMemo, useRef, useState } from 'react';
import { drawVertical, haloText, THEME_LIGHT, vLayout, type VLayout } from '../core/canvasDraw';
import { cel, regionName, toC } from '../core/colors';
import { endLabel } from '../core/sections';
import { lerpComp, type VerticalRaster } from '../core/vertical';
import { toXY } from '../core/barycentric';
import { useWorkerFor } from '../compute/client';
import { verticalOf } from '../state/asyncCompute';
import { currentSpec, useStore } from '../state/store';
import { useSize } from '../ui/useSize';
import type { Comp } from '../core/types';
import { COLOR } from '../ui/tokens';

const MARGIN = { l: 44, r: 12, t: 10, b: 26 };

export function VerticalView() {
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const x0 = useStore((s) => s.x0);
  const vertOn = useStore((s) => s.vertOn);
  const coolingMode = useStore((s) => s.mode === 'cooling');
  const section = useStore((s) => s.section);
  const setX0 = useStore((s) => s.setX0);
  const setT = useStore((s) => s.setT);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w, h, dpr } = useSize(wrap);
  const spec = useMemo(() => currentSpec(useStore.getState()), [section, d, x0]); // eslint-disable-line react-hooks/exhaustive-deps
  const range = useMemo(() => d.tRange(), [d]);
  const [ras, setRas] = useState<VerticalRaster | null>(null);
  const layRef = useRef<VLayout | null>(null);
  const [hover, setHover] = useState<{ u: number; T: number; key: string; x: Comp } | null>(null);
  const specKey = spec.p1.map((v) => v.toFixed(5)).join() + '|' + spec.p2.map((v) => v.toFixed(5)).join();

  // 渐进式栅格：先低分辨率立即出图，空闲后补全
  const asyncTick = useStore((s) => s.asyncTick);
  useEffect(() => {
    const pw = Math.max(40, Math.floor((w - MARGIN.l - MARGIN.r) * dpr));
    const ph = Math.max(40, Math.floor((h - MARGIN.t - MARGIN.b) * dpr));
    if (useWorkerFor(d.params)) {
      // 固溶体体系：Worker 中先粗后精，结果到达（asyncTick）后重新取用缓存
      const { ras: r } = verticalOf(d, spec, pw, ph, range.Tmin, range.Tmax);
      if (r) setRas(r);
      return;
    }
    setRas(verticalOf(d, spec, Math.max(40, pw >> 2), Math.max(30, ph >> 2), range.Tmin, range.Tmax).ras);
    const id = window.setTimeout(() => setRas(verticalOf(d, spec, pw, ph, range.Tmin, range.Tmax).ras), 140);
    return () => window.clearTimeout(id);
  }, [d, specKey, w, h, dpr, range, asyncTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = cv.current;
    if (!c || !ras) return;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const f = Math.max(10, Math.min(13, w / 34));
    const lay = drawVertical(ctx, w, h, ras, d, spec, THEME_LIGHT, {
      margin: MARGIN,
      fontPx: f,
      labels: true,
      axes: true,
      endNames: [endLabel(spec.p1, d), endLabel(spec.p2, d)],
    });
    layRef.current = lay;
    // 当前温度线
    const Y = lay.TToY(T);
    ctx.strokeStyle = COLOR.accent;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(lay.x, Y);
    ctx.lineTo(lay.x + lay.w, Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = `600 ${f}px system-ui, sans-serif`;
    haloText(ctx, cel(T), lay.x + 6, Y - 3, THEME_LIGHT, COLOR.accent);
    // 状态点在截面上的投影
    const P = toXY(spec.p1);
    const Q = toXY(spec.p2);
    const X = toXY(x0);
    const dx = Q[0] - P[0];
    const dy = Q[1] - P[1];
    const u = ((X[0] - P[0]) * dx + (X[1] - P[1]) * dy) / (dx * dx + dy * dy || 1);
    const foot = [P[0] + u * dx, P[1] + u * dy];
    const off = Math.hypot(X[0] - foot[0], X[1] - foot[1]);
    const px = lay.uToX(Math.min(1, Math.max(0, u)));
    ctx.strokeStyle = COLOR.ink;
    ctx.fillStyle = off < 2e-3 ? COLOR.stateX0 : 'rgba(192,0,0,0)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, Y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (off >= 2e-3) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, Y - 14);
      ctx.lineTo(px, Y + 14);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [ras, T, x0, w, h, dpr, d, spec]);

  const drag = useRef<'none' | 'both' | 'T'>('none');
  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const apply = (X: number, Y: number, mode: 'both' | 'T') => {
    const lay = layRef.current;
    if (!lay) return;
    const t = lay.yToT(Math.min(lay.y + lay.h, Math.max(lay.y, Y)));
    // 冷却模式下 x₀ 固定：只改温度
    if (mode === 'T' || useStore.getState().mode === 'cooling') setT(t);
    else {
      const u = Math.min(1, Math.max(0, lay.xToU(X)));
      const x = lerpComp(spec.p1, spec.p2, u);
      useStore.setState({ T: t });
      setX0(x);
      setT(t);
    }
  };
  const onDown = (e: React.PointerEvent) => {
    const lay = layRef.current;
    if (!lay) return;
    const [X, Y] = pos(e);
    if (X < lay.x || X > lay.x + lay.w || Y < lay.y || Y > lay.y + lay.h) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const near = Math.abs(Y - lay.TToY(useStore.getState().T)) < 7 && e.shiftKey === false;
    drag.current = near ? 'T' : 'both';
    apply(X, Y, drag.current === 'T' ? 'T' : 'both');
  };
  const onMove = (e: React.PointerEvent) => {
    const lay = layRef.current;
    if (!lay) return;
    const [X, Y] = pos(e);
    if (drag.current !== 'none') apply(X, Y, drag.current);
    if (X >= lay.x && X <= lay.x + lay.w && Y >= lay.y && Y <= lay.y + lay.h) {
      const u = lay.xToU(X);
      const t = lay.yToT(Y);
      const x = lerpComp(spec.p1, spec.p2, u);
      setHover({ u, T: t, key: d.equilibrium(x, t).key, x });
    } else setHover(null);
  };
  void vLayout;
  const sym = d.params.components.map((c) => c.symbol);
  const pct = (v: number) => (v * 100).toFixed(1);
  return (
    <div className="view">
      <div className="view-tools">
        <span className="dim small">{coolingMode ? '冷却模式：x₀ 固定，单击/拖动只改变温度' : '单击/拖动设定状态点（成分 + 温度）；拖动青色虚线仅调温度'}</span>
        <span className="grow" />
        {!vertOn && <span className="badge warn">三维截面平面已隐藏</span>}
      </div>
      <div className="view-canvas" ref={wrap}>
        <canvas ref={cv} style={{ width: w, height: h, cursor: 'crosshair' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = 'none')} onPointerLeave={() => setHover(null)} />
      </div>
      <div className="view-foot">
        {hover ? (
          <>
            <span className="mono">
              {sym[0]} {pct(hover.x[0])} · {sym[1]} {pct(hover.x[1])} · {sym[2]} {pct(hover.x[2])} % ，{cel(hover.T)}
            </span>
            <span>{regionName(hover.key)}</span>
          </>
        ) : (
          <span className="dim">垂直截面（{endLabel(spec.p1, d)} → {endLabel(spec.p2, d)}）· 白线为液相线 · 温度范围 {toC(range.Tmin).toFixed(0)}–{toC(range.Tmax).toFixed(0)} °C</span>
        )}
      </div>
    </div>
  );
}
