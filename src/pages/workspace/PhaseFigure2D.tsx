import { useEffect, useMemo, useRef, useState } from 'react';
import { drawIso, drawProjection, THEME_LIGHT, triLayout, type TriLayout } from '../../core/canvasDraw';
import { cel, phaseColor, solidColor } from '../../core/colors';
import { computeIso } from '../../core/sections';
import type { Comp, Equilibrium } from '../../core/types';
import { analyzeCurveAt } from '../../math/curves';
import { curveAtPoint, type PointAnalysis } from '../../math/pointAnalysis';
import { parametrize } from '../../math/spaces';
import { useStore } from '../../state/store';
import { useSize } from '../../ui/useSize';
import { COLOR } from '../../ui/tokens';

/**
 * 交互式二维相图（"移动一个点，同时理解几何、数学与物理"）。
 *   · 底图（画布）：等温截面（随 T）或液相面投影；只在 T / 视图 / 体系变化时重绘；
 *   · 叠加层（SVG）：x₀、读数线、成分向量、平衡相与连结线 / 三角形、杠杆臂、梯度、界线标架、轨迹；
 *   · 交互：单击不变点 / 界线 → 选中并分析；其余位置在"成分探索"模式下设定 / 拖动 x₀，
 *     在"冷却凝固"模式下 x₀ 固定（只显示液相成分随温度的演化）。
 */

const LIQ = COLOR.phase.liquid;
const X0C = COLOR.stateX0;

export function PhaseFigure2D({ an, trail }: { an: PointAnalysis | null; trail: Comp[] }) {
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const x0 = useStore((s) => s.x0);
  const eq = useStore((s) => s.eq);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view2d);
  const ov = useStore((s) => s.overlays);
  const sel = useStore((s) => s.selection);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const setX0 = useStore((s) => s.setX0);
  const setSel = useStore((s) => s.setSel);
  const flash = useStore((s) => s.flash);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const { w, h, dpr } = useSize(wrap);
  const fontPx = Math.max(10, Math.min(13, w / 34));
  const pad = Math.max(30, fontPx * 2.6);
  const L: TriLayout = useMemo(() => triLayout(w, h, pad), [w, h, pad]);
  const sec = useMemo(() => (view === 'iso' ? computeIso(d, T) : null), [view, d, T]);
  const selCurve = sel?.kind === 'curve' ? sel.id : null;
  const selInv = sel?.kind === 'invariant' ? sel.id : null;

  // ---------------------------------------------------------------- 底图
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    if (view === 'iso' && sec) drawIso(ctx, w, h, sec, d, THEME_LIGHT, { pad, grid: true, ticks: true, labels: true, ties: true, fontPx });
    else
      drawProjection(ctx, w, h, d, THEME_LIGHT, { pad, fontPx, isoStep: 50, isotherms: true, boundaries: true, arrows: true, invariants: true, alkemade: !d.sol, fillMode: 'field', dpr }, {
        x0,
        spec: null,
        trace: null,
        idx: 0,
        selectedCurve: selCurve,
        selectedInv: selInv,
        noState: true,
      });
    // 底图不画 x₀（由 SVG 叠加层绘制），因此拖动 x₀ 时无需重绘
  }, [view, sec, d, w, h, dpr, pad, fontPx, selCurve, selInv]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- 交互
  const drag = useRef(false);
  const [tip, setTip] = useState<{ X: number; Y: number; x: Comp; key: string; Tl: number } | null>(null);
  const tipHint = useRef<Equilibrium | null>(null);
  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const clampC = (x: Comp): Comp => {
    const a = Math.max(0, x[0]);
    const b = Math.max(0, x[1]);
    const c = Math.max(0, x[2]);
    const s = a + b + c || 1;
    return [a / s, b / s, c / s];
  };
  const pick = (X: number, Y: number): boolean => {
    for (const iv of d.topo.invariants) {
      const p = L.px(iv.x);
      if (Math.hypot(p[0] - X, p[1] - Y) < 9) {
        setSel({ kind: 'invariant', id: iv.id });
        return true;
      }
    }
    const x = L.inv(X, Y);
    const hit = curveAtPoint(d, clampC(x), 6 / L.S);
    if (hit) {
      setSel({ kind: 'curve', id: hit.cv.id, s: hit.s });
      return true;
    }
    return false;
  };
  const onDown = (e: React.PointerEvent) => {
    const [X, Y] = local(e);
    const x = L.inv(X, Y);
    if (x.some((v) => v < -0.01)) return;
    if (pick(X, Y)) return;
    if (mode === 'cooling') {
      flash('冷却凝固模式：总成分 x₀ 固定。单击界线 / 不变点可查看分析；要改变成分请切换到"成分探索"。');
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = true;
    setX0(clampC(x));
  };
  const onMove = (e: React.PointerEvent) => {
    const [X, Y] = local(e);
    const x = L.inv(X, Y);
    if (drag.current && mode === 'composition') setX0(clampC(x));
    if (x.every((v) => v > -0.002)) {
      const c = clampC(x);
      const eh = d.equilibrium(c, T, tipHint.current);
      tipHint.current = eh;
      setTip({ X, Y, x: c, key: eh.key, Tl: d.liquidus(c).T });
    } else setTip(null);
  };

  // ---------------------------------------------------------------- 叠加层
  const P = (x: Comp) => L.px(x);
  const p0 = P(x0);
  const sym = d.params.components.map((c) => c.symbol);
  const S = L.S;
  const arrow = (from: [number, number], vCart: [number, number], len: number, color: string, label?: string, key?: string) => {
    const n = Math.hypot(vCart[0], vCart[1]) || 1;
    const to: [number, number] = [from[0] + (vCart[0] / n) * len, from[1] - (vCart[1] / n) * len];
    return <Arrow key={key ?? label} from={from} to={to} color={color} label={label} />;
  };
  const curSample = trace.samples[Math.min(trace.samples.length - 1, Math.round(idx))];
  const liqNow = eq.phases.find((p) => p.si < 0);

  const overlays: JSX.Element[] = [];
  // 读数线：过 x₀ 的等含量线（平行于对边）
  if (ov.read)
    [0, 1, 2].forEach((i) => {
      const j = (i + 1) % 3;
      const k = (i + 2) % 3;
      const a: Comp = [0, 0, 0];
      const b: Comp = [0, 0, 0];
      a[i] = x0[i];
      a[j] = 1 - x0[i];
      b[i] = x0[i];
      b[k] = 1 - x0[i];
      const pa = P(a);
      const pb = P(b);
      overlays.push(
        <g key={`rd${i}`}>
          <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke={solidColor(i)} strokeWidth={0.9} strokeDasharray="4 3" opacity={0.85} />
          <text x={pb[0]} y={pb[1]} dx={i === 0 ? -4 : 4} dy={i === 2 ? -4 : 12} className="f2-small" fill={solidColor(i)} textAnchor={i === 0 ? 'end' : 'start'}>
            x_{sym[i]} = {x0[i].toFixed(3)}
          </text>
        </g>,
      );
    });
  // 成分向量分解（以 A 为原点）
  if (ov.vec) {
    const A = P([1, 0, 0]);
    const mid = P([1 - x0[1], x0[1], 0]);
    overlays.push(<Arrow key="vecB" from={A} to={mid} color={COLOR.component[1]} label={`x_${sym[1]}(${sym[1]}−${sym[0]})`} />);
    overlays.push(<Arrow key="vecC" from={mid} to={p0} color={COLOR.component[2]} label={`x_${sym[2]}(${sym[2]}−${sym[0]})`} />);
  }
  // 液相轨迹
  if (ov.path && trace.liquidPath.length > 1) {
    const all = trace.liquidPath.map((q) => P(q.x).join(',')).join(' ');
    const done = trace.liquidPath.filter((q) => q.t <= (curSample?.t ?? 0) + 1e-9);
    overlays.push(<polyline key="pathAll" points={all} fill="none" stroke="#7E2F8E" strokeWidth={1.4} strokeDasharray="5 4" opacity={mode === 'cooling' ? 0.55 : 0.35} />);
    if (mode === 'cooling' && done.length > 1)
      overlays.push(<polyline key="pathDone" points={done.map((q) => P(q.x).join(',')).join(' ')} fill="none" stroke="#7E2F8E" strokeWidth={2.6} />);
  }
  // x₀ 轨迹（成分探索）
  if (ov.trail && mode === 'composition' && trail.length > 1) {
    overlays.push(<polyline key="trail" points={trail.map((x) => P(x).join(',')).join(' ')} fill="none" stroke={X0C} strokeWidth={1} opacity={0.45} />);
    const prev = trail[trail.length - 2];
    const pp = P(prev);
    if (Math.hypot(pp[0] - p0[0], pp[1] - p0[1]) > 3) overlays.push(<Arrow key="dx" from={pp} to={p0} color={X0C} label="Δx₀" />);
  }
  // 平衡相：连结线 / 三角形、杠杆臂
  if (ov.eq && eq.phases.length >= 2) {
    const pts = eq.phases.map((p) => P(p.x));
    if (pts.length === 2) overlays.push(<line key="tie" x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} stroke="#1d2229" strokeWidth={1.8} />);
    else overlays.push(<polygon key="tri" points={pts.map((p) => p.join(',')).join(' ')} fill="rgba(0,114,189,0.08)" stroke="#1d2229" strokeWidth={1.6} />);
    eq.phases.forEach((p, k) => {
      const q = pts[k];
      const col = p.si < 0 ? LIQ : phaseColor(d, p.id);
      overlays.push(
        <g key={`ph${k}`}>
          <line x1={p0[0]} y1={p0[1]} x2={q[0]} y2={q[1]} stroke={col} strokeWidth={1} strokeDasharray="2 2" />
          <rect x={q[0] - 4.5} y={q[1] - 4.5} width={9} height={9} fill={col} stroke="#1d2229" strokeWidth={0.8} transform={p.si < 0 ? `rotate(45 ${q[0]} ${q[1]})` : undefined} />
          <text x={q[0] + 7} y={q[1] - 6} className="f2-lab" fill={col}>
            {p.id} {(p.frac * 100).toFixed(1)}%
          </text>
        </g>,
      );
    });
  }
  // 梯度与等温线切向（在 x₀）
  if (ov.grad && an) {
    for (const v of an.vectors.filter((q) => q.label === '−∇T_liq' || q.label === 't_iso')) {
      overlays.push(arrow(p0, v.v, 46, v.label === '−∇T_liq' ? '#D95319' : '#7b8490', v.label, `g${v.label}`));
    }
  }
  // 界线标架（液相点在界线上时）与液相移动方向
  if (ov.frame && an) {
    for (const v of an.vectors.filter((q) => q.label.startsWith('t（') || q.label.startsWith('n（') || q.label.startsWith('dx_L'))) {
      overlays.push(arrow(P(v.at), v.v, 42, v.label.startsWith('n') ? '#77AC30' : '#7E2F8E', v.label.split('（')[0], `f${v.label}`));
    }
  }
  // 选中界线：该点的切向、法向与切线规则交点
  if (sel?.kind === 'curve') {
    const cvSel = d.topo.curves.find((c) => c.id === sel.id);
    if (cvSel) {
      const cp = parametrize(cvSel);
      const s = Math.min(cp.length, Math.max(0, sel.s ?? cp.length / 2));
      const a2 = analyzeCurveAt(d, cvSel, s);
      const q = P(a2.frame.x);
      overlays.push(<polyline key="selcv" points={cvSel.pts.map((x) => P(x).join(',')).join(' ')} fill="none" stroke="#EDB120" strokeWidth={5} opacity={0.55} />);
      overlays.push(arrow(q, a2.frame.tCool, 50, '#7E2F8E', 't', 'selt'));
      overlays.push(arrow(q, [-a2.frame.tCool[1], a2.frame.tCool[0]], 36, '#77AC30', 'n', 'seln'));
      const A = P(a2.ya);
      const B = P(a2.yb);
      overlays.push(<line key="seljoin" x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={COLOR.accent} strokeWidth={1.4} />);
      if (a2.ti.point) {
        const X = P(a2.ti.point);
        overlays.push(<line key="selext" x1={q[0]} y1={q[1]} x2={X[0]} y2={X[1]} stroke="#7E2F8E" strokeWidth={1} strokeDasharray="5 3" />);
        overlays.push(<circle key="selx" cx={X[0]} cy={X[1]} r={4.5} fill={a2.ti.kind === 'eutectic' ? '#77AC30' : '#C00000'} stroke="#1d2229" />);
        overlays.push(
          <text key="selxl" x={X[0] + 6} y={X[1] + 13} className="f2-lab">
            x*（λ = {a2.ti.lambda.toFixed(3)}）
          </text>,
        );
      }
      overlays.push(<circle key="selp" cx={q[0]} cy={q[1]} r={4} fill="#EDB120" stroke="#1d2229" />);
    }
  }
  // 选中不变点：其连结（四相）三角形
  if (sel?.kind === 'invariant') {
    const iv = d.topo.invariants.find((v) => v.id === sel.id);
    if (iv) {
      const tri = iv.solidX.map((c) => P(c));
      const pl = P(iv.x);
      overlays.push(<polygon key="ivtri" points={tri.map((p) => p.join(',')).join(' ')} fill="rgba(237,177,32,0.18)" stroke="#D95319" strokeWidth={1.6} />);
      tri.forEach((p, k) => overlays.push(<line key={`ivl${k}`} x1={pl[0]} y1={pl[1]} x2={p[0]} y2={p[1]} stroke="#D95319" strokeDasharray="3 2" />));
      overlays.push(<circle key="ivc" cx={pl[0]} cy={pl[1]} r={8} fill="none" stroke="#D95319" strokeWidth={2} />);
    }
  }
  // 相邻相区方向探测
  if (ov.nbr && an)
    for (const nb of an.neighbors) {
      const len = Math.min(70, nb.dist * S);
      const to: [number, number] = [p0[0] + Math.cos(nb.dir) * len, p0[1] - Math.sin(nb.dir) * len];
      overlays.push(
        <g key={`nb${nb.dir}`}>
          <line x1={p0[0]} y1={p0[1]} x2={to[0]} y2={to[1]} stroke="#4DBEEE" strokeWidth={1} />
          <text x={to[0]} y={to[1]} className="f2-small" fill="#1f4e79">
            {nb.key}
          </text>
        </g>,
      );
    }

  // 当前液相点（冷却模式强调：移动的是液相，不是 x₀）
  const liqMark = liqNow && eq.phases.length > 1 ? P(liqNow.x) : null;

  return (
    <div className="f2" ref={wrap}>
      <canvas ref={cv} style={{ width: w, height: h }} />
      <svg width={w} height={h} className="f2-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = false)} onPointerLeave={() => setTip(null)} style={{ cursor: mode === 'composition' ? 'crosshair' : 'default' }}>
        <defs>
          {[...new Set([COLOR.stateX0, COLOR.accent, COLOR.component[2], COLOR.component[0], COLOR.muted, COLOR.compound[1], COLOR.compound[2], COLOR.phase.liquid, COLOR.component[1]])].map((c) => (
            <marker key={c} id={`ah${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {overlays}
        {liqMark && (
          <g>
            <circle cx={liqMark[0]} cy={liqMark[1]} r={6} fill={LIQ} stroke="#fff" strokeWidth={1.5} />
            <text x={liqMark[0] + 8} y={liqMark[1] + 14} className="f2-lab" fill={LIQ}>
              x_L
            </text>
          </g>
        )}
        <g>
          <circle cx={p0[0]} cy={p0[1]} r={7.5} fill="none" stroke={X0C} strokeWidth={2} />
          <line x1={p0[0] - 12} y1={p0[1]} x2={p0[0] + 12} y2={p0[1]} stroke={X0C} strokeWidth={1.2} />
          <line x1={p0[0]} y1={p0[1] - 12} x2={p0[0]} y2={p0[1] + 12} stroke={X0C} strokeWidth={1.2} />
          <text x={p0[0] + 10} y={p0[1] - 10} className="f2-lab" fill={X0C}>
            x₀{mode === 'cooling' ? '（固定）' : ''}
          </text>
        </g>
        {tip && (
          <g transform={`translate(${Math.min(w - 170, tip.X + 14)} ${Math.min(h - 62, tip.Y + 14)})`} pointerEvents="none">
            <rect width={160} height={52} className="f2-tip" />
            <text x={6} y={14} className="f2-tiptxt">
              {sym.map((s2, i) => `${s2} ${(tip.x[i] * 100).toFixed(1)}`).join('  ')}
            </text>
            <text x={6} y={29} className="f2-tiptxt">
              {view === 'iso' ? `T = ${cel(T, 1)}：${tip.key}` : `液相线 ${cel(tip.Tl, 1)}`}
            </text>
            <text x={6} y={44} className="f2-tiptxt dim">
              {view === 'iso' ? `液相线 ${cel(tip.Tl, 1)}` : `当前 T：${tip.key}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Arrow({ from, to, color, label }: { from: [number, number]; to: [number, number]; color: string; label?: string }) {
  const id = `ah${color.slice(1)}`;
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={1.8} markerEnd={`url(#${id})`} />
      {label && (
        <text x={to[0] + 4} y={to[1] - 4} className="f2-lab" fill={color}>
          {label}
        </text>
      )}
    </g>
  );
}
