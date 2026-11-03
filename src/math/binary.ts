import type { Thermo } from '../core/thermo';
import type { Comp } from '../core/types';
import { R } from '../core/thermo';

/**
 * 二元自由能曲线与公切线。
 *
 * 二元系（组元 1、2，x = x₂）中，两相 α、β 平衡 ⇔ 存在一条直线同时与 G_α(x)、G_β(x) 相切：
 *     G_α'(x_α) = G_β'(x_β) = (G_β(x_β) − G_α(x_α)) / (x_β − x_α)
 * 等价地，该切线在 x = 0 与 x = 1 的截距相等，截距即化学势 μ₁、μ₂：
 *     μ₁ = G − x G',   μ₂ = G + (1 − x) G'     ⇒   μ₁^α = μ₁^β,  μ₂^α = μ₂^β。
 * 一般方法：平衡态 = 所有相自由能曲线（点）的下凸包；凸包上跨越"空隙"的线段就是公切线。
 */

export interface Curve1 {
  id: string;
  /** 化学计量相为单点 */
  point?: { x: number; G: number };
  G?: (x: number) => number;
  /** 一阶导数（解析或数值） */
  dG?: (x: number) => number;
  color?: string;
}

export interface HullSeg {
  /** 左右端点所属相与成分 */
  a: { id: string; x: number; G: number };
  b: { id: string; x: number; G: number };
  /** 公切线 μ₁、μ₂（截距） */
  mu: [number, number];
  /** true：两端属于不同相（两相区）；false：同一相曲线上（单相区） */
  twoPhase: boolean;
}

/** 下凸包（Andrew 单调链），返回相邻凸包顶点构成的线段 */
export function lowerHull(curves: Curve1[], N = 600): HullSeg[] {
  const pts: { x: number; G: number; id: string; k: number }[] = [];
  for (const c of curves) {
    if (c.point) pts.push({ x: c.point.x, G: c.point.G, id: c.id, k: -1 });
    else if (c.G)
      for (let k = 0; k <= N; k++) {
        const x = Math.min(1 - 1e-9, Math.max(1e-9, k / N));
        pts.push({ x, G: c.G(x), id: c.id, k });
      }
  }
  pts.sort((p, q) => p.x - q.x || p.G - q.G);
  const H: typeof pts = [];
  let lastX = NaN;
  for (const p of pts) {
    // 同一成分处只有最低的点可能在下凸包上（避免零宽度的伪线段）
    if (Math.abs(p.x - lastX) < 1e-12) continue;
    lastX = p.x;
    while (H.length >= 2) {
      const a = H[H.length - 2];
      const b = H[H.length - 1];
      const cr = (b.x - a.x) * (p.G - a.G) - (b.G - a.G) * (p.x - a.x);
      if (cr <= 0) H.pop();
      else break;
    }
    H.push(p);
  }
  const segs: HullSeg[] = [];
  const gap = 2.5 / N;
  for (let i = 0; i < H.length - 1; i++) {
    const a = H[i];
    const b = H[i + 1];
    const same = a.id === b.id && a.k >= 0 && b.k >= 0 && b.x - a.x < gap;
    const slope = (b.G - a.G) / (b.x - a.x || 1e-300);
    const mu: [number, number] = [a.G - a.x * slope, a.G + (1 - a.x) * slope];
    segs.push({ a: { id: a.id, x: a.x, G: a.G }, b: { id: b.id, x: b.x, G: b.G }, mu, twoPhase: !same });
  }
  // 合并连续的单相小段
  const out: HullSeg[] = [];
  for (const s of segs) {
    const l = out[out.length - 1];
    if (l && !l.twoPhase && !s.twoPhase && l.a.id === s.a.id) {
      l.b = s.b;
    } else out.push({ ...s });
  }
  return out;
}

/** 公切线精化：曲线–曲线（牛顿法解截距相等）或 点–曲线（切线过定点） */
export function refineTangent(A: Curve1, B: Curve1, xa0: number, xb0: number): { xa: number; xb: number; mu: [number, number]; residual: number } | null {
  const d = (c: Curve1, x: number) => (c.dG ? c.dG(x) : (c.G!(x + 1e-7) - c.G!(x - 1e-7)) / 2e-7);
  const mu = (c: Curve1, x: number): [number, number] => {
    if (c.point) return [NaN, NaN];
    const g = c.G!(x);
    const s = d(c, x);
    return [g - x * s, g + (1 - x) * s];
  };
  if (A.point && B.point) return null;
  if (A.point || B.point) {
    const P = (A.point ?? B.point)!;
    const C = A.point ? B : A;
    // 解 G_C(x) + G_C'(x)(xp − x) = Gp
    let x = A.point ? xb0 : xa0;
    for (let it = 0; it < 80; it++) {
      const f = C.G!(x) + d(C, x) * (P.x - x) - P.G;
      const h = 1e-7;
      const f2 = C.G!(x + h) + d(C, x + h) * (P.x - x - h) - P.G;
      const df = (f2 - f) / h;
      if (!Number.isFinite(df) || df === 0) break;
      let nx = x - f / df;
      nx = Math.min(1 - 1e-12, Math.max(1e-12, nx));
      if (Math.abs(nx - x) < 1e-14) {
        x = nx;
        break;
      }
      x = nx;
    }
    const m = mu(C, x);
    const res = Math.abs(C.G!(x) + d(C, x) * (P.x - x) - P.G);
    return A.point ? { xa: P.x, xb: x, mu: m, residual: res } : { xa: x, xb: P.x, mu: m, residual: res };
  }
  let xa = xa0;
  let xb = xb0;
  const F = (u: number, v: number) => {
    const ma = mu(A, u);
    const mb = mu(B, v);
    return [ma[0] - mb[0], ma[1] - mb[1]];
  };
  for (let it = 0; it < 100; it++) {
    const f = F(xa, xb);
    if (Math.abs(f[0]) + Math.abs(f[1]) < 1e-10) break;
    const h = 1e-8;
    const fa = F(xa + h, xb);
    const fb = F(xa, xb + h);
    const J = [
      [(fa[0] - f[0]) / h, (fb[0] - f[0]) / h],
      [(fa[1] - f[1]) / h, (fb[1] - f[1]) / h],
    ];
    const D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(D) < 1e-300) break;
    let da = (J[1][1] * f[0] - J[0][1] * f[1]) / D;
    let db = (J[0][0] * f[1] - J[1][0] * f[0]) / D;
    const m = Math.max(Math.abs(da), Math.abs(db));
    if (m > 0.05) {
      da *= 0.05 / m;
      db *= 0.05 / m;
    }
    xa = Math.min(1 - 1e-12, Math.max(1e-12, xa - da));
    xb = Math.min(1 - 1e-12, Math.max(1e-12, xb - db));
  }
  const f = F(xa, xb);
  return { xa, xb, mu: mu(A, xa), residual: Math.hypot(f[0], f[1]) };
}

export interface BinaryEquilibrium {
  T: number;
  segs: HullSeg[];
  /** 精化后的两相区（公切线） */
  tangents: { left: string; right: string; xa: number; xb: number; mu: [number, number]; residual: number }[];
}

export function binaryEquilibrium(curves: Curve1[], T: number): BinaryEquilibrium {
  const segs = lowerHull(curves);
  const tangents: BinaryEquilibrium['tangents'] = [];
  for (const s of segs) {
    if (!s.twoPhase) continue;
    const A = curves.find((c) => c.id === s.a.id)!;
    const B = curves.find((c) => c.id === s.b.id)!;
    if (A === B && A.G) {
      // 同一曲线上的两点（溶解度间隙）
      const r = refineTangent(A, { ...A }, s.a.x, s.b.x);
      if (r) tangents.push({ left: A.id, right: B.id, ...r });
      continue;
    }
    if (A.point && B.point) {
      tangents.push({ left: A.id, right: B.id, xa: A.point.x, xb: B.point.x, mu: s.mu, residual: 0 });
      continue;
    }
    const r = refineTangent(A, B, s.a.x, s.b.x);
    // 牛顿法未收敛（残差 > 0.1 J/mol）的候选不是真正的公切线
    if (r && r.residual < 0.1) tangents.push({ left: A.id, right: B.id, ...r });
  }
  return { T, segs, tangents };
}

// ------------------------------------------------------------ 三元模型的二元边

/** 三元模型限制在 i–j 边上：x = x_j，液相曲线 + 位于该边上的化学计量固相 */
export function edgeCurves(th: Thermo, i: 0 | 1 | 2, j: 0 | 1 | 2, T: number): Curve1[] {
  const comp = (x: number): Comp => {
    const c: Comp = [0, 0, 0];
    c[i] = 1 - x;
    c[j] = x;
    return c;
  };
  const out: Curve1[] = [{ id: 'L', G: (x) => th.Gliq(comp(x), T) }];
  for (const s of th.solids) {
    const k = 3 - i - j;
    if (s.sol) {
      // 固溶体：在该二元边上是一条自由能曲线
      out.push({ id: s.id, G: (x) => th.Gphase(s.index, comp(x), T) });
      continue;
    }
    if (s.n[k] > 1e-9) continue;
    out.push({ id: s.id, point: { x: s.n[j], G: th.Gsol(s.index, T) } });
  }
  return out;
}

// ------------------------------------------------------------ 固溶体演示模型（显式标注）

/**
 * 【演示模型】二元固溶体 + 液相，两相均为正规溶液：
 *   G_φ(x,T) = (1−x)·°G₁^φ + x·°G₂^φ + RT[x ln x + (1−x) ln(1−x)] + Ω_φ x(1−x)
 * 以纯固相为基准：°Gᵢ^s = 0，°Gᵢ^L = ΔHᵢ(1 − T/Tmᵢ)。
 * Ω_s = Ω_L = 0 时为理想匀晶系，公切线有闭式解（见 idealLens）—— 用作数值求解器的解析参照。
 * 参数为示意值，不代表真实材料。
 */
export interface SSModel {
  Tm: [number, number];
  dH: [number, number];
  omegaL: number;
  omegaS: number;
}

export const SS_DEFAULT: SSModel = { Tm: [1600, 1300], dH: [20000, 16000], omegaL: 0, omegaS: 0 };

export function ssCurves(m: SSModel, T: number): Curve1[] {
  const mix = (x: number) => R * T * (x * Math.log(x) + (1 - x) * Math.log(1 - x));
  const gL1 = m.dH[0] * (1 - T / m.Tm[0]);
  const gL2 = m.dH[1] * (1 - T / m.Tm[1]);
  const L = (x: number) => (1 - x) * gL1 + x * gL2 + mix(x) + m.omegaL * x * (1 - x);
  const S = (x: number) => mix(x) + m.omegaS * x * (1 - x);
  const dmix = (x: number) => R * T * Math.log(x / (1 - x));
  return [
    { id: 'L', G: L, dG: (x) => gL2 - gL1 + dmix(x) + m.omegaL * (1 - 2 * x) },
    { id: 'α', G: S, dG: (x) => dmix(x) + m.omegaS * (1 - 2 * x) },
  ];
}

/**
 * 理想匀晶系的解析解：μᵢˢ = μᵢᴸ ⇒ xᵢˢ / xᵢᴸ = kᵢ = exp(ΔHᵢ(1 − T/Tmᵢ)/RT)
 *   x₂ᴸ = (1 − k₁)/(k₂ − k₁),   x₂ˢ = k₂ x₂ᴸ
 * 仅当 T 介于两熔点之间时存在两相区。
 */
export function idealLens(m: SSModel, T: number): { xL: number; xS: number } | null {
  const k1 = Math.exp((m.dH[0] * (1 - T / m.Tm[0])) / (R * T));
  const k2 = Math.exp((m.dH[1] * (1 - T / m.Tm[1])) / (R * T));
  if (Math.abs(k2 - k1) < 1e-15) return null;
  const xL = (1 - k1) / (k2 - k1);
  const xS = k2 * xL;
  if (!(xL > 0 && xL < 1 && xS > 0 && xS < 1)) return null;
  return { xL, xS };
}

/** 固溶体模型的相图（T–x）：逐温度求公切线 */
export function ssDiagram(m: SSModel, Tlo: number, Thi: number, n = 120): { T: number; tangents: BinaryEquilibrium['tangents'] }[] {
  const out: { T: number; tangents: BinaryEquilibrium['tangents'] }[] = [];
  for (let k = 0; k <= n; k++) {
    const T = Thi - ((Thi - Tlo) * k) / n;
    out.push({ T, tangents: binaryEquilibrium(ssCurves(m, T), T).tangents });
  }
  return out;
}
