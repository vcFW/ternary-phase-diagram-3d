import type { PhaseDiagram } from '../core/diagram';
import type { Thermo } from '../core/thermo';
import type { BoundaryCurve, Comp } from '../core/types';
import { det, nullSpace, rank, svd, type Mat, type Vec } from './linalg';
import { compToCart, frameAt, parametrize, type CurveFrame, type CurveParam } from './spaces';

/**
 * 切线规则与 Alkemade 定理的线性代数形式。
 *
 * (1) 切线规则（几何部分）。界线 p(s) 上一点，降温方向单位切向量 t。液相沿界线移动时
 *     L·dx_L = −Σ dnₛ (xₛ − x_L)，即瞬时析出的固相混合物 x* 位于切线的"反向延长线"上，
 *     且在两固相连线 ab 上：
 *          p + τ t = a + λ (b − a)   ⇔   [ t | −(b − a) ] · (τ, λ)ᵀ = a − p      （2×2 线性方程组）
 *     x* = (1−λ)a + λb，于是 dn_a : dn_b = (1 − λ) : λ：
 *          0 < λ < 1 → 两相同时析出（共晶型）；λ < 0 → b 被回溶；λ > 1 → a 被回溶（转熔型）。
 *     det[t | −(b−a)] = 0 ⇔ 切线平行于连线，交点在无穷远（退化）。
 *
 * (2) Alkemade 定理（热力学部分）。三相 L + a + b 平衡，恒压下每个相的 Gibbs–Duhem 方程
 *          Sφ dT + Σ xφᵢ dμᵢ = 0
 *     构成 3×4 齐次方程组 G·(dT, dμ_A, dμ_B, dμ_C)ᵀ = 0，G 的行 = [Sφ, xφ]。
 *     若 x_L = (1−λ)a + λb（液相点落在连线上），则  row_L − (1−λ)row_a − λ row_b = [ΔS, 0, 0, 0]，
 *     ΔS ≠ 0（熔化熵）⇒ dT = 0：界线温度在与连线相交处取极值 —— 由线性相关性直接推出 Alkemade 定理。
 *
 * (3) 相律 = 秩–零化度。P 个共存相给出 P 个 Gibbs–Duhem 方程，未知量 (dT, dμ₁…dμ_C) 共 C + 1 个，
 *     F = (C + 1) − rank G = C + 1 − P（恒压凝聚体系）。
 */

export interface TangentIntersection {
  M: Mat;
  rhs: Vec;
  det: number;
  tau: number;
  lambda: number;
  /** 交点（成分） */
  point: Comp | null;
  /** 解释 */
  kind: 'eutectic' | 'peritectic-a' | 'peritectic-b' | 'parallel';
  /** 反向延长线（τ < 0）是否成立 */
  backward: boolean;
  ratio: [number, number] | null;
}

export function tangentIntersect(p: [number, number], t: [number, number], a: Comp, b: Comp): TangentIntersection {
  const A = compToCart(a);
  const B = compToCart(b);
  const dba = [B[0] - A[0], B[1] - A[1]];
  const M: Mat = [
    [t[0], -dba[0]],
    [t[1], -dba[1]],
  ];
  const rhs = [A[0] - p[0], A[1] - p[1]];
  const D = det(M);
  const scaleRef = Math.hypot(...dba);
  if (Math.abs(D) < 1e-10 * scaleRef)
    return { M, rhs, det: D, tau: NaN, lambda: NaN, point: null, kind: 'parallel', backward: false, ratio: null };
  const tau = (rhs[0] * M[1][1] - rhs[1] * M[0][1]) / D;
  const lambda = (M[0][0] * rhs[1] - M[1][0] * rhs[0]) / D;
  const point: Comp = [a[0] + lambda * (b[0] - a[0]), a[1] + lambda * (b[1] - a[1]), a[2] + lambda * (b[2] - a[2])];
  const kind = lambda < 0 ? 'peritectic-b' : lambda > 1 ? 'peritectic-a' : 'eutectic';
  return { M, rhs, det: D, tau, lambda, point, kind, backward: tau < 0, ratio: [1 - lambda, lambda] };
}

/** 熵（相对纯固相组元基准）：S = −∂G/∂T，中心差分（本模型中 G 对 T 线性，差分精确） */
export function entropyLiq(th: Thermo, x: Comp, T: number): number {
  const h = 0.5;
  return -(th.Gliq(x, T + h) - th.Gliq(x, T - h)) / (2 * h);
}

export function entropySol(th: Thermo, si: number, y?: Comp, T = 1000): number {
  const s = th.solids[si];
  if (!s.sol) return s.dSf;
  const x = y ?? s.n;
  const h = 0.5;
  return -(th.Gphase(si, x, T + h) - th.Gphase(si, x, T - h)) / (2 * h);
}

export interface GDPhase {
  label: string;
  x: Comp;
  S: number;
}

export interface GibbsDuhem {
  G: Mat;
  rank: number;
  singular: Vec;
  /** 零空间（自由度方向） */
  nullBasis: Vec[];
  /** F = 4 − rank */
  F: number;
}

export function gibbsDuhem(phases: GDPhase[]): GibbsDuhem {
  const G: Mat = phases.map((p) => [p.S, p.x[0], p.x[1], p.x[2]]);
  const r = rank(G, 1e-9);
  return { G, rank: r, singular: svd(G).S.slice(0, Math.min(4, phases.length)), nullBasis: nullSpace(G, 1e-9), F: 4 - r };
}

/** 当前平衡态的 Gibbs–Duhem 系统（若含液相则用液相熵） */
export function gibbsDuhemOfEq(th: Thermo, phases: { si: number; id: string; x: Comp }[], T: number): GibbsDuhem {
  return gibbsDuhem(
    phases.map((p) => ({ label: p.id, x: p.x, S: p.si < 0 ? entropyLiq(th, p.x, T) : entropySol(th, p.si, p.x, T) })),
  );
}

export interface CurveAnalysis {
  cp: CurveParam;
  frame: CurveFrame;
  /** 该点处与液相共轭的两固相成分（化学计量相即固定成分） */
  ya: Comp;
  yb: Comp;
  ti: TangentIntersection;
  gd: GibbsDuhem;
  /** 零空间向量归一化后的 dT 分量（相对于 |dμ|） */
  dTrel: number;
}

export function analyzeCurveAt(d: PhaseDiagram, cv: BoundaryCurve, s: number): CurveAnalysis {
  const cp = parametrize(cv);
  const frame = frameAt(cp, s);
  const a = d.solids[cv.a];
  const b = d.solids[cv.b];
  const T = frame.T;
  const ya = d.th.solidComp(a.index, frame.x, T);
  const yb = d.th.solidComp(b.index, frame.x, T);
  const ti = tangentIntersect(frame.p, frame.tCool, ya, yb);
  const gd = gibbsDuhem([
    { label: 'L', x: frame.x, S: entropyLiq(d.th, frame.x, T) },
    { label: a.label, x: ya, S: entropySol(d.th, a.index, ya, T) },
    { label: b.label, x: yb, S: entropySol(d.th, b.index, yb, T) },
  ]);
  const v = gd.nullBasis[0] ?? [0, 0, 0, 0];
  const dTrel = v[0] / (Math.hypot(v[1], v[2], v[3]) || 1);
  return { cp, frame, ya, yb, ti, gd, dTrel };
}

export interface AlkemadeCheck {
  /** 界线与连线（直线 ab）的交点弧长，无交点为 null */
  sCross: number | null;
  /** 界线温度极大点弧长 */
  sMax: number | null;
  TCross: number | null;
  TMax: number | null;
  /** 交点处 Gibbs–Duhem 零空间的 dT 分量 */
  dTatCross: number | null;
  /** 连线方程：x_L 与 a、b 共线的判别量（有向面积） */
}

/** 沿界线扫描：x_L 关于直线 ab 的有向面积变号处即与连线相交；与温度极大点比较。 */
export function alkemadeCheck(d: PhaseDiagram, cv: BoundaryCurve): AlkemadeCheck {
  const cp = parametrize(cv);
  const sol = d.th.hasSolution;
  // 液相点相对于"两共轭固相成分连线"的有向面积；化学计量相时连线固定
  const sideAt = (x: Comp): number => {
    const T = d.th.Tsat(cv.a, x);
    const A = compToCart(sol ? d.th.solidComp(cv.a, x, T) : d.solids[cv.a].n);
    const B = compToCart(sol ? d.th.solidComp(cv.b, x, T) : d.solids[cv.b].n);
    const p = compToCart(x);
    return (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
  };
  const sides = cv.pts.map(sideAt);
  let sCross: number | null = null;
  let kCross = -1;
  for (let k = 0; k < cp.P.length - 1; k++) {
    const s0 = sides[k];
    const s1 = sides[k + 1];
    // 端点恰在连线上（界线起于连线所在的二元边）不算相交
    if (s0 * s1 < 0 || (s0 === 0 && k > 0)) {
      const f = s0 === s1 ? 0 : s0 / (s0 - s1);
      sCross = cp.s[k] + f * (cp.s[k + 1] - cp.s[k]);
      kCross = k;
      break;
    }
  }
  let kMax = -1;
  for (let k = 1; k < cp.T.length - 1; k++) if (cp.T[k] >= cp.T[k - 1] && cp.T[k] >= cp.T[k + 1] && (kMax < 0 || cp.T[k] > cp.T[kMax])) kMax = k;
  let sMax: number | null = null;
  let TMax: number | null = null;
  if (kMax > 0) {
    // 抛物线插值求精
    const [s0, s1, s2] = [cp.s[kMax - 1], cp.s[kMax], cp.s[kMax + 1]];
    const [t0, t1, t2] = [cp.T[kMax - 1], cp.T[kMax], cp.T[kMax + 1]];
    const den = (s0 - s1) * (s0 - s2) * (s1 - s2);
    const aa = (s2 * (t1 - t0) + s1 * (t0 - t2) + s0 * (t2 - t1)) / den;
    const bb = (s2 * s2 * (t0 - t1) + s1 * s1 * (t2 - t0) + s0 * s0 * (t1 - t2)) / den;
    sMax = aa < 0 ? -bb / (2 * aa) : s1;
    TMax = aa < 0 ? t1 + aa * (sMax - s1) * (sMax - s1) + (2 * aa * s1 + bb) * (sMax - s1) : t1;
  }
  let TCross: number | null = null;
  let dTatCross: number | null = null;
  if (sCross !== null && sol) {
    // 固溶体：在该段上二分求精交点，用共轭成分建立 Gibbs–Duhem 矩阵
    const P0 = cv.pts[kCross];
    const P1 = cv.pts[kCross + 1];
    const at = (t: number): Comp => [0, 1, 2].map((i) => P0[i] + t * (P1[i] - P0[i])) as Comp;
    let lo = 0;
    let hi = 1;
    const s0 = sideAt(at(0));
    for (let it = 0; it < 50; it++) {
      const m = 0.5 * (lo + hi);
      if (sideAt(at(m)) * s0 > 0) lo = m;
      else hi = m;
    }
    const xl = at(0.5 * (lo + hi));
    const T = d.th.Tsat(cv.a, xl);
    TCross = T;
    const ya = d.th.solidComp(cv.a, xl, T);
    const yb = d.th.solidComp(cv.b, xl, T);
    const gd = gibbsDuhem([
      { label: 'L', x: xl, S: entropyLiq(d.th, xl, T) },
      { label: 'a', x: ya, S: entropySol(d.th, cv.a, ya, T) },
      { label: 'b', x: yb, S: entropySol(d.th, cv.b, yb, T) },
    ]);
    const v = gd.nullBasis[0];
    dTatCross = v ? v[0] / (Math.hypot(v[1], v[2], v[3]) || 1) : null;
  } else if (sCross !== null) {
    const an = analyzeCurveAt(d, cv, sCross);
    TCross = an.frame.T;
    // 在精确共线点上求零空间
    const k = cp.s.findIndex((v) => v >= sCross!);
    const k0 = Math.max(1, k);
    const f = (sCross - cp.s[k0 - 1]) / (cp.s[k0] - cp.s[k0 - 1] || 1);
    const x: Comp = [0, 1, 2].map((i) => cv.pts[k0 - 1][i] + f * (cv.pts[k0][i] - cv.pts[k0 - 1][i])) as Comp;
    // 投影到直线 ab 上，确保精确共线
    const a = d.solids[cv.a].n;
    const b = d.solids[cv.b].n;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const lam = ((x[0] - a[0]) * ab[0] + (x[1] - a[1]) * ab[1] + (x[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
    const xl: Comp = [a[0] + lam * ab[0], a[1] + lam * ab[1], a[2] + lam * ab[2]];
    const T = d.th.Tsat(cv.a, xl);
    const gd = gibbsDuhem([
      { label: 'L', x: xl, S: entropyLiq(d.th, xl, T) },
      { label: 'a', x: a, S: entropySol(d.th, cv.a) },
      { label: 'b', x: b, S: entropySol(d.th, cv.b) },
    ]);
    const v = gd.nullBasis[0];
    dTatCross = v ? v[0] / (Math.hypot(v[1], v[2], v[3]) || 1) : null;
  }
  return { sCross, sMax, TCross, TMax, dTatCross };
}
