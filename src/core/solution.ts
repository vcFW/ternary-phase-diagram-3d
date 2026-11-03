import { R, argmaxY, type Thermo } from './thermo';
import type { Comp, Equilibrium, PhaseAmount } from './types';

/**
 * 含固溶体体系的通用平衡求解器（吉布斯能全局最小化）。
 *
 *  1. 全局阶段：每个连续相（液相、固溶体）在成分三角形上取 N 级网格点，化学计量相取单点；
 *     在这些"候选相点"上解线性规划  min Σ f_j G_j  s.t.  Σ f_j c_j = x₀,  f ≥ 0
 *     —— 其最优解即离散化自由能面的下凸包，对偶变量为化学势 μ（公切面）。
 *  2. 精化阶段：以 LP 给出的相组合为初值，牛顿法精确求解 KKT 方程组
 *        μ_φ(y_φ) = μ（连续相，每相 3 式）， G_s = μ·n_s（化学计量相，1 式）， Σ f_φ y_φ = x₀（3 式）
 *     未知量 μ(3) + 每个连续相成分(2) + 每相分数(1)，方程数与未知数相等。
 *  3. 稳定性检验：对每个相求 min_y [G_φ(y) − μ·y]（切面距离），若有负值则加入该点重新求解。
 *
 * 由于本模型中每个相的 G 对 T 是线性的，G_j(T) = H_j − T·S_j 在网格点上预先算好，各温度复用。
 */

interface Col {
  si: number;
  y: Comp;
  H: number;
  S: number;
}

interface Ph {
  si: number;
  y: Comp;
  f: number;
}

export interface SolEq extends Equilibrium {
  mu: Comp;
}

const EPS_Y = 1e-12;

export class SolutionEngine {
  readonly th: Thermo;
  readonly N: number;
  private cols: Col[] = [];
  /** 连续相列表（-1 为液相） */
  readonly cont: number[];
  private lastKey = '';
  private last: SolEq | null = null;

  constructor(th: Thermo, N = 40) {
    this.th = th;
    this.N = N;
    this.cont = [-1, ...th.solids.filter((s) => s.sol).map((s) => s.index)];
    for (const si of this.cont) {
      for (let i = 0; i <= N; i++)
        for (let j = 0; j <= N - i; j++) {
          const y = clampY([i / N, j / N, (N - i - j) / N]);
          this.cols.push(this.mkCol(si, y));
        }
    }
    for (const s of th.solids) if (!s.sol) this.cols.push({ si: s.index, y: s.n, H: s.dHf, S: s.dSf });
  }

  private mkCol(si: number, y: Comp): Col {
    const G1 = this.th.Gphase(si, y, 1000);
    const G2 = this.th.Gphase(si, y, 2000);
    const S = -(G2 - G1) / 1000;
    return { si, y, H: G1 + 1000 * S, S };
  }

  // ---------------------------------------------------------------- 全局：线性规划（单纯形，全定价）
  private lp(x0: Comp, T: number, extra: Col[]): { phases: Ph[]; mu: Comp } {
    const cols = extra.length ? this.cols.concat(extra) : this.cols;
    const nC = cols.length;
    const Gc = new Float64Array(nC);
    for (let j = 0; j < nC; j++) Gc[j] = cols[j].H - T * cols[j].S;
    // 初始基：每个顶点处 G 最低的列（网格包含顶点附近的点）
    const basis = [0, 1, 2].map((k) => {
      let best = -1;
      for (let j = 0; j < nC; j++) {
        if (cols[j].y[k] < 1 - 1e-6) continue;
        if (best < 0 || Gc[j] < Gc[best]) best = j;
      }
      return best;
    });
    if (basis.some((b) => b < 0)) throw new Error('网格缺少顶点列');
    let f: number[] = [0, 0, 0];
    let mu: Comp = [0, 0, 0];
    for (let it = 0; it < 500; it++) {
      const B = [0, 1, 2].map((r) => basis.map((j) => cols[j].y[r])); // 3×3，列 = 基相成分
      const Bi = inv3(B);
      if (!Bi) break;
      f = mv(Bi, x0);
      mu = mv(transpose3(Bi), basis.map((j) => Gc[j])) as Comp;
      let enter = -1;
      let rmin = -1e-9;
      for (let j = 0; j < nC; j++) {
        const c = cols[j].y;
        const r = Gc[j] - (mu[0] * c[0] + mu[1] * c[1] + mu[2] * c[2]);
        if (r < rmin) {
          rmin = r;
          enter = j;
        }
      }
      if (enter < 0 || basis.includes(enter)) break;
      const dcol = mv(Bi, cols[enter].y);
      let leave = -1;
      let theta = Infinity;
      for (let k = 0; k < 3; k++)
        if (dcol[k] > 1e-12) {
          const q = Math.max(0, f[k]) / dcol[k];
          if (q < theta - 1e-15) {
            theta = q;
            leave = k;
          }
        }
      if (leave < 0) break;
      basis[leave] = enter;
    }
    // 聚类：同一连续相的相邻网格点合并为一个相（相距较远则视为溶解度间隙中的两个相）
    const raw = basis.map((j, k) => ({ col: cols[j], f: f[k] })).filter((p) => p.f > 1e-12);
    const phases: Ph[] = [];
    const tol = 3.5 / this.N;
    for (const p of raw) {
      const near = phases.find((q) => q.si === p.col.si && this.th.isContinuous(q.si) && dist(q.y, p.col.y) < tol);
      if (near) {
        const w = near.f + p.f;
        near.y = [0, 1, 2].map((i) => (near.y[i] * near.f + p.col.y[i] * p.f) / w) as Comp;
        near.f = w;
      } else phases.push({ si: p.col.si, y: p.col.y, f: p.f });
    }
    return { phases, mu };
  }

  // ---------------------------------------------------------------- 精化：KKT 牛顿法
  /** 返回精化后的相与 μ；失败返回 null */
  polish(x0: Comp, T: number, init: Ph[], mu0: Comp): { phases: Ph[]; mu: Comp; res: number } | null {
    const th = this.th;
    const RT = R * T;
    const P = init.length;
    const contIdx = init.map((p) => th.isContinuous(p.si));
    // 未知量：m = μ/RT (3)；连续相成分取对数比 s = (ln(y_B/y_A), ln(y_C/y_A))（softmax 参数化：
    // 自动满足 y > 0、Σy = 1，且 μ ≈ RT·ln y 对 s 近似线性，牛顿法在极稀成分处也稳定）；各相 f
    const pack = (phs: Ph[], mu: Comp): number[] => {
      const z = [mu[0] / RT, mu[1] / RT, mu[2] / RT];
      phs.forEach((p, k) => {
        if (!contIdx[k]) return;
        const y = clampY(p.y);
        z.push(Math.log(y[1] / y[0]), Math.log(y[2] / y[0]));
      });
      phs.forEach((p) => z.push(p.f));
      return z;
    };
    const unpack = (z: number[]): { phs: Ph[]; mu: Comp } | null => {
      const mu: Comp = [z[0] * RT, z[1] * RT, z[2] * RT];
      let o = 3;
      const ys: Comp[] = [];
      for (let k = 0; k < P; k++) {
        if (contIdx[k]) {
          const s1 = z[o++];
          const s2 = z[o++];
          const m = Math.max(0, s1, s2);
          const e0 = Math.exp(-m);
          const e1 = Math.exp(s1 - m);
          const e2 = Math.exp(s2 - m);
          const t = e0 + e1 + e2;
          const y: Comp = [e0 / t, e1 / t, e2 / t];
          if (!(y[0] > 0 && y[1] > 0 && y[2] > 0)) return null;
          ys.push(y);
        } else ys.push(this.th.solids[init[k].si].n);
      }
      const phs = init.map((p, k) => ({ si: p.si, y: ys[k], f: z[o + k] }));
      return { phs, mu };
    };
    const resid = (z: number[]): number[] | null => {
      const u = unpack(z);
      if (!u) return null;
      const r: number[] = [];
      u.phs.forEach((p, k) => {
        if (contIdx[k]) {
          const m = th.muPhase(p.si, p.y, T)!;
          for (let i = 0; i < 3; i++) r.push((m[i] - u.mu[i]) / RT);
        } else {
          const n = p.y;
          r.push((th.Gphase(p.si, n, T) - (u.mu[0] * n[0] + u.mu[1] * n[1] + u.mu[2] * n[2])) / RT);
        }
      });
      for (let i = 0; i < 3; i++) r.push(u.phs.reduce((s, p) => s + p.f * p.y[i], 0) - x0[i]);
      return r;
    };
    let z = pack(init, mu0);
    let r = resid(z);
    if (!r) return null;
    const nz = z.length;
    if (r.length !== nz) return null;
    let nr = norm(r);
    for (let it = 0; it < 60 && nr > 1e-13; it++) {
      const J: number[][] = Array.from({ length: nz }, () => new Array(nz).fill(0));
      for (let c = 0; c < nz; c++) {
        const h = c < 3 + 2 * contIdx.filter(Boolean).length ? 1e-7 : 1e-9 * Math.max(1e-3, Math.abs(z[c]));
        const zp = z.slice();
        zp[c] += h;
        let rp = resid(zp);
        let hh = h;
        if (!rp) {
          zp[c] = z[c] - h;
          rp = resid(zp);
          hh = -h;
        }
        if (!rp) return null;
        for (let k = 0; k < nz; k++) J[k][c] = (rp[k] - r[k]) / hh;
      }
      const dz = solveDense(J, r.map((v) => -v));
      if (!dz) return null;
      let step = 1;
      let ok = false;
      for (let ls = 0; ls < 40; ls++) {
        const zn = z.map((v, k) => v + step * dz[k]);
        const rn = resid(zn);
        if (rn && norm(rn) < nr * (1 - 1e-4 * step)) {
          z = zn;
          r = rn;
          nr = norm(rn);
          ok = true;
          break;
        }
        step *= 0.5;
      }
      if (!ok) break;
    }
    if (!(nr < 1e-8)) return null;
    const u = unpack(z)!;
    return { phases: u.phs, mu: u.mu, res: nr };
  }

  // ---------------------------------------------------------------- 稳定性检验
  /** 各相相对公切面的最小高度（切面距离）及其位置；负值 ⇒ 该相可以析出，当前解不是平衡 */
  tpd(mu: Comp, T: number): { si: number; y: Comp; r: number }[] {
    const th = this.th;
    const out: { si: number; y: Comp; r: number }[] = [];
    for (const si of this.cont) {
      let best = Infinity;
      let by: Comp = [1 / 3, 1 / 3, 1 / 3];
      for (const c of this.cols) {
        if (c.si !== si) continue;
        const v = c.H - T * c.S - (mu[0] * c.y[0] + mu[1] * c.y[1] + mu[2] * c.y[2]);
        if (v < best) {
          best = v;
          by = c.y;
        }
      }
      // 局部精化：max_y [μ·y − G(y)] 的不动点
      const p = si < 0 ? liqRegParams(th) : th.solids[si].sol!;
      const y = clampY(argmaxY(p, mu, T, by));
      const r = th.Gphase(si, y, T) - (mu[0] * y[0] + mu[1] * y[1] + mu[2] * y[2]);
      out.push(r < best ? { si, y, r } : { si, y: by, r: best });
    }
    for (const s of th.solids)
      if (!s.sol) out.push({ si: s.index, y: s.n, r: th.Gphase(s.index, s.n, T) - (mu[0] * s.n[0] + mu[1] * s.n[1] + mu[2] * s.n[2]) });
    return out;
  }

  // ---------------------------------------------------------------- 对外接口
  equilibrium(xIn: Comp, T: number, hint?: Equilibrium | null): SolEq {
    const x0 = clampY(xIn);
    const key = `${x0.map((v) => v.toFixed(12)).join(',')}`;
    const h = hint && (hint as SolEq).mu ? (hint as SolEq) : this.lastKey === key ? this.last : null;
    let res: SolEq | null = null;
    if (h) res = this.local(x0, T, h);
    if (!res) res = this.global(x0, T);
    this.lastKey = key;
    this.last = res;
    return res;
  }

  /** 由提示解（相组合与成分）出发的局部求解；失败返回 null */
  private local(x0: Comp, T: number, h: SolEq): SolEq | null {
    const init: Ph[] = h.phases.map((p) => ({ si: p.si, y: p.x, f: p.frac }));
    const r = this.refine(x0, T, init, h.mu);
    return r ? this.mk(r.phases, r.mu, T) : null;
  }

  private global(x0: Comp, T: number): SolEq {
    const extra: Col[] = [];
    let last: { phases: Ph[]; mu: Comp } | null = null;
    for (let round = 0; round < 4; round++) {
      const lp = this.lp(x0, T, extra);
      last = lp;
      const r = this.refine(x0, T, lp.phases, lp.mu);
      if (r) return this.mk(r.phases, r.mu, T);
      // 精化失败：加密候选列后重试
      for (const t of this.tpd(lp.mu, T)) if (this.th.isContinuous(t.si)) extra.push(this.mkCol(t.si, t.y));
    }
    return this.mk(last!.phases, last!.mu, T);
  }

  /**
   * 相组合的增删迭代（标准的吉布斯能最小化"加相 / 去相"步骤）：
   *   · 精化后若某相分数 < 0 ⇒ 去掉该相；
   *   · 若某相的切面距离 < 0 ⇒ 以其最有利成分、很小的分数加入该相。
   * 每一步都用 KKT 牛顿法精确求解，直至所有分数 ≥ 0 且所有相都不在公切面之下。
   */
  private refine(x0: Comp, T: number, start: Ph[], mu0: Comp): { phases: Ph[]; mu: Comp } | null {
    let phs = start;
    let mu = mu0;
    for (let it = 0; it < 12; it++) {
      const pol = this.polish(x0, T, phs, mu);
      if (!pol) {
        if (phs.length <= 1) return null;
        // 去掉分数最小的相再试
        const k = phs.reduce((b, p, i) => (p.f < phs[b].f ? i : b), 0);
        phs = phs.filter((_, i) => i !== k);
        continue;
      }
      const neg = pol.phases.map((p, i) => ({ p, i })).filter((q) => q.p.f < -1e-10);
      if (neg.length) {
        const k = neg.reduce((b, q) => (q.p.f < b.p.f ? q : b)).i;
        phs = pol.phases.filter((_, i) => i !== k).map((p) => ({ ...p, f: Math.max(1e-6, p.f) }));
        mu = pol.mu;
        continue;
      }
      const tp = this.tpd(pol.mu, T)
        .filter((t) => t.r < -1e-7)
        .filter((t) => !pol.phases.some((p) => p.si === t.si && dist(p.y, t.y) < 0.02))
        .sort((a, b) => a.r - b.r);
      if (!tp.length) return { phases: pol.phases, mu: pol.mu };
      const add = tp[0];
      let next: Ph[] = [...pol.phases.map((p) => ({ ...p, f: p.f * (1 - 1e-3) })), { si: add.si, y: add.y, f: 1e-3 }];
      if (next.length > 3) {
        // 恒温下一般不超过 3 相共存：去掉分数最小的旧相
        const k = pol.phases.reduce((b, p, i) => (p.f < pol.phases[b].f ? i : b), 0);
        next = next.filter((_, i) => i !== k);
      }
      phs = next;
      mu = pol.mu;
    }
    return null;
  }

  private mk(phs: Ph[], mu: Comp, T: number): SolEq {
    const th = this.th;
    const kept = phs.filter((p) => p.f > 1e-12);
    const s = kept.reduce((a, p) => a + p.f, 0);
    const phases: PhaseAmount[] = kept
      .map((p) => ({ si: p.si, id: p.si < 0 ? 'L' : th.solids[p.si].id, frac: p.f / s, x: p.y }))
      .sort((a, b) => a.si - b.si);
    const G = phases.reduce((a, p) => a + p.frac * th.Gphase(p.si, p.x, T), 0);
    return { phases, key: phases.map((p) => p.id).join('+'), dof: 4 - phases.length, G, mu };
  }
}

export function liqRegParams(th: Thermo) {
  const c = th.p.components;
  const o = th.p.omega;
  return { a: [c[0].dH, c[1].dH, c[2].dH] as Comp, b: [c[0].dH / c[0].Tm, c[1].dH / c[1].Tm, c[2].dH / c[2].Tm] as Comp, om: [o.AB, o.AC, o.BC] as Comp };
}

// ------------------------------------------------------------------ 小工具
export function clampY(y: Comp): Comp {
  const a = Math.max(EPS_Y, y[0]);
  const b = Math.max(EPS_Y, y[1]);
  const c = Math.max(EPS_Y, y[2]);
  const s = a + b + c;
  return [a / s, b / s, c / s];
}
function dist(a: Comp, b: Comp) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function norm(v: number[]) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}
function mv(M: number[][], v: number[]): number[] {
  return M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
}
function transpose3(M: number[][]): number[][] {
  return [0, 1, 2].map((i) => [M[0][i], M[1][i], M[2][i]]);
}
function inv3(M: number[][]): number[][] | null {
  const [a, b, c] = M;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-14) return null;
  const i = 1 / det;
  return [
    [(b[1] * c[2] - b[2] * c[1]) * i, (a[2] * c[1] - a[1] * c[2]) * i, (a[1] * b[2] - a[2] * b[1]) * i],
    [(b[2] * c[0] - b[0] * c[2]) * i, (a[0] * c[2] - a[2] * c[0]) * i, (a[2] * b[0] - a[0] * b[2]) * i],
    [(b[0] * c[1] - b[1] * c[0]) * i, (a[1] * c[0] - a[0] * c[1]) * i, (a[0] * b[1] - a[1] * b[0]) * i],
  ];
}
function solveDense(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-300) return null;
    [M[p], M[k]] = [M[k], M[p]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}
