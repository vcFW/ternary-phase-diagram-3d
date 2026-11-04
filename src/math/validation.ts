import { triBary, toXY } from '../core/barycentric';
import { computeTrace } from '../core/cooling';
import { PhaseDiagram } from '../core/diagram';
import { getPreset } from '../core/presets';
import { R } from '../core/thermo';
import type { Comp } from '../core/types';
import { idealLens, refineTangent, ssCurves, SS_DEFAULT } from './binary';
import { alkemadeCheck, tangentIntersect } from './curves';
import { minimizeGibbs } from './gibbsMin';
import { combine, phaseFractions } from './lever';
import { nullSpace, rank, solve } from './linalg';
import { analyzeReaction, reactionThermo } from './reaction';
import { scheil } from './scheil';
import { P_MAT, project, reconstructT } from './spaces';

/**
 * 可复现验证算例（共 11 组）。每个检查项给出：参照（解析解 / 独立数值方法 / 文献公式）、计算值、误差与容差。
 * 同一份代码同时被 vitest 自动测试与"数学实验与验证"页面调用。
 */
export interface Check {
  name: string;
  /** 参照来源 */
  ref: string;
  expected: string;
  computed: string;
  err: number;
  tol: number;
  pass: boolean;
}

export interface Case {
  id: number;
  title: string;
  basis: 'analytic' | 'numeric' | 'literature';
  basisText: string;
  setup: string;
  checks: Check[];
}

const fx = (v: number, d = 6) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const vec = (v: number[], d = 6) => `(${v.map((x) => fx(x, d)).join(', ')})`;

function chk(name: string, ref: string, expected: number | number[], computed: number | number[], tol: number, d = 6): Check {
  const e = Array.isArray(expected) ? expected : [expected];
  const c = Array.isArray(computed) ? computed : [computed];
  const err = Math.max(...e.map((v, i) => Math.abs(v - c[i])));
  return { name, ref, expected: e.length > 1 ? vec(e, d) : fx(e[0], d), computed: c.length > 1 ? vec(c, d) : fx(c[0], d), err, tol, pass: err <= tol };
}

function cond(name: string, ref: string, ok: boolean, detail: string, err = ok ? 0 : 1): Check {
  return { name, ref, expected: '成立', computed: detail, err, tol: 0, pass: ok };
}

let cache: { key: string; ds: Record<string, PhaseDiagram> } | null = null;
function diagrams() {
  if (cache) return cache.ds;
  const ids = ['simple-eutectic', 'binary-incongruent', 'binary-congruent', 'ternary-incongruent', 'ss-isomorphous', 'ss-eutectic'];
  const ds: Record<string, PhaseDiagram> = {};
  for (const id of ids) ds[id] = new PhaseDiagram(getPreset(id).params);
  cache = { key: ids.join(), ds };
  return ds;
}

// ------------------------------------------------------------------ 1
function case1(): Case {
  const a: Comp = [0.8, 0.1, 0.1];
  const L: Comp = [0.2, 0.5, 0.3];
  const fTrue = [0.35, 0.65];
  const c0 = combine([a, L], fTrue);
  const r = phaseFractions([a, L], c0);
  const d = diagrams()['simple-eutectic'];
  const x0: Comp = [0.6, 0.2, 0.2];
  const T = d.liquidus(x0).T - 40;
  const eq = d.equilibrium(x0, T);
  const xl = eq.phases.find((p) => p.si < 0)!.x;
  const fA = eq.phases.find((p) => p.id === 'A')!.frac;
  const r2 = phaseFractions([d.solids[0].n, xl], x0);
  // 杠杆规则的几何形式：f_A = |c₀ x_L| / |x_A x_L|
  const P = toXY(x0);
  const PA = toXY(d.solids[0].n);
  const PL = toXY(xl);
  const geo = Math.hypot(P[0] - PL[0], P[1] - PL[1]) / Math.hypot(PA[0] - PL[0], PA[1] - PL[1]);
  const off = phaseFractions([a, L], [0.5, 0.2, 0.3]);
  return {
    id: 1,
    title: '两相平衡与杠杆规则',
    basis: 'analytic',
    basisText: '解析构造：c₀ = 0.35·c_α + 0.65·c_L（真值已知）；模型态与几何长度比交叉验证。',
    setup: `c_α = ${vec(a, 2)}，c_L = ${vec(L, 2)}；模型：简单共晶，x₀ = ${vec(x0, 2)}，T = T_liq − 40 K。`,
    checks: [
      chk('最小二乘解 f', '解析真值', fTrue, r.f!, 1e-12),
      chk('相容性残差 ‖Af − b‖', '= 0（c₀ 在连结线上）', 0, r.residual, 1e-12),
      chk('模型 L + A：矩阵解 f_A', 'PhaseDiagram.equilibrium（独立构造）', fA, r2.f![0], 1e-9),
      chk('几何杠杆 |c₀x_L|/|x_Ax_L|', '线性代数解 f_A', r2.f![0], geo, 1e-9),
      cond('偏离连结线的 c₀ 被判为不相容', '列空间判据', off.status === 'inconsistent', `status = ${off.status}，残差 ${off.residual.toExponential(2)}`),
    ],
  };
}

// ------------------------------------------------------------------ 2
function case2(): Case {
  const p: Comp[] = [
    [0.7, 0.2, 0.1],
    [0.1, 0.7, 0.2],
    [0.2, 0.1, 0.7],
  ];
  const fTrue = [0.2, 0.3, 0.5];
  const c0 = combine(p, fTrue);
  const r = phaseFractions(p, c0);
  const areaRatio = r.areas!.sub.map((s) => s / r.areas!.total);
  const bary = triBary(c0, p[0], p[1], p[2]);
  const A = r.A;
  const fLU = solve(A, r.b)!;
  const out = phaseFractions(p, [0.05, 0.05, 0.9]);
  const deg = phaseFractions([[0.5, 0.5, 0], [0.25, 0.25, 0.5], [0, 0, 1]], [0.2, 0.2, 0.6]);
  return {
    id: 2,
    title: '三相平衡与重心坐标',
    basis: 'analytic',
    basisText: '解析构造 c₀ = Σ fᵢcᵢ；Cramer 法则、子三角形面积比、LU 分解、core/triBary 四种方法相互独立。',
    setup: `三相 ${p.map((q) => vec(q, 1)).join(' ')}，f = (0.2, 0.3, 0.5)。`,
    checks: [
      chk('Cramer 法则 fᵢ = det Aᵢ / det A', '解析真值', fTrue, r.f!, 1e-12),
      chk('面积比 Sᵢ / S', '解析真值', fTrue, areaRatio, 1e-12),
      chk('列主元 LU 解', '解析真值', fTrue, fLU, 1e-12),
      chk('core.triBary（二维重心坐标）', '解析真值', fTrue, bary, 1e-12),
      cond('三角形外的成分得到负分数', '可行性 f ≥ 0', out.status === 'outside', `f = ${vec(out.f!, 3)}`),
      cond('共线三点：det A = 0 被识别', 'rank A = 2', deg.status === 'singular' && deg.rank === 2, `rank = ${deg.rank}，det = ${deg.det?.toExponential(1)}`),
    ],
  };
}

// ------------------------------------------------------------------ 3
function case3(): Case {
  const d = diagrams()['binary-incongruent'];
  const nb = nullSpace(P_MAT);
  const x: Comp = [0.42, 0.33, 0.25];
  const q1 = project([x[0], x[1], 1200]);
  const q2 = project([x[0], x[1], 1500]);
  // 等温线恢复误差 ≤ ΔT/2：随机抽样
  let worst = 0;
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 200; k++) {
    const a = rnd();
    const b = rnd() * (1 - a);
    const y: Comp = [a, b, 1 - a - b];
    const rc = reconstructT(d, y, 50);
    worst = Math.max(worst, Math.abs(rc.contours.estimate - d.liquidus(y).T));
  }
  const rs = reconstructT(d, x, 50);
  return {
    id: 3,
    title: '三维液相面投影与信息损失',
    basis: 'analytic',
    basisText: 'P = [[1,0,0],[0,1,0]] 的秩与零空间可解析求得；液相面为单值函数 ⇒ 限制在液相面上可逆。',
    setup: 'P:(x_A, x_B, T) → (x_A, x_B)；体系：含不一致熔融二元化合物；等温线间隔 50 K。',
    checks: [
      chk('rank P', '解析：2', 2, rank(P_MAT), 0),
      chk('ker P 的基 |⟨n, e_T⟩|', '解析：ker P = span(e_T)', 1, Math.abs(nb[0][2]), 1e-12),
      chk('不同温度的两状态投影相同', 'P(x, 1200) = P(x, 1500)', [q1[0], q1[1]], [q2[0], q2[1]], 0),
      chk('液相面约束下恢复的 T', 'T_liq(x) 闭式解', d.liquidus(x).T, rs.surface.T, 1e-9),
      { name: '仅凭等温线：中值估计最大误差', ref: '≤ ΔT/2 = 25 K', expected: '≤ 25', computed: fx(worst, 3), err: Math.max(0, worst - 25), tol: 0, pass: worst <= 25 + 1e-9 },
    ],
  };
}

// ------------------------------------------------------------------ 4
function case4(): Case {
  const V: Comp[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const ra = analyzeReaction([{ label: 'L', x: [1 / 3, 1 / 3, 1 / 3], si: -1 }, ...V.map((x, i) => ({ label: 'ABC'[i], x, si: i }))]);
  const d = diagrams()['simple-eutectic'];
  const E = d.topo.invariants.find((v) => v.rank === 'ternary')!;
  const phases = [{ label: 'L', x: E.x, si: -1 }, ...E.solids.map((si) => ({ label: d.solids[si].label, x: d.solids[si].n, si }))];
  const rb = analyzeReaction(phases);
  const tb = reactionThermo(d.th, phases, rb.nu!);
  // 文献公式：理想液相 + 纯固相 ⇒ xᵢ(T) = exp(−ΔHᵢ/R·(1/T − 1/Tmᵢ))，Σ xᵢ(T_E) = 1
  const c = d.params.components;
  const sumX = (T: number) => c.reduce((s, ci) => s + Math.exp((-ci.dH / R) * (1 / T - 1 / ci.Tm)), 0);
  let lo = 300;
  let hi = 1500;
  for (let it = 0; it < 200; it++) {
    const m = (lo + hi) / 2;
    if (sumX(m) > 1) hi = m;
    else lo = m;
  }
  const TE = (lo + hi) / 2;
  const xE = c.map((ci) => Math.exp((-ci.dH / R) * (1 / TE - 1 / ci.Tm)));
  return {
    id: 4,
    title: '三元共晶反应系数（零空间）',
    basis: 'literature',
    basisText: '纯组元固相时 N = [x_L | I]，ker N 的解析解为 ν = (−1, x_L)；共晶点由 Schröder–van Laar 方程组独立求解。',
    setup: '体系：简单三元共晶（理想液相）。',
    checks: [
      chk('ν（L 在重心）', '解析：(−1, ⅓, ⅓, ⅓)', [-1, 1 / 3, 1 / 3, 1 / 3], ra.nu!, 1e-12),
      chk('E 点温度 T_E / K', 'Schröder–van Laar：Σ exp(−ΔHᵢ/R(1/T − 1/Tmᵢ)) = 1', TE, E.T, 1e-5, 4),
      chk('E 点成分', 'Schröder–van Laar', xE, E.x, 1e-6),
      chk('固相系数 = x_E', '解析：ν_s = x_L', E.x, rb.nu!.slice(1), 1e-9),
      chk('守恒残差 ‖Nν‖∞', '= 0', 0, rb.residual, 1e-12),
      chk('ΔG_r(T_E)', '四相共切面 ⇒ ΔG_r = 0', 0, tb.dG(E.T), 1e-3, 5),
      cond('分类', '符号判据', rb.cls === 'eutectic', rb.cls),
    ],
  };
}

// ------------------------------------------------------------------ 5
function case5(): Case {
  const d = diagrams()['binary-incongruent'];
  const U = d.topo.invariants.find((v) => v.rank === 'ternary' && v.reaction.type === 'transition')!;
  const phases = [{ label: 'L', x: U.x, si: -1 }, ...U.solids.map((si) => ({ label: d.solids[si].label, x: d.solids[si].n, si }))];
  const r = analyzeReaction(phases);
  const s = U.solids.map((si) => d.solids[si].n);
  const bary = triBary(U.x, s[0], s[1], s[2]);
  const th = reactionThermo(d.th, phases, r.nu!);
  return {
    id: 5,
    title: '转熔型（过渡点）反应的守恒',
    basis: 'numeric',
    basisText: '零空间（SVD）与重心坐标（core/triBary，独立二维算法）必须一致；ΔG_r 在不变点温度为 0。',
    setup: `体系：含不一致熔融二元化合物 D；不变点 ${U.label}，T = ${(U.T - 273.15).toFixed(1)} °C。`,
    checks: [
      chk('ν_s（零空间，ν_L = −1）', 'core/triBary(x_U; 固相三角形)', bary, r.nu!.slice(1), 1e-9),
      chk('守恒残差 ‖Nν‖∞', '= 0', 0, r.residual, 1e-12),
      chk('rank N', '4 相、三固相不共线 ⇒ 3', 3, r.rank, 0),
      cond('恰一个固相系数为负', '过渡点（单转熔）', r.cls === 'transition', `${r.text}`),
      chk('ΔG_r(T_U)', '= 0', 0, th.dG(U.T), 1e-3, 5),
      cond('降温方向：ΔG_r(T_U − 10 K) < 0', '热力学方向判据', th.dG(U.T - 10) < 0, `ΔG_r = ${fx(th.dG(U.T - 10), 3)} J/mol`),
    ],
  };
}

// ------------------------------------------------------------------ 6
function case6(): Case {
  const ti = tangentIntersect([0.3, 0.2], [0.6, 0.8], [1, 0, 0], [0, 1, 0]);
  const d = diagrams()['binary-congruent'];
  const cv = d.topo.curves.find((c) => [c.a, c.b].sort().join() === [2, 3].join())!;
  const ak = alkemadeCheck(d, cv);
  // 非对称体系：Ω_AB ≠ Ω_AC，交点不再由对称性决定
  const pa = structuredClone(getPreset('binary-congruent').params);
  pa.omega = { AB: -3000, AC: 1500, BC: 2500 };
  const d2 = new PhaseDiagram(pa, 220);
  const cv2 = d2.topo.curves.find((c) => [c.a, c.b].sort().join() === [2, 3].join())!;
  const ak2 = alkemadeCheck(d2, cv2);
  return {
    id: 6,
    title: '切线与连线的几何求交（切线规则 / Alkemade 定理）',
    basis: 'analytic',
    basisText: '直线 p + τt 与 AB 的交点可手算：τ = −0.25，λ = 0.15；Alkemade 定理由 Gibbs–Duhem 线性相关性推出 dT = 0。',
    setup: 'p = (0.3, 0.2)，t = (0.6, 0.8)，连线 A(0,0)–B(1,0)；模型：一致熔融化合物 D，D/C 界线与 D–C 连线；另取 Ω = (−3, 1.5, 2.5) kJ 破坏 A↔B 对称性。',
    checks: [
      chk('τ', '解析', -0.25, ti.tau, 1e-12),
      chk('λ', '解析', 0.15, ti.lambda, 1e-12),
      chk('界线与连线交点弧长 vs 温度极大点弧长', 'Alkemade 定理：两者重合', ak.sMax ?? NaN, ak.sCross ?? NaN, 4e-3),
      chk('交点处 Gibbs–Duhem 零空间 dT 分量', '线性相关 ⇒ 0', 0, ak.dTatCross ?? NaN, 1e-9, 9),
      chk('非对称 Ω：交点弧长 vs 极大点弧长', 'Alkemade 定理（无对称性辅助）', ak2.sMax ?? NaN, ak2.sCross ?? NaN, 4e-3),
      chk('非对称 Ω：两处温度之差 / K', 'Alkemade 定理', ak2.TMax ?? NaN, ak2.TCross ?? NaN, 0.05, 4),
    ],
  };
}

// ------------------------------------------------------------------ 7
function case7(): Case {
  const T = 1450;
  const m = SS_DEFAULT;
  const an = idealLens(m, T)!;
  const [L, S] = ssCurves(m, T);
  const num = refineTangent(S, L, an.xS * 0.9, an.xL * 1.1)!;
  const muS = [S.G!(num.xa) - num.xa * S.dG!(num.xa), S.G!(num.xa) + (1 - num.xa) * S.dG!(num.xa)];
  const muL = [L.G!(num.xb) - num.xb * L.dG!(num.xb), L.G!(num.xb) + (1 - num.xb) * L.dG!(num.xb)];
  const d = diagrams()['ternary-incongruent'];
  let worst = 0;
  let worstMu = 0;
  const states: [Comp, number][] = [
    [[0.45, 0.28, 0.27], -40],
    [[0.3, 0.1, 0.6], -120],
    [[0.25, 0.4, 0.35], -90],
    [[0.55, 0.35, 0.1], -200],
  ];
  for (const [x, dT] of states) {
    const Tq = d.liquidus(x).T + dT;
    const g = minimizeGibbs(d.th, x, Tq);
    const e = d.equilibrium(x, Tq);
    worst = Math.max(worst, Math.abs(g.G - e.G));
    const Lp = g.phases.find((p) => p.si < 0);
    if (Lp) {
      const mu = d.th.muLiq(Lp.x, Tq);
      worstMu = Math.max(worstMu, ...mu.map((v, i) => Math.abs(v - g.mu[i])));
    }
  }
  return {
    id: 7,
    title: '吉布斯能平衡：公切线 / 公切面',
    basis: 'analytic',
    basisText: '理想匀晶系有闭式解 xᵢˢ/xᵢᴸ = exp(ΔHᵢ(1−T/Tmᵢ)/RT)；三元：线性规划（对偶 = 公切面）与构造式求解器独立比较。',
    setup: `【演示模型】理想二元固溶体，Tm = (${m.Tm.join(', ')}) K，T = ${T} K；三元：含不一致熔融三元化合物 S，4 个状态。`,
    checks: [
      chk('x_B^α（公切线牛顿解）', '闭式解', an.xS, num.xa, 1e-8),
      chk('x_B^L（公切线牛顿解）', '闭式解', an.xL, num.xb, 1e-8),
      chk('μ_A^α − μ_A^L, μ_B^α − μ_B^L', '化学势相等', [0, 0], [muS[0] - muL[0], muS[1] - muL[1]], 1e-6),
      chk('max |G_LP − G_构造|', '两种独立求解器', 0, worst, 1e-3, 5),
      chk('max |μᴸ(x_L) − μ_dual|', 'LP 对偶变量 = 液相化学势', 0, worstMu, 0.5, 4),
    ],
  };
}

// ------------------------------------------------------------------ 8
function case8(): Case {
  const d = diagrams()['simple-eutectic'];
  const x0: Comp = [0.6, 0.25, 0.15];
  const tr = computeTrace(d, x0);
  const c = d.params.components[0];
  let svl = 0;
  let col = 0;
  let mass = 0;
  let minf = 0;
  for (const s of tr.samples) {
    const L = s.eq.phases.find((p) => p.si < 0);
    for (const p of s.eq.phases) minf = Math.min(minf, p.frac);
    const mix = [0, 0, 0];
    for (const p of s.eq.phases) for (let i = 0; i < 3; i++) mix[i] += p.frac * p.x[i];
    mass = Math.max(mass, ...mix.map((v, i) => Math.abs(v - x0[i])));
    if (L && s.eq.key === 'L+A') {
      // Schröder–van Laar：T = ΔH_A / (ΔH_A/Tm_A − R ln x_A^L)
      const Tsvl = c.dH / (c.dH / c.Tm - R * Math.log(L.x[0]));
      svl = Math.max(svl, Math.abs(Tsvl - s.T));
      const a = toXY([1, 0, 0]);
      const p0 = toXY(x0);
      const pl = toXY(L.x);
      col = Math.max(col, Math.abs((p0[0] - a[0]) * (pl[1] - a[1]) - (p0[1] - a[1]) * (pl[0] - a[0])));
    }
  }
  const E = d.topo.invariants.find((v) => v.rank === 'ternary')!;
  const plateau = tr.events.find((e) => e.kind === 'invariant');
  const fin = tr.finalPhases;
  const ff = ['A', 'B', 'C'].map((id) => fin.find((p) => p.id === id)?.frac ?? 0);
  const keys = Array.from(new Set(tr.samples.map((s) => s.eq.key)));
  return {
    id: 8,
    title: '完整平衡冷却路径',
    basis: 'literature',
    basisText: 'Schröder–van Laar 液相线方程（理想液相、纯固相）；初晶阶段液相沿 A→x₀ 射线（守恒推论）；终态相分数 = 总成分（解析）。',
    setup: `体系：简单三元共晶，x₀ = ${vec(x0, 2)}，平衡冷却。相区序列：${keys.join(' → ')}。`,
    checks: [
      chk('初晶阶段 |T − T_SvL(x_A^L)| / K', 'Schröder–van Laar', 0, svl, 1e-3),
      chk('初晶阶段液相点与 A、x₀ 共线（有向面积）', '质量守恒 ⇒ 直线规则', 0, col, 1e-9),
      chk('全程质量守恒 max‖Σfᵢcᵢ − x₀‖∞', '= 0', 0, mass, 1e-6),
      cond('相分数非负', 'fᵢ ≥ 0', minf >= -1e-9, `min f = ${minf.toExponential(1)}`),
      chk('四相平台温度', '= T_E', E.T, plateau?.T ?? NaN, 1e-3, 4),
      chk('终态相分数 (A, B, C)', '解析：= x₀', x0, ff, 1e-6),
    ],
  };
}


// ------------------------------------------------------------------ 9
function case9(): Case {
  const d = diagrams()['ss-isomorphous'];
  const c = d.params.components;
  const x0: Comp = [0.4, 0.3, 0.3];
  const Tl = d.liquidus(x0).T;
  // 取两相区中部的温度：先求固相线（液相消失）温度
  let lo = 300;
  let hi = Tl;
  for (let it = 0; it < 60; it++) {
    const m = (lo + hi) / 2;
    if (d.equilibrium(x0, m, null).phases.some((p) => p.si < 0)) hi = m;
    else lo = m;
  }
  const Tsol = (lo + hi) / 2;
  const T = 0.5 * (Tl + Tsol);
  // Rachford–Rice：理想液相 + 理想固溶体 ⇒ yᵢ = kᵢ xᵢ，kᵢ = exp(ΔHᵢ(1 − T/Tmᵢ)/RT)；
  // Σ x₀ᵢ (kᵢ − 1)/(1 + V(kᵢ − 1)) = 0，V 为固相分数（单调函数，二分求根）
  const k = c.map((ci) => Math.exp((ci.dH * (1 - T / ci.Tm)) / (R * T)));
  const rr = (V: number) => x0.reduce((a, xi, i) => a + (xi * (k[i] - 1)) / (1 + V * (k[i] - 1)), 0);
  let a = 0;
  let b = 1;
  for (let it = 0; it < 200; it++) {
    const m = (a + b) / 2;
    if (rr(m) > 0) a = m;
    else b = m;
  }
  const V = (a + b) / 2;
  const xL = x0.map((xi, i) => xi / (1 + V * (k[i] - 1)));
  const yS = xL.map((xi, i) => k[i] * xi);
  const eq = d.equilibrium(x0, T, null);
  const L = eq.phases.find((p) => p.si < 0)!;
  const S = eq.phases.find((p) => p.si >= 0)!;
  const g = minimizeGibbs(d.th, x0, T);
  return {
    id: 9,
    title: '三元匀晶：连结线方向（Rachford–Rice）',
    basis: 'literature',
    basisText: '理想液相 + 理想固溶体：xᵢˢ/xᵢᴸ = kᵢ(T)，相分数满足 Rachford–Rice 方程（Rachford & Rice, 1952）；与通用固溶体求解器（LP + KKT 牛顿）及列生成 LP 对照。',
    setup: `【演示模型】三元匀晶，x₀ = ${vec(x0, 2)}，T = (T_liq + T_sol)/2 = ${(T - 273.15).toFixed(2)} °C。`,
    checks: [
      chk('固相分数 f_α', 'Rachford–Rice', V, S.frac, 1e-7),
      chk('液相成分 x_L', 'xᵢ = x₀ᵢ/(1 + V(kᵢ − 1))', xL, L.x, 1e-7),
      chk('固相成分 y_α', 'yᵢ = kᵢ xᵢ', yS, S.x, 1e-7),
      chk('分配系数 y_α/x_L', 'kᵢ(T) = exp(ΔHᵢ(1 − T/Tmᵢ)/RT)', k, S.x.map((v, i) => v / L.x[i]), 1e-6),
      chk('列生成 LP 的 G 与通用求解器之差', '两种独立方法', 0, Math.abs(g.G - eq.G), 1e-2, 5),
      cond('连结线不经过任何固定点', '固溶体：方向由 kᵢ 决定', Math.abs(S.x[0] - 1 / 3) > 0.01, `y_α = ${vec(S.x, 3)}`),
    ],
  };
}

// ------------------------------------------------------------------ 10
function case10(): Case {
  const d = diagrams()['ss-eutectic'];
  const x0: Comp = [0.6, 0.25, 0.15];
  const tr = computeTrace(d, x0);
  // 杠杆规则（两端点都在移动）：每一时刻 y_α、x₀、x_L 共线
  let col = 0;
  let mass = 0;
  const prim = tr.samples.filter((s) => s.eq.key === 'L+α');
  for (const s of prim) {
    const L = s.eq.phases.find((p) => p.si < 0)!;
    const A = s.eq.phases.find((p) => p.si >= 0)!;
    const pa = toXY(A.x);
    const p0 = toXY(x0);
    const pl = toXY(L.x);
    col = Math.max(col, Math.abs((p0[0] - pa[0]) * (pl[1] - pa[1]) - (p0[1] - pa[1]) * (pl[0] - pa[0])));
    mass = Math.max(mass, ...[0, 1, 2].map((i) => Math.abs(L.frac * L.x[i] + A.frac * A.x[i] - x0[i])));
  }
  // 背向线规则失效：初晶阶段液相路径的方向转角
  const dir = (a: Comp, b: Comp) => {
    const p = toXY(a);
    const q = toXY(b);
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  const L0 = prim[1].eq.phases.find((p) => p.si < 0)!.x;
  const L1 = prim[Math.floor(prim.length / 2)].eq.phases.find((p) => p.si < 0)!.x;
  const L2 = prim[prim.length - 1].eq.phases.find((p) => p.si < 0)!.x;
  const turn = Math.abs(dir(L0, L1) - dir(L1, L2)) * (180 / Math.PI);
  // E 点：反应系数 = x_E 关于三个共轭固相成分的重心坐标
  const E = d.topo.invariants.find((v) => v.rank === 'ternary')!;
  const phases = [{ label: 'L', x: E.x, si: -1 }, ...E.solids.map((si, k) => ({ label: d.solids[si].label, x: E.solidX[k], si }))];
  const rx = analyzeReaction(phases);
  const bary = triBary(E.x, E.solidX[0], E.solidX[1], E.solidX[2]);
  const rt = reactionThermo(d.th, phases, rx.nu!);
  // 共轭成分与化学势相等
  let dmu = 0;
  for (let k = 0; k < 3; k++) {
    const m = d.th.muPhase(E.solids[k], E.solidX[k], E.T)!;
    const mL = d.th.muLiq(E.x, E.T);
    dmu = Math.max(dmu, ...m.map((v, i) => Math.abs(v - mL[i])));
  }
  return {
    id: 10,
    title: '有限固溶度三元共晶：移动端点的杠杆规则与共轭成分',
    basis: 'numeric',
    basisText: '守恒（共线性）与化学势相等为数学恒等式，用数值检验；E 点反应系数用独立的二维重心坐标算法对照；背向线规则的失效以路径转角量化。',
    setup: `【演示模型】有限固溶度三元共晶，x₀ = ${vec(x0, 2)}，平衡冷却。`,
    checks: [
      chk('初晶阶段 y_α、x₀、x_L 共线（有向面积）', '杠杆规则（两端点随 T 移动）', 0, col, 1e-9),
      chk('初晶阶段质量守恒', 'f_L x_L + f_α y_α = x₀', 0, mass, 1e-9),
      { name: '初晶阶段液相路径转角', ref: '固溶体 ⇒ 路径弯曲（背向线规则失效）', expected: '> 0.5°', computed: `${fx(turn, 2)}°`, err: 0, tol: 0, pass: turn > 0.5 },
      chk('E 点 ν_s（零空间）', 'core/triBary(x_E; 共轭固相三角形)', bary, rx.nu!.slice(1), 1e-9),
      chk('E 点 ΔG_r', '四相共切面 ⇒ 0', 0, rt.dG(E.T), 1e-3, 5),
      chk('E 点 max|μᵢ^φ − μᵢᴸ|', '化学势相等', 0, dmu, 1e-3, 5),
      cond('E 点固相成分不在顶点（有固溶度）', '固溶体', E.solidX.every((y) => Math.max(...y) < 0.995), E.solidX.map((y) => vec(y, 3)).join(' ')),
    ],
  };
}

// ------------------------------------------------------------------ 11
function case11(): Case {
  const d = diagrams()['ss-isomorphous'];
  // 二元（A–B 边）稀溶液极限：B 为溶质，分配系数 k = x_B^S / x_B^L 近似为常数
  const x0: Comp = [0.97, 0.03, 0];
  const st = scheil(d, x0);
  const cB = d.params.components[1];
  // 理想溶液（液 / 固相同为理想，纯固相基准 G = 0）：RT ln k = ΔH_B (1 − T/Tm_B)
  const kOf = (T: number) => Math.exp((cB.dH * (1 - T / cB.Tm)) / (R * T));
  const use = st.filter((s) => s.fL >= 0.1 && s.fL < 1);
  const ks = use.map((s) => kOf(s.T));
  const kmin = Math.min(...ks);
  const kmax = Math.max(...ks);
  // 经典 Scheil 方程 x_L = x₀ f_L^(k−1)：k 随 T 缓变时，数值解必落在 [x₀ f^(kmax−1), x₀ f^(kmin−1)] 内
  // 数值 Scheil 是一阶离散（步内固相成分取步末值），自适应步长把相对离散误差控制在约 2%：包络两侧各留 2.5% 余量
  const DISC = 0.025;
  let viol = 0;
  let mid = 0;
  for (const s of use) {
    const lo = x0[1] * Math.pow(s.fL, kmax - 1) * (1 - DISC);
    const hi = x0[1] * Math.pow(s.fL, kmin - 1) * (1 + DISC);
    viol = Math.max(viol, (lo - s.xL[1]) / s.xL[1], (s.xL[1] - hi) / s.xL[1], 0);
    mid = Math.max(mid, Math.abs(s.xL[1] - x0[1] * Math.pow(s.fL, (kmin + kmax) / 2 - 1)) / s.xL[1]);
  }
  const fmin = Math.min(...use.map((s) => s.fL));
  // 与固定小步长（0.25 K）Scheil 对照：自适应步长不改变结果
  const fine = scheil(d, x0, { dT: 0.25 });
  const fa = st[st.length - 1];
  const fb = fine[fine.length - 1];
  const stepDiff = Math.max(0, ...Object.keys(fb.solids).map((k) => Math.abs((fa.solids[k] ?? 0) - fb.solids[k])));
  return {
    id: 11,
    title: 'Scheil 凝固：经典方程 x_L = x₀ f_L^(k−1)（二元稀溶液极限）',
    basis: 'analytic',
    basisText: '理想匀晶二元（A–B 边，B 为溶质）：k 由 RT ln k = ΔH_B(1 − T/Tm_B) 解析给出，在凝固温度区间内只缓慢变化；常数 k 时 Gulliver–Scheil 方程是精确解，故数值解应落在以 k 的变化范围为界的解析包络内。',
    setup: `【演示模型】三元匀晶（理想）体系的 A–B 边，x₀ = ${vec(x0, 2)}；对 f_L ≥ 0.1 的各步比较。`,
    checks: [
      chk('k(T) 的变化幅度 k_max − k_min', '解析 k(T)：缓变才可与常数 k 的方程比较', 0, kmax - kmin, 0.06, 4),
      chk('数值 x_L(B) 越出解析包络（含 2.5% 离散余量）的最大相对量', 'x_L = x₀ f_L^(k−1)，k ∈ [k_min, k_max]', 0, viol, 1e-9, 6),
      chk('与 k̄ 对应的解析曲线的最大相对偏差', 'x_L = x₀ f_L^(k̄−1)；容差 = ½Δk·ln(1/f_min) + 3%', 0, mid, 0.5 * (kmax - kmin) * Math.log(1 / fmin) + 0.03, 4),
      { name: '自适应步数', ref: 'Scheil 步长自适应（0.25–10 K）', expected: `≤ 固定 0.25 K 的 ${fine.length} 步`, computed: `${st.length} 步`, err: 0, tol: 0, pass: st.length < fine.length },
      chk('自适应 vs 固定 0.25 K：累积固相量最大差', '同一模型的步长无关性', 0, stepDiff, 2e-3, 5),
    ],
  };
}

export function runValidation(): Case[] {
  return [case1(), case2(), case3(), case4(), case5(), case6(), case7(), case8(), case9(), case10(), case11()];
}

