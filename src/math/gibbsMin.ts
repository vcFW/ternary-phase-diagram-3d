import type { Thermo } from '../core/thermo';
import type { Comp } from '../core/types';
import { inverse, matVec, transpose, type Mat } from './linalg';
import { binaryEquilibrium, edgeCurves } from './binary';

/**
 * 吉布斯能最小化 —— 与 PhaseDiagram.equilibrium（逐类构造候选状态）完全独立的第二种求解器。
 *
 *   原问题（线性规划，变量为各"候选相点"的数量 f_j ≥ 0）：
 *        min  Σ f_j G_j            G_j = G_φ(c_j, T)
 *        s.t. Σ f_j c_j = c₀       （3 个组元守恒方程；其和即 Σ f_j = 1）
 *
 *   对偶问题：  max μ·c₀   s.t.  μ·c_j ≤ G_j  对所有 j
 *        —— 对偶变量 μ = (μ_A, μ_B, μ_C) 就是化学势；约束"μ·c ≤ G(c)"说明超平面 G = μ·c
 *           位于所有自由能面/点之下，即"公切面"。
 *   互补松弛：f_j > 0 ⇒ G_j = μ·c_j  —— 共存的相都在公切面上（化学势相等）。
 *   最优性：所有约化成本 r_j = G_j − μ·c_j ≥ 0  ⇔  驱动力 −r_j ≤ 0（没有相能自发析出）。
 *
 * 液相成分是连续变量：用"列生成"——每轮以当前 μ 求 min_x [G_L(x) − μ·x]（切面距离最小化），
 * 若为负则把该液相点加入候选列。收敛时得到精确的公切面与相组成。
 */

export interface GMinPhase {
  /** -1 液相 */
  si: number;
  id: string;
  frac: number;
  x: Comp;
}

export interface GMinIter {
  it: number;
  mu: Comp;
  G: number;
  entering: string;
  reducedCost: number;
  basis: string[];
}

export interface GMinResult {
  T: number;
  c0: Comp;
  phases: GMinPhase[];
  mu: Comp;
  G: number;
  iters: GMinIter[];
  /** 最小约化成本（≥ −tol 即满足对偶可行性 / 公切面在所有相之下） */
  minReducedCost: number;
  /** 各固相的约化成本（驱动力的相反数）；固溶体给出切面距离最小处的成分 x */
  solidReduced: { si: number; id: string; r: number; x: Comp }[];
  /** 液相切面距离的最小值及位置 */
  liquidTPD: { x: Comp; r: number };
  massResidual: number;
  converged: boolean;
}

interface Column {
  c: Comp;
  G: number;
  si: number;
  id: string;
}

const TOL = 1e-7;

/** 液相切面距离 φ(x) = G_L(x,T) − μ·x 的全局最小（栅格扫描 + 牛顿求精） */
export function liquidTPDmin(th: Thermo, mu: Comp, T: number, N = 40): { x: Comp; r: number } {
  return phaseTPDmin(th, -1, mu, T, N);
}

/** 任一连续相（液相 si = −1 或固溶体）切面距离 G_φ(y,T) − μ·y 的全局最小 */
export function phaseTPDmin(th: Thermo, si: number, mu: Comp, T: number, N = 40): { x: Comp; r: number } {
  const phi = (x: Comp) => th.Gphase(si, x, T) - (mu[0] * x[0] + mu[1] * x[1] + mu[2] * x[2]);
  const cands: { x: Comp; r: number }[] = [];
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N - i; j++) {
      const e = 1e-6;
      const x: Comp = [Math.max(e, i / N), Math.max(e, j / N), Math.max(e, (N - i - j) / N)];
      const s = x[0] + x[1] + x[2];
      x[0] /= s;
      x[1] /= s;
      x[2] /= s;
      cands.push({ x, r: phi(x) });
    }
  cands.sort((a, b) => a.r - b.r);
  let best = cands[0];
  for (const c0 of cands.slice(0, 4)) {
    const x = refine(th, si, mu, T, c0.x);
    const r = phi(x);
    if (r < best.r) best = { x, r };
  }
  return best;
}

/** 在 (x_B, x_C) 自变量上的阻尼牛顿：梯度 = μᴸ_B − μᴸ_A − (μ_B − μ_A) 等 */
function refine(th: Thermo, si: number, mu: Comp, T: number, x0: Comp): Comp {
  let y = [x0[1], x0[2]];
  const phi = (b: number, c: number) => {
    const x: Comp = [1 - b - c, b, c];
    if (x[0] <= 0 || b <= 0 || c <= 0) return Infinity;
    return th.Gphase(si, x, T) - (mu[0] * x[0] + mu[1] * b + mu[2] * c);
  };
  const grad = (b: number, c: number) => {
    const x: Comp = [1 - b - c, b, c];
    const m = th.muPhase(si, x, T)!;
    return [m[1] - m[0] - (mu[1] - mu[0]), m[2] - m[0] - (mu[2] - mu[0])];
  };
  for (let it = 0; it < 60; it++) {
    const g = grad(y[0], y[1]);
    if (Math.hypot(g[0], g[1]) < 1e-9) break;
    const h = 1e-7 * Math.max(1e-3, Math.min(y[0], y[1], 1 - y[0] - y[1]));
    const g1 = grad(y[0] + h, y[1]);
    const g2 = grad(y[0], y[1] + h);
    const H = [
      [(g1[0] - g[0]) / h, (g2[0] - g[0]) / h],
      [(g1[1] - g[1]) / h, (g2[1] - g[1]) / h],
    ];
    const D = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    let d = D > 0 && H[0][0] > 0 ? [(H[1][1] * g[0] - H[0][1] * g[1]) / D, (H[0][0] * g[1] - H[1][0] * g[0]) / D] : [g[0] * 1e-6, g[1] * 1e-6];
    // 保持在单纯形内部
    let step = 1;
    const f0 = phi(y[0], y[1]);
    for (let ls = 0; ls < 40; ls++) {
      const nb = y[0] - step * d[0];
      const nc = y[1] - step * d[1];
      if (nb > 0 && nc > 0 && nb + nc < 1 && phi(nb, nc) <= f0 + 1e-12) {
        y = [nb, nc];
        break;
      }
      step *= 0.5;
      if (ls === 39) d = [0, 0];
    }
    if (step < 1e-12) break;
  }
  return [1 - y[0] - y[1], y[0], y[1]];
}

export function minimizeGibbs(th: Thermo, cIn: Comp, T: number, opts?: { maxIter?: number }): GMinResult {
  // 成分在三角形的边或顶点上：平衡相中也不可能含缺失组元（f ≥ 0 且成分 ≥ 0），
  // 问题精确地退化为二元（或一元）问题 —— 缺失组元的化学势为 −∞。
  const act = [0, 1, 2].filter((i) => cIn[i] > 1e-9);
  if (act.length < 3) return minimizeOnFace(th, cIn, T, act);
  const c0 = cIn;
  // 连续相：液相 + 固溶体；化学计量相为固定的点
  const cont = [-1, ...th.solids.filter((s) => s.sol).map((s) => s.index)];
  const idOf = (si: number) => (si < 0 ? 'L' : th.solids[si].id);
  const cols: Column[] = th.solids.filter((s) => !s.sol).map((s) => ({ c: s.n, G: th.Gsol(s.index, T), si: s.index, id: s.id }));
  // 每个连续相加入三个顶点附近的列，保证存在单位阵初始基
  for (const si of cont)
    for (let k = 0; k < 3; k++) {
      const y: Comp = [1e-9, 1e-9, 1e-9];
      y[k] = 1 - 2e-9;
      cols.push({ c: y, G: th.Gphase(si, y, T), si, id: idOf(si) });
    }
  let basis = [0, 1, 2].map((k) => {
    let best = -1;
    cols.forEach((col, j) => {
      if (col.c[k] < 1 - 1e-6) return;
      if (best < 0 || col.G < cols[best].G) best = j;
    });
    return best;
  });
  const iters: GMinIter[] = [];
  let mu: Comp = [0, 0, 0];
  let f: number[] = [c0[0], c0[1], c0[2]];
  let converged = false;
  const maxIter = opts?.maxIter ?? 400;
  let goodBasis = basis.slice();
  for (let it = 0; it < maxIter; it++) {
    const B: Mat = transpose(basis.map((j) => cols[j].c)); // 3×3，列 = 基相成分
    const Bi = inverse(B);
    if (!Bi) {
      basis = goodBasis;
      break;
    }
    goodBasis = basis.slice();
    f = matVec(Bi, c0);
    // 对偶：Bᵀ μ = G_B
    const BiT = transpose(Bi);
    mu = matVec(BiT, basis.map((j) => cols[j].G)) as Comp;
    const Gtot = basis.reduce((s, j, k) => s + f[k] * cols[j].G, 0);
    // 定价：固定相点 + 各连续相的切面距离最小点
    let enter = -1;
    let rmin = -TOL;
    for (let j = 0; j < cols.length; j++) {
      if (basis.includes(j)) continue;
      const r = cols[j].G - (mu[0] * cols[j].c[0] + mu[1] * cols[j].c[1] + mu[2] * cols[j].c[2]);
      if (r < rmin) {
        rmin = r;
        enter = j;
      }
    }
    for (const si of cont) {
      const tp = phaseTPDmin(th, si, mu, T);
      if (tp.r < rmin) {
        cols.push({ c: tp.x, G: th.Gphase(si, tp.x, T), si, id: idOf(si) });
        enter = cols.length - 1;
        rmin = tp.r;
      }
    }
    iters.push({ it, mu: [...mu] as Comp, G: Gtot, entering: enter >= 0 ? cols[enter].id : '—', reducedCost: enter >= 0 ? rmin : 0, basis: basis.map((j) => cols[j].id) });
    if (enter < 0) {
      converged = true;
      break;
    }
    // 比值检验
    const dcol = matVec(Bi, cols[enter].c);
    // 主元容差取相对量：过小的主元会使新基近奇异
    const piv = 1e-9 * Math.max(...dcol.map(Math.abs));
    let leave = -1;
    let theta = Infinity;
    for (let k = 0; k < 3; k++) {
      if (dcol[k] > piv) {
        const q = Math.max(0, f[k]) / dcol[k];
        if (q < theta - 1e-14 || (Math.abs(q - theta) <= 1e-14 && leave >= 0 && basis[k] < basis[leave])) {
          theta = q;
          leave = k;
        }
      }
    }
    if (leave < 0) break; // 无界（不应发生：可行域有界）
    basis = basis.slice();
    basis[leave] = enter;
  }
  // 结果：合并同一连续相的邻近点（列生成收敛时它们趋于同一切点）
  const B: Mat = transpose(basis.map((j) => cols[j].c));
  const Bi = inverse(B) ?? inverse(transpose(goodBasis.map((j) => cols[j].c)))!;
  f = matVec(Bi, c0);
  const raw = basis.map((j, k) => ({ col: cols[j], frac: Math.max(0, f[k]) })).filter((p) => p.frac > 1e-10);
  const phases: GMinPhase[] = [];
  for (const p of raw) {
    const contP = th.isContinuous(p.col.si);
    const near = contP ? phases.find((q) => q.si === p.col.si && Math.hypot(q.x[0] - p.col.c[0], q.x[1] - p.col.c[1], q.x[2] - p.col.c[2]) < 2e-3) : undefined;
    if (near) {
      const w = near.frac + p.frac;
      near.x = [0, 1, 2].map((i) => (near.x[i] * near.frac + p.col.c[i] * p.frac) / w) as Comp;
      near.frac = w;
    } else phases.push({ si: p.col.si, id: p.col.id, frac: p.frac, x: p.col.c });
  }
  const s = phases.reduce((a, p) => a + p.frac, 0);
  phases.forEach((p) => (p.frac /= s));
  phases.sort((a, b) => a.si - b.si);
  const mix = [0, 0, 0];
  for (const p of phases) for (let i = 0; i < 3; i++) mix[i] += p.frac * p.x[i];
  // 各固相的约化成本：化学计量相 = G − μ·n；固溶体 = 切面距离的最小值
  const solidReduced = th.solids.map((sd) => {
    if (sd.sol) {
      const tp = phaseTPDmin(th, sd.index, mu, T);
      return { si: sd.index, id: sd.id, r: tp.r, x: tp.x };
    }
    return { si: sd.index, id: sd.id, r: th.Gsol(sd.index, T) - (mu[0] * sd.n[0] + mu[1] * sd.n[1] + mu[2] * sd.n[2]), x: sd.n };
  });
  const liquidTPD = phaseTPDmin(th, -1, mu, T);
  const G = phases.reduce((a, p) => a + p.frac * th.Gphase(p.si, p.x, T), 0);
  return {
    T,
    c0,
    phases,
    mu,
    G,
    iters,
    minReducedCost: Math.min(liquidTPD.r, ...solidReduced.map((r) => r.r)),
    solidReduced,
    liquidTPD,
    massResidual: Math.max(...mix.map((v, i) => Math.abs(v - c0[i]))),
    converged,
  };
}

/** 切面 μ·x；缺失组元的 μ = −∞ 时，只在该组元含量为 0 处有限（0·∞ 按 0 处理） */
export function planeAt(mu: Comp, x: Comp): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] === 0) continue;
    if (!Number.isFinite(mu[i])) return x[i] > 1e-12 ? -Infinity : s;
    s += mu[i] * x[i];
  }
  return s;
}

/** 给定化学势 μ（公切面），相 si（默认液相）的自由能面在该平面之上的高度（切面距离） */
export function tpdField(th: Thermo, mu: Comp, T: number, x: Comp, si = -1): number {
  return th.Gphase(si, x, T) - planeAt(mu, x);
}

/**
 * 边 / 顶点上的精确最小化：用二元下凸包与公切线（binary.ts）求解。
 * 返回的 μ 中缺失组元为 −∞；固相约化成本对不在该边上的相为 +∞（它们含缺失组元，不可能出现）。
 */
function minimizeOnFace(th: Thermo, cIn: Comp, T: number, act: number[]): GMinResult {
  const idOf = (si: number) => (si < 0 ? 'L' : th.solids[si].id);
  const mu: Comp = [-Infinity, -Infinity, -Infinity];
  const phases: GMinPhase[] = [];
  const cont = [-1, ...th.solids.filter((s) => s.sol).map((s) => s.index)];
  if (act.length <= 1) {
    const k = act[0] ?? 0;
    const v: Comp = [0, 0, 0];
    v[k] = 1;
    let best = { si: -1, G: Infinity };
    for (const si of cont) {
      const G = th.Gphase(si, v, T);
      if (G < best.G) best = { si, G };
    }
    for (const s of th.solids) if (!s.sol && s.n[k] > 1 - 1e-12 && th.Gsol(s.index, T) < best.G) best = { si: s.index, G: th.Gsol(s.index, T) };
    phases.push({ si: best.si, id: idOf(best.si), frac: 1, x: v });
    mu[k] = best.G;
  } else {
    const [i, j] = act as [0 | 1 | 2, 0 | 1 | 2];
    const curves = edgeCurves(th, i, j, T);
    const be = binaryEquilibrium(curves, T);
    const x = cIn[j] / (cIn[i] + cIn[j]);
    const comp = (t: number): Comp => {
      const c: Comp = [0, 0, 0];
      c[i] = 1 - t;
      c[j] = t;
      return c;
    };
    const siOf = (id: string) => (id === 'L' ? -1 : th.solids.find((q) => q.id === id)!.index);
    const tg = be.tangents.find((t) => x >= Math.min(t.xa, t.xb) - 1e-12 && x <= Math.max(t.xa, t.xb) + 1e-12 && Math.abs(t.xb - t.xa) > 1e-12);
    if (tg) {
      const fb = (x - tg.xa) / (tg.xb - tg.xa);
      phases.push({ si: siOf(tg.left), id: tg.left, frac: 1 - fb, x: comp(tg.xa) }, { si: siOf(tg.right), id: tg.right, frac: fb, x: comp(tg.xb) });
      mu[i] = tg.mu[0];
      mu[j] = tg.mu[1];
    } else {
      // 单相：取该成分处自由能最低的曲线（或恰好位于此处的化学计量相）
      let best: { c: (typeof curves)[number]; G: number } | null = null;
      for (const c of curves) {
        const G = c.point ? (Math.abs(c.point.x - x) < 1e-9 ? c.point.G : Infinity) : c.G!(Math.min(1 - 1e-12, Math.max(1e-12, x)));
        if (!best || G < best.G) best = { c, G };
      }
      const c = best!.c;
      phases.push({ si: siOf(c.id), id: c.id, frac: 1, x: comp(x) });
      if (c.G) {
        const xx = Math.min(1 - 1e-9, Math.max(1e-9, x));
        const h = 1e-7;
        const d1 = (c.G(Math.min(1 - 1e-12, xx + h)) - c.G(Math.max(1e-12, xx - h))) / (2 * h);
        mu[i] = best!.G - xx * d1;
        mu[j] = best!.G + (1 - xx) * d1;
      } else {
        mu[i] = best!.G;
        mu[j] = best!.G;
      }
    }
  }
  phases.forEach((p) => (p.frac = Math.max(0, p.frac)));
  phases.sort((a, b) => a.si - b.si);
  const G = phases.reduce((a, p) => a + p.frac * th.Gphase(p.si, p.x, T), 0);
  const mix = [0, 0, 0];
  for (const p of phases) for (let q = 0; q < 3; q++) mix[q] += p.frac * p.x[q];
  const onFace = (c: Comp) => [0, 1, 2].every((q) => act.includes(q) || c[q] < 1e-12);
  const planeAt = (c: Comp) => act.reduce((a, q) => a + mu[q] * c[q], 0);
  const solidReduced = th.solids.map((sd) => {
    if (!sd.sol) return { si: sd.index, id: sd.id, r: onFace(sd.n) ? th.Gsol(sd.index, T) - planeAt(sd.n) : Infinity, x: sd.n };
    return { si: sd.index, id: sd.id, r: faceMin(th, sd.index, act, planeAt, T).r, x: faceMin(th, sd.index, act, planeAt, T).x };
  });
  const liquidTPD = faceMin(th, -1, act, planeAt, T);
  return {
    T,
    c0: cIn,
    phases,
    mu,
    G,
    iters: [],
    minReducedCost: Math.min(liquidTPD.r, ...solidReduced.map((r) => r.r)),
    solidReduced,
    liquidTPD,
    massResidual: Math.max(...mix.map((v, q) => Math.abs(v - cIn[q]))),
    converged: true,
  };
}

/** 连续相在该边（或顶点）上的最小切面距离（一维扫描） */
function faceMin(th: Thermo, si: number, act: number[], planeAt: (c: Comp) => number, T: number): { x: Comp; r: number } {
  let best = { x: [1 / 3, 1 / 3, 1 / 3] as Comp, r: Infinity };
  const n = act.length === 1 ? 0 : 400;
  for (let k = 0; k <= n; k++) {
    const t = n ? Math.min(1 - 1e-9, Math.max(1e-9, k / n)) : 1;
    const c: Comp = [0, 0, 0];
    if (act.length === 1) c[act[0]] = 1;
    else {
      c[act[0]] = 1 - t;
      c[act[1]] = t;
    }
    const r = th.Gphase(si, c, T) - planeAt(c);
    if (r < best.r) best = { x: c, r };
  }
  return best;
}
