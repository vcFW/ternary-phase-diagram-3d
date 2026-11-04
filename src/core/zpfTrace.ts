import type { Thermo } from './thermo';
import { R } from './thermo';
import type { Comp } from './types';

/**
 * 两相区相界（零相分数线，ZPF）的连结线延拓。
 *
 * 固定 T 时，相 p 与相 q 共存的条件是各组元化学势相等：μ_p(y_p) = μ_q(y_q)（3 个方程）。
 * 两个连续相共 4 个成分自由度 ⇒ 解集为一维曲线（连结线族）；化学计量相 q（成分固定）时只剩 y_p 的 2 个自由度、
 * 1 个方程 G_q = n_q·μ_p(y_p) ⇒ 同样是一维曲线（饱和线）。
 *
 * 做法（Sundman 等的相图映射思想）：以下凸包给出的一条近似连结线为种子，用牛顿法精化为精确解，
 * 然后沿曲线做伪弧长延拓（预测 – 校正），直到：到达三角形边（二元系）、到达已知三相连结三角形的一条边、
 * 或两相成分趋同（临界点）。未知量取 softmax 对数比坐标（自动保证 y > 0、Σy = 1，近边界时仍稳定）。
 */

export type TraceEnd = 'edge' | 'triangle' | 'critical' | 'limit' | 'start';

export interface ZpfCurve {
  p: number;
  q: number;
  /** 相 p 一侧的相界（沿连结线族参数排列） */
  P: Comp[];
  /** 相 q 一侧的相界；q 为化学计量相时每点都是其固定成分 */
  Q: Comp[];
  ends: [TraceEnd, TraceEnd];
}

export interface TieTarget {
  P: Comp;
  Q: Comp;
}

const EDGE_TOL = 3e-4;
const CRIT_TOL = 1.5e-3;
const COMP_STEP = 0.01;

function soft(s1: number, s2: number): Comp {
  const m = Math.max(0, s1, s2);
  const e0 = Math.exp(-m);
  const e1 = Math.exp(s1 - m);
  const e2 = Math.exp(s2 - m);
  const t = e0 + e1 + e2;
  return [e0 / t, e1 / t, e2 / t];
}

function logRatio(y: Comp): [number, number] {
  const e = 1e-12;
  const a = Math.max(y[0], e);
  return [Math.log(Math.max(y[1], e) / a), Math.log(Math.max(y[2], e) / a)];
}

function det(M: number[][]): number {
  const n = M.length;
  if (n === 1) return M[0][0];
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

/** (m−1)×m 矩阵的零向量（余子式法），已归一化 */
function nullVec(J: number[][]): number[] | null {
  const m = J[0].length;
  const t: number[] = [];
  for (let k = 0; k < m; k++) {
    const sub = J.map((row) => row.filter((_, c) => c !== k));
    t.push((k % 2 === 0 ? 1 : -1) * det(sub));
  }
  const n = Math.hypot(...t);
  if (!(n > 1e-14) || !t.every(Number.isFinite)) return null;
  return t.map((v) => v / n);
}

function solveSq(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-300) return null;
    [M[p], M[k]] = [M[k], M[p]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
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

function dist3(a: Comp, b: Comp): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 把含量低于 tol 的组元置零并重新归一化（到达三角形边） */
function toEdge(y: Comp, tol: number): Comp {
  const z: Comp = [y[0] < tol ? 0 : y[0], y[1] < tol ? 0 : y[1], y[2] < tol ? 0 : y[2]];
  const s = z[0] + z[1] + z[2];
  return [z[0] / s, z[1] / s, z[2] / s];
}

/**
 * 在温度 T 下，从种子连结线（seedP 属于相 p，seedQ 属于相 q）出发追踪两相区相界。
 * p 必须是连续相（液相或固溶体）；q 可以是连续相或化学计量相。失败返回 null。
 */
export function traceTwoPhase(th: Thermo, p: number, q: number, T: number, seedP: Comp, seedQ: Comp, targets: TieTarget[]): ZpfCurve | null {
  const qCont = th.isContinuous(q);
  const m = qCont ? 4 : 2;
  const RT = R * T;
  const nq = qCont ? null : th.solids[q].n;
  const Gq = qCont ? 0 : th.Gphase(q, th.solids[q].n, T);

  const split = (z: number[]): { yp: Comp; yq: Comp } => ({ yp: soft(z[0], z[1]), yq: qCont ? soft(z[2], z[3]) : nq! });
  const resid = (z: number[]): number[] | null => {
    const { yp, yq } = split(z);
    const mp = th.muPhase(p, yp, T);
    if (!mp) return null;
    if (qCont) {
      const mq = th.muPhase(q, yq, T);
      if (!mq) return null;
      return [(mp[0] - mq[0]) / RT, (mp[1] - mq[1]) / RT, (mp[2] - mq[2]) / RT];
    }
    return [(Gq - (nq![0] * mp[0] + nq![1] * mp[1] + nq![2] * mp[2])) / RT];
  };
  const jac = (z: number[], r: number[]): number[][] | null => {
    const J: number[][] = r.map(() => new Array(m).fill(0));
    const h = 1e-7;
    for (let c = 0; c < m; c++) {
      const zp = z.slice();
      zp[c] += h;
      const rp = resid(zp);
      if (!rp) return null;
      for (let k = 0; k < r.length; k++) J[k][c] = (rp[k] - r[k]) / h;
    }
    return J;
  };
  const rn = (r: number[]) => Math.hypot(...r);

  /** 牛顿校正：附加约束 c·(z − z0) = 0（c 为固定的方向向量），返回收敛的 z */
  const correct = (zStart: number[], c: number[], zRef: number[], maxIt = 12): number[] | null => {
    let z = zStart.slice();
    for (let it = 0; it < maxIt; it++) {
      const r = resid(z);
      if (!r) return null;
      const g = c.reduce((s, ci, i) => s + ci * (z[i] - zRef[i]), 0);
      if (rn(r) < 1e-12 && Math.abs(g) < 1e-12) return z;
      const J = jac(z, r);
      if (!J) return null;
      const A = [...J, c];
      const dz = solveSq(A, [...r, g].map((v) => -v));
      if (!dz) return null;
      let step = 1;
      const nr0 = rn(r);
      let ok = false;
      for (let ls = 0; ls < 20; ls++) {
        const zn = z.map((v, i) => v + step * dz[i]);
        const rr = resid(zn);
        if (rr && Number.isFinite(rn(rr)) && (rn(rr) < nr0 * 1.5 + 1e-12 || it === 0)) {
          z = zn;
          ok = true;
          break;
        }
        step *= 0.5;
      }
      if (!ok) return null;
    }
    const r = resid(z);
    return r && rn(r) < 1e-10 ? z : null;
  };

  // 种子：固定第 0 个坐标，牛顿解出一点
  // 种子位于三角形边上（二元系的两相线）：该簇由内部的连结线族覆盖，不单独追踪
  if (Math.min(...seedP) < 1e-6 && (!qCont || Math.min(...seedQ) < 1e-6)) return null;
  const z0 = [...logRatio(seedP), ...(qCont ? logRatio(seedQ) : [])];
  const fixC = new Array(m).fill(0);
  fixC[0] = 1;
  let seed = correct(z0, fixC, z0, 40);
  if (!seed) {
    // 换固定坐标再试
    const alt = new Array(m).fill(0);
    alt[m - 1] = 1;
    seed = correct(z0, alt, z0, 40);
  }
  if (!seed) return null;
  {
    const { yp, yq } = split(seed);
    if (qCont && dist3(yp, yq) < CRIT_TOL && p === q) return null; // 平凡解
  }

  const walk = (dir: 1 | -1): { P: Comp[]; Q: Comp[]; end: TraceEnd } => {
    const P: Comp[] = [];
    const Q: Comp[] = [];
    let z = seed!;
    let t: number[] | null = null;
    let ds = 0.05;
    let end: TraceEnd = 'limit';
    const sd = split(seed!);
    let bestTarget = targets.length ? Math.min(...targets.map((tg) => dist3(sd.yp, tg.P) + dist3(sd.yq, tg.Q))) : Infinity;
    if (bestTarget >= 0.05) bestTarget = Infinity;
    let approached = false;
    let travelled = 0;
    for (let step = 0; step < 700; step++) {
      const r = resid(z);
      if (!r) break;
      const J = jac(z, r);
      if (!J) break;
      const tn = nullVec(J);
      if (!tn) break;
      // 方向：首步按 dir，之后与上一步切向保持同向
      let tt = tn;
      if (t) {
        if (tn.reduce((s, v, i) => s + v * t![i], 0) < 0) tt = tn.map((v) => -v);
      } else if (dir < 0) tt = tn.map((v) => -v);
      t = tt;
      let accepted: number[] | null = null;
      for (let tries = 0; tries < 14; tries++) {
        const zp = z.map((v, i) => v + ds * tt[i]);
        const zc = correct(zp, tt, zp, 8);
        if (zc) {
          const a = split(z);
          const b = split(zc);
          const dc = dist3(a.yp, b.yp) + dist3(a.yq, b.yq);
          if (dc <= 4 * COMP_STEP || tries === 13) {
            accepted = zc;
            // 步长自适应：让成分空间的步长接近 COMP_STEP
            const near = targets.length ? Math.min(...targets.map((tg) => dist3(b.yp, tg.P) + dist3(b.yq, tg.Q))) : Infinity;
            const goal = near < 0.05 ? 0.003 : COMP_STEP;
            ds *= Math.min(2, Math.max(0.4, goal / Math.max(dc, 1e-9)));
            ds = Math.min(0.6, Math.max(1e-5, ds));
            travelled += dc;
            break;
          }
        }
        ds *= 0.5;
        if (ds < 1e-7) break;
      }
      if (!accepted) break;
      z = accepted;
      const { yp, yq } = split(z);
      P.push(yp);
      Q.push(yq);
      // 终止：三角形边（二元系）
      if (Math.min(...yp) < EDGE_TOL && (!qCont || Math.min(...yq) < EDGE_TOL)) {
        P[P.length - 1] = toEdge(yp, EDGE_TOL);
        if (qCont) Q[Q.length - 1] = toEdge(yq, EDGE_TOL);
        end = 'edge';
        break;
      }
      // 终止：临界点
      if (qCont && dist3(yp, yq) < CRIT_TOL) {
        end = 'critical';
        break;
      }
      // 终止：到达已知三相连结三角形的一条边
      let hit: TieTarget | null = null;
      let nearest = Infinity;
      for (const tg of targets) {
        const dd = dist3(yp, tg.P) + dist3(yq, tg.Q);
        if (dd < nearest) {
          nearest = dd;
          hit = tg;
        }
      }
      if (hit && nearest < 0.05) {
        // 只有"先靠近、后远离"或已足够近才算到达；一开始就在远离目标则继续走
        if (Number.isFinite(bestTarget) && nearest < bestTarget - 1e-9) approached = true;
        const closing = !Number.isFinite(bestTarget) || nearest <= bestTarget + 1e-9;
        if ((nearest < 0.0045 && closing) || (approached && nearest > bestTarget + 1e-9)) {
          P[P.length - 1] = hit.P;
          Q[Q.length - 1] = hit.Q;
          end = 'triangle';
          break;
        }
        bestTarget = nearest;
      } else {
        bestTarget = Infinity;
        approached = false;
      }
      if (travelled > 8) break;
    }
    return { P, Q, end };
  };

  const fwd = walk(1);
  const bwd = walk(-1);
  const s0 = split(seed);
  const P = [...bwd.P.reverse(), s0.yp, ...fwd.P];
  const Q = [...bwd.Q.reverse(), s0.yq, ...fwd.Q];
  if (P.length < 3) return null;
  return { p, q, P, Q, ends: [bwd.end, fwd.end] };
}
