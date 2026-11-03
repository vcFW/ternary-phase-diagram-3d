import type { Comp } from '../core/types';
import { compToCart } from './spaces';
import { cond, det, fromCols, lstsq, nullSpace, rank, solve, svd, type Mat, type Vec } from './linalg';

/**
 * 相分数 = 带约束线性方程组的解。
 *
 *   质量守恒：  Σ fᵢ cᵢ = c₀        （每个组元一行，共 3 行）
 *   归一化：    Σ fᵢ = 1
 *   物理可行：  fᵢ ≥ 0
 *
 * 因为每个 cᵢ 的分量之和都是 1，三行守恒方程相加恰好得到归一化方程 ⇒ 4 个方程中只有 3 个独立。
 * 删去 x_C 行，得约化系统  A f = b，A = [[c_iA], [c_iB], [1 … 1]]，b = (c₀A, c₀B, 1)。
 *
 * k = 2（连结线）：A 为 3×2，b 在 A 的列空间中 ⇔ c₀ 在连结线上（否则最小二乘残差 > 0）。
 * k = 3（连结三角形）：A 为 3×3，det A = 2·(三角形在 (x_A, x_B) 坐标下的有向面积)；
 *        Cramer 法则 fᵢ = det Aᵢ / det A = 子三角形面积 / 总面积 —— 这就是重心坐标与"重心规则"。
 * k = 4（四相不变平衡）：A 为 3×4，零空间一维 ⇒ 相分数不唯一，差一个"反应进度" ξ（见 reaction.ts）。
 */

export type LeverStatus = 'ok' | 'outside' | 'singular' | 'ill' | 'inconsistent' | 'underdetermined' | 'invalid';

export interface LeverResult {
  k: number;
  /** 完整 4×k 系统（x_A, x_B, x_C, Σ 行） */
  Afull: Mat;
  bfull: Vec;
  rankFull: number;
  /** 约化 3×k 系统 */
  A: Mat;
  b: Vec;
  rank: number;
  singular: Vec;
  det: number | null;
  cond: number;
  /** 解（k ≤ 3 时唯一；k = 4 时为最小范数解） */
  f: Vec | null;
  /** 残差 ‖A f − b‖ */
  residual: number;
  /** Cramer 分子 det Aᵢ（仅 k = 3） */
  cramer: number[] | null;
  /** 有向面积（笛卡尔，仅 k = 3）：总面积与三个子三角形 */
  areas: { total: number; sub: number[] } | null;
  /** 零空间（k = 4 时为反应向量方向） */
  nullBasis: Vec[];
  status: LeverStatus;
  message: string;
}

const TOL_F = 1e-9;

export function phaseFractions(phases: Comp[], c0: Comp): LeverResult {
  const k = phases.length;
  const Afull = [0, 1, 2].map((i) => phases.map((c) => c[i])).concat([phases.map(() => 1)]);
  const bfull = [c0[0], c0[1], c0[2], 1];
  const A: Mat = [phases.map((c) => c[0]), phases.map((c) => c[1]), phases.map(() => 1)];
  const b: Vec = [c0[0], c0[1], 1];
  const sv = svd(A).S;
  const r = rank(A);
  const base = {
    k,
    Afull,
    bfull,
    rankFull: rank(Afull),
    A,
    b,
    rank: r,
    singular: sv.slice(0, Math.min(3, k)),
    nullBasis: nullSpace(A),
  };
  const invalid = phases.concat([c0]).some((c) => c.some((v) => v < -1e-12) || Math.abs(c[0] + c[1] + c[2] - 1) > 1e-9);
  if (invalid)
    return { ...base, det: null, cond: Infinity, f: null, residual: NaN, cramer: null, areas: null, status: 'invalid', message: '成分无效：分量须非负且和为 1。' };

  if (k === 3) {
    const D = det(A);
    const kap = cond(A);
    const areaOf = (p: Comp, q: Comp, s: Comp) => {
      const [a, b2, c] = [compToCart(p), compToCart(q), compToCart(s)];
      return 0.5 * ((b2[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b2[1] - a[1]));
    };
    const total = areaOf(phases[0], phases[1], phases[2]);
    const sub = [areaOf(c0, phases[1], phases[2]), areaOf(phases[0], c0, phases[2]), areaOf(phases[0], phases[1], c0)];
    if (r < 3) {
      const ls = lstsq(A, b);
      return {
        ...base,
        det: D,
        cond: Infinity,
        f: null,
        residual: ls.residual,
        cramer: null,
        areas: { total, sub },
        status: 'singular',
        message: `det A = ${D.toExponential(2)}：三个相成分点共线（或重合），rank A = ${r}，连结三角形退化，相分数不能唯一确定。`,
      };
    }
    const cramer = [0, 1, 2].map((j) => det(A.map((row, i) => row.map((v, jj) => (jj === j ? b[i] : v)))));
    const f = cramer.map((v) => v / D);
    const res = Math.hypot(...A.map((row, i) => row.reduce((s, v, j) => s + v * f[j], 0) - b[i]));
    const outside = f.some((v) => v < -TOL_F);
    const ill = kap > 1e8;
    return {
      ...base,
      det: D,
      cond: kap,
      f,
      residual: res,
      cramer,
      areas: { total, sub },
      status: outside ? 'outside' : ill ? 'ill' : 'ok',
      message: outside
        ? `总成分落在三角形之外：f = (${f.map((v) => v.toFixed(3)).join(', ')}) 含负值。代数解存在但物理不可行 —— 该三相组合不是此成分的平衡相组合。`
        : ill
          ? `κ(A) = ${kap.toExponential(2)}：三角形接近退化（病态），相分数对成分误差极其敏感。`
          : `唯一解，fᵢ = 子三角形面积 / 总面积（重心坐标）。κ(A) = ${kap.toFixed(2)}。`,
    };
  }
  if (k === 2) {
    const ls = lstsq(A, b);
    const kap = cond(A);
    const f = ls.x;
    const onLine = ls.residual < 1e-7;
    const outside = f.some((v) => v < -TOL_F);
    let status: LeverStatus = 'ok';
    let message = `c₀ 在连结线上，f = (${f.map((v) => v.toFixed(4)).join(', ')})：杠杆规则 f₁/f₂ = |c₀c₂| / |c₀c₁|。`;
    if (r < 2) {
      status = 'singular';
      message = '两相成分点重合：rank A = 1，连结线退化。';
    } else if (!onLine) {
      status = 'inconsistent';
      message = `c₀ 不在连结线上：方程组不相容，最小二乘残差 ${ls.residual.toExponential(2)}（即 c₀ 到连结线的偏离）。两相平衡不可能给出该总成分。`;
    } else if (outside) {
      status = 'outside';
      message = 'c₀ 在连结线的延长线上（线段之外）：f 含负值，物理不可行。';
    }
    return { ...base, det: null, cond: kap, f, residual: ls.residual, cramer: null, areas: null, status, message };
  }
  if (k === 1) {
    const res = Math.hypot(phases[0][0] - c0[0], phases[0][1] - c0[1], phases[0][2] - c0[2]);
    return { ...base, det: null, cond: 1, f: [1], residual: res, cramer: null, areas: null, status: res < 1e-9 ? 'ok' : 'inconsistent', message: res < 1e-9 ? '单相：f = 1。' : '单相成分与总成分不同：不相容。' };
  }
  // k ≥ 4：欠定
  const ls = lstsq(A, b);
  return {
    ...base,
    det: null,
    cond: Infinity,
    f: ls.x,
    residual: ls.residual,
    cramer: null,
    areas: null,
    status: 'underdetermined',
    message: `k = ${k} 个相、只有 3 个独立方程：零空间维数 ${k - r}。相分数不唯一 —— 可沿零空间方向（反应向量）移动而不违反质量守恒；这正是四相不变反应在恒温下的"反应进度" ξ。`,
  };
}

/** 给定相分数，验证质量守恒的残差 ‖Σ fᵢcᵢ − c₀‖∞ 与 |Σfᵢ − 1| */
export function conservationResidual(phases: { frac: number; x: Comp }[], c0: Comp): { mass: number; norm: number; min: number } {
  const mix = [0, 0, 0];
  let s = 0;
  let mn = Infinity;
  for (const p of phases) {
    s += p.frac;
    mn = Math.min(mn, p.frac);
    for (let i = 0; i < 3; i++) mix[i] += p.frac * p.x[i];
  }
  return { mass: Math.max(...mix.map((v, i) => Math.abs(v - c0[i]))), norm: Math.abs(s - 1), min: mn };
}

/** 由相分数合成总成分：c = Σ fᵢ cᵢ（用于"拖动相分数 → 更新线性组合"） */
export function combine(phases: Comp[], f: Vec): Comp {
  const c: Comp = [0, 0, 0];
  phases.forEach((p, j) => {
    for (let i = 0; i < 3; i++) c[i] += f[j] * p[i];
  });
  return c;
}

/** 数值稳定性实验：对 c₀ 加扰动 δ，观察 f 的变化（相对放大倍数 ≤ κ） */
export function sensitivity(phases: Comp[], c0: Comp, delta = 1e-4): { amp: number; kappa: number } | null {
  if (phases.length !== 3) return null;
  const A: Mat = [phases.map((c) => c[0]), phases.map((c) => c[1]), phases.map(() => 1)];
  const f0 = solve(A, [c0[0], c0[1], 1]);
  if (!f0) return null;
  let amp = 0;
  for (const dir of [[1, -1], [1, 0], [0, 1], [-1, 1]]) {
    const db = [delta * dir[0], delta * dir[1], 0];
    const f1 = solve(A, [c0[0] + db[0], c0[1] + db[1], 1]);
    if (!f1) continue;
    const df = Math.hypot(...f1.map((v, i) => v - f0[i]));
    const rel = df / Math.hypot(...f0) / (Math.hypot(...db) / Math.hypot(c0[0], c0[1], 1));
    amp = Math.max(amp, rel);
  }
  return { amp, kappa: cond(A) };
}

export { fromCols };
