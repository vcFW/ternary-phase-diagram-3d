import { toXY } from '../core/barycentric';
import type { Trace, TraceEvent } from '../core/cooling';
import type { PhaseDiagram } from '../core/diagram';
import type { BoundaryCurve, Comp, Equilibrium } from '../core/types';
import { analyzeCurveAt, gibbsDuhemOfEq, type CurveAnalysis, type GibbsDuhem } from './curves';
import { minimizeGibbs, planeAt, type GMinResult } from './gibbsMin';
import { phaseFractions, type LeverResult } from './lever';
import { phaseRule } from './phaseRule';
import { inverse, type Mat } from './linalg';
import { liquidusGradient, parametrize } from './spaces';

/**
 * "移动一个点，同时理解几何、数学与物理"：对 (x₀, T) 的完整分析。
 * 全部为确定性计算；每一项都带有来源（数学推导 / 模型计算 / 无法确定）。
 */

export type RegionKind = 'liquid' | 'coexist' | 'solid';

export interface PhaseRow {
  id: string;
  si: number;
  x: Comp;
  frac: number;
  /** 'liquid' | 'stoich' | 'solution' */
  kind: 'liquid' | 'stoich' | 'solution';
}

export interface Vec2 {
  /** 笛卡尔（三角形坐标，单位边长） */
  v: [number, number];
  /** 起点（成分） */
  at: Comp;
  label: string;
  meaning: string;
}

export interface InstantReaction {
  text: string;
  type: 'primary' | 'eutectic' | 'peritectic' | 'invariant' | 'solid' | 'none';
  explain: string;
  /** 切线规则的交点参数（三相界线处） */
  lambda?: number;
  curve?: CurveAnalysis;
}

export interface Stability {
  gm: GMinResult;
  /** 平衡解的切面证书：所有相的最小切面距离（≥ 0 ⇒ 全局最小） */
  certificate: number;
  /** 各相相对平衡切面的驱动力 −r（> 0 表示可析出；平衡时应 ≤ 0） */
  forces: { id: string; si: number; r: number; status: 'on-plane' | 'above' | 'below' | 'absent' }[];
  /** 假想的"均匀单相"状态（成分 x₀）的分类 */
  homogeneous: {
    id: string;
    si: number;
    /** G_φ(x₀) − G_eq（≥ 0） */
    excess: number;
    /** 二阶导（独立坐标 x_B, x_C）的 Hessian 及特征值 */
    H: Mat;
    eig: [number, number];
    cls: 'stable' | 'metastable' | 'unstable';
    /** 对其它相的最大析出驱动力（仅液相计算） */
    maxDF?: { id: string; df: number };
  }[];
}

export interface PointAnalysis {
  x0: Comp;
  T: number;
  eq: Equilibrium;
  kind: RegionKind;
  phases: PhaseRow[];
  P: number;
  /** 有效组元数（见 phaseRule） */
  C: number;
  F: number;
  ruleNote: string;
  Tliq: number;
  liqSi: number;
  lever: LeverResult;
  /** ∂f/∂(x_A, x_B)（相成分固定时）：A⁻¹ 的前两列；仅三相区（相成分在恒温下固定）有意义 */
  sens: { M: Mat; valid: boolean; note: string };
  gd: GibbsDuhem;
  vectors: Vec2[];
  reaction: InstantReaction;
  /** 冷却路径上已发生与即将发生的事件（x₀ 固定时） */
  past: TraceEvent[];
  next: TraceEvent[];
  /** 沿 12 个方向移动 x₀（恒温）将进入的相区 */
  neighbors: { dir: number; key: string; dist: number }[];
  stability: Stability;
}

const cart = (x: Comp) => toXY(x);

export function analyzePoint(d: PhaseDiagram, x0: Comp, T: number, eq: Equilibrium, trace?: Trace | null): PointAnalysis {
  const th = d.th;
  const phases: PhaseRow[] = eq.phases.map((p) => ({
    id: p.id,
    si: p.si,
    x: p.x,
    frac: p.frac,
    kind: p.si < 0 ? 'liquid' : th.solids[p.si].sol ? 'solution' : 'stoich',
  }));
  const hasL = phases.some((p) => p.si < 0);
  const kind: RegionKind = hasL ? (phases.length === 1 ? 'liquid' : 'coexist') : 'solid';
  const liq = th.liquidus(x0);
  const lever = phaseFractions(phases.map((p) => p.x), x0);
  // 灵敏度：三相区恒温时三个相成分固定，f = A⁻¹ b，b = (x_A, x_B, 1) ⇒ ∂f/∂(x_A, x_B) = A⁻¹ 的前两列
  let sens = { M: [] as Mat, valid: false, note: '' };
  if (phases.length === 3 && lever.det && Math.abs(lever.det) > 1e-12) {
    const Ai = inverse(lever.A)!;
    sens = { M: Ai.map((r) => [r[0], r[1]]), valid: true, note: '三相区恒温时三个相的成分都固定（F = 1 已被温度用掉），相分数是 x₀ 的线性函数。' };
  } else if (phases.length === 2) sens.note = '两相区：x₀ 移动时连结线本身会转动（相成分随之改变），相分数不是 x₀ 的线性函数；只沿连结线方向移动时才服从杠杆规则。';
  else if (phases.length === 1) sens.note = '单相区：相分数恒为 1，相成分就等于 x₀。';
  const gd = gibbsDuhemOfEq(th, eq.phases, T);

  // ---------------------------------------------------------------- 向量
  const vectors: Vec2[] = [];
  const P0 = cart(x0);
  vectors.push({ v: [P0[0], P0[1]], at: [1, 0, 0], label: 'r(x₀) − r(A)', meaning: '成分向量：x₀ = x_A·A + x_B·B + x_C·C，相对顶点 A 的位置向量 = x_B(B − A) + x_C(C − A)。' });
  const g = liquidusGradient(d, x0);
  const gn = Math.hypot(g.g[0], g.g[1]);
  if (gn > 1e-9) {
    vectors.push({ v: [-g.g[0] / gn, -g.g[1] / gn], at: x0, label: '−∇T_liq', meaning: `液相面最速降温方向（|∇T| = ${gn.toFixed(0)} K/单位边长）；等温线法向。` });
    vectors.push({ v: [g.g[1] / gn, -g.g[0] / gn], at: x0, label: 't_iso', meaning: '等温线切向（⊥ ∇T）：沿此方向移动成分，液相线温度不变（一阶）。' });
  }
  for (const p of phases) {
    if (phases.length < 2) break;
    const c = cart(p.x);
    vectors.push({ v: [c[0] - P0[0], c[1] - P0[1]], at: x0, label: `c_${p.id} − x₀`, meaning: `杠杆臂：Σ fᵢ(cᵢ − x₀) = 0（质量守恒）⇒ 各杠杆臂按相分数加权后和为零。f_${p.id} = ${p.frac.toFixed(4)}。` });
  }

  // ---------------------------------------------------------------- 即时反应（降温一小步时发生什么）
  let reaction: InstantReaction = { text: '—', type: 'none', explain: '' };
  const L = phases.find((p) => p.si < 0);
  const solidsIn = phases.filter((p) => p.si >= 0);
  if (L && solidsIn.length === 0) {
    reaction = { text: '无（单相液体）', type: 'none', explain: `T 高于液相线 ${(liq.T - 273.15).toFixed(1)} °C：均匀液相即吉布斯能最小态。降温到液相线时 ${th.solids[liq.si].label} 开始析出。` };
  } else if (L && solidsIn.length === 1) {
    const s = solidsIn[0];
    const dirL = cart(L.x);
    const cs = cart(s.x);
    reaction = {
      text: `L → ${s.id}`,
      type: 'primary',
      explain: `两相区（F = 2）：降温时 ${s.id} 继续析出。质量守恒 x₀ = f_L x_L + f_s c_s ⇒ x_L 沿 c_s→x₀ 方向背离 ${s.id} 移动${s.kind === 'solution' ? '；但固溶体 c_s 本身随温度变化，路径并非直线' : '（背向线规则）'}。`,
    };
    vectors.push({ v: [dirL[0] - cs[0], dirL[1] - cs[1]], at: L.x, label: 'dx_L（降温）', meaning: '液相成分在降温时的移动方向：从析出相背离而去（守恒推论）。' });
  } else if (L && solidsIn.length === 2) {
    const a = solidsIn[0].si;
    const b = solidsIn[1].si;
    const cv = nearestCurve(d, Math.min(a, b), Math.max(a, b), L.x);
    if (cv) {
      const cp = parametrize(cv.cv);
      const an = analyzeCurveAt(d, cv.cv, cv.s);
      const lam = an.ti.lambda;
      const la = th.solids[cv.cv.a].label;
      const lb = th.solids[cv.cv.b].label;
      let text = `L → ${la} + ${lb}`;
      let type: InstantReaction['type'] = 'eutectic';
      if (an.ti.kind === 'peritectic-a') {
        text = `L + ${la} → ${lb}`;
        type = 'peritectic';
      } else if (an.ti.kind === 'peritectic-b') {
        text = `L + ${lb} → ${la}`;
        type = 'peritectic';
      }
      reaction = {
        text,
        type,
        lambda: lam,
        curve: an,
        explain:
          `三相区（F = 1）：液相被约束在 ${la}/${lb} 界线上，温度一确定液相成分即确定。切线规则：界线在 x_L 处的切线反向延长与两固相连线交于 λ = ${Number.isFinite(lam) ? lam.toFixed(3) : '∞'}，` +
          (type === 'eutectic' ? '交点在连线段内 ⇒ 两固相同时析出（共晶型界线）。' : '交点在线段之外 ⇒ 一个固相被回溶（转熔型界线）。') +
          ` 界线全长 ${cp.length.toFixed(3)}。`,
      };
      vectors.push({ v: an.frame.tCool, at: L.x, label: 't（界线切向，降温）', meaning: '单变线的单位切向量 dp/ds，指向降温方向：液相成分沿它移动。' });
      vectors.push({ v: [-an.frame.tCool[1], an.frame.tCool[0]], at: L.x, label: 'n（界线法向）', meaning: '界线法向量：两初晶面在此相交；n 与 t 构成界线处的局部标架。' });
    }
  } else if (L && solidsIn.length === 3) {
    const iv = d.topo.invariants.find((v) => v.rank === 'ternary' && Math.abs(v.T - T) < 0.5);
    reaction = { text: iv ? iv.reaction.text.replace('⇌', '→') : '四相不变反应', type: 'invariant', explain: '四相平衡（F = 0）：温度与四个相的成分都固定，反应在恒温下进行；相分数沿反应向量（成分矩阵零空间）变化。' };
  } else {
    reaction = { text: '无液相', type: 'solid', explain: `全固态（${eq.key}）。${phases.some((p) => p.kind === 'solution') ? '固溶体的溶解度随温度变化，降温时可能发生固态脱溶。' : '化学计量固相之间在本模型中不再发生反应。'}` };
  }

  // ---------------------------------------------------------------- 冷却事件（x₀ 固定）
  const past: TraceEvent[] = [];
  const next: TraceEvent[] = [];
  if (trace)
    for (const e of trace.events) {
      if (e.kind === 'end') continue;
      if (e.T > T + 1e-6) past.push(e);
      else next.push(e);
    }

  // ---------------------------------------------------------------- 相邻相区（恒温，沿 12 个方向）
  const neighbors: PointAnalysis['neighbors'] = [];
  for (let k = 0; k < 12; k++) {
    const ang = (k * Math.PI) / 6;
    const dir: [number, number] = [Math.cos(ang), Math.sin(ang)];
    let found: { key: string; dist: number } | null = null;
    let hint: Equilibrium | null = eq;
    for (const step of [0.01, 0.025, 0.05, 0.1]) {
      const p: [number, number] = [P0[0] + step * dir[0], P0[1] + step * dir[1]];
      const c = fromCart(p);
      if (c.some((v) => v < 0)) break;
      const e = d.equilibrium(c, T, hint);
      hint = e;
      if (e.key !== eq.key) {
        found = { key: e.key, dist: step };
        break;
      }
    }
    if (found) neighbors.push({ dir: ang, ...found });
  }

  // ---------------------------------------------------------------- 热力学稳定性
  const gm = minimizeGibbs(th, x0, T);
  const forces: Stability['forces'] = [];
  const onPlane = (si: number) => eq.phases.some((p) => p.si === si);
  forces.push({ id: 'L', si: -1, r: gm.liquidTPD.r, status: statusOf(gm.liquidTPD.r, onPlane(-1)) });
  for (const r of gm.solidReduced) forces.push({ id: r.id, si: r.si, r: r.r, status: statusOf(r.r, onPlane(r.si)) });
  const homogeneous: Stability['homogeneous'] = [];
  for (const si of [-1, ...th.solids.filter((s) => s.sol).map((s) => s.index)]) {
    const H = hessian(d, si, x0, T);
    const e = eig2(H);
    const excess = th.Gphase(si, x0, T) - eq.G;
    const cls: 'stable' | 'metastable' | 'unstable' = e[1] <= 0 ? 'unstable' : excess < 1e-6 ? 'stable' : 'metastable';
    const row: Stability['homogeneous'][number] = { id: si < 0 ? 'L' : th.solids[si].id, si, excess, H, eig: e, cls };
    if (si < 0) {
      let best = { id: '', df: -Infinity };
      for (const s of th.solids) {
        const df = th.drivingForce(s.index, x0, T);
        if (df > best.df) best = { id: s.id, df };
      }
      row.maxDF = best;
    }
    homogeneous.push(row);
  }
  const certificate = Math.min(...forces.map((f) => f.r).filter(Number.isFinite));

  const rule = phaseRule(d, eq, x0);

  return {
    x0,
    T,
    eq,
    kind,
    phases,
    P: phases.length,
    F: rule.F,
    C: rule.C,
    ruleNote: rule.reason,
    Tliq: liq.T,
    liqSi: liq.si,
    lever,
    sens,
    gd,
    vectors,
    reaction,
    past,
    next,
    neighbors,
    stability: { gm, certificate, forces, homogeneous },
  };
}

function statusOf(r: number, inEq: boolean): Stability['forces'][number]['status'] {
  if (!Number.isFinite(r)) return 'absent';
  if (inEq || Math.abs(r) < 1e-3) return 'on-plane';
  return r > 0 ? 'above' : 'below';
}

/** 单相 φ 的吉布斯能对独立坐标 (x_B, x_C) 的 Hessian（中心差分） */
export function hessian(d: PhaseDiagram, si: number, x: Comp, T: number): Mat {
  const h = 1e-4 * Math.max(1e-3, Math.min(x[0], x[1], x[2]));
  const G = (b: number, c: number) => d.th.Gphase(si, [1 - b - c, b, c], T);
  const b = x[1];
  const c = x[2];
  const g0 = G(b, c);
  const gbb = (G(b + h, c) - 2 * g0 + G(b - h, c)) / (h * h);
  const gcc = (G(b, c + h) - 2 * g0 + G(b, c - h)) / (h * h);
  const gbc = (G(b + h, c + h) - G(b + h, c - h) - G(b - h, c + h) + G(b - h, c - h)) / (4 * h * h);
  return [
    [gbb, gbc],
    [gbc, gcc],
  ];
}

/** 对称 2×2 矩阵的特征值（降序） */
export function eig2(H: Mat): [number, number] {
  const tr = H[0][0] + H[1][1];
  const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return [tr / 2 + disc, tr / 2 - disc];
}

function fromCart(p: [number, number]): Comp {
  const c = p[1] / (Math.sqrt(3) / 2);
  const b = p[0] - 0.5 * c;
  return [1 - b - c, b, c];
}

/** 与液相成分最近的、由 (a, b) 两固相构成的界线及其弧长参数 */
export function nearestCurve(d: PhaseDiagram, a: number, b: number, x: Comp): { cv: BoundaryCurve; s: number; dist: number } | null {
  let best: { cv: BoundaryCurve; s: number; dist: number } | null = null;
  const X = cart(x);
  for (const cv of d.topo.curves) {
    if (!((cv.a === a && cv.b === b) || (cv.a === b && cv.b === a))) continue;
    const cp = parametrize(cv);
    for (let k = 0; k < cp.P.length - 1; k++) {
      const p = cp.P[k];
      const q = cp.P[k + 1];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const L2 = dx * dx + dy * dy || 1e-30;
      const t = Math.max(0, Math.min(1, ((X[0] - p[0]) * dx + (X[1] - p[1]) * dy) / L2));
      const dist = Math.hypot(p[0] + t * dx - X[0], p[1] + t * dy - X[1]);
      if (!best || dist < best.dist) best = { cv, s: cp.s[k] + t * (cp.s[k + 1] - cp.s[k]), dist };
    }
  }
  return best;
}

/** 点到界线的命中测试（屏幕像素距离由调用者换算） */
export function curveAtPoint(d: PhaseDiagram, x: Comp, tol: number): { cv: BoundaryCurve; s: number } | null {
  let best: { cv: BoundaryCurve; s: number; dist: number } | null = null;
  for (const cv of d.topo.curves) {
    const r = nearestCurve(d, cv.a, cv.b, x);
    if (r && r.cv === cv && (!best || r.dist < best.dist)) best = r;
  }
  return best && best.dist <= tol ? { cv: best.cv, s: best.s } : null;
}

export { planeAt };
