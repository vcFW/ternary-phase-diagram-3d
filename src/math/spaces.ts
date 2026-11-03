import { SQRT3_2 } from '../core/barycentric';
import type { PhaseDiagram } from '../core/diagram';
import type { BoundaryCurve, Comp } from '../core/types';
import { det, inverse, matVec, nullSpace, rank, svd, type Mat, type Vec } from './linalg';

/**
 * 状态空间与坐标变换。
 *
 * 三元凝聚体系（恒压）的状态 = (x_A, x_B, x_C, T)，受约束 x_A + x_B + x_C = 1，
 * 因此状态空间是 R⁴ 中的三维仿射子空间。取独立坐标 q = (x_A, x_B, T)。
 *
 *   成分 → 三角形笛卡尔坐标：  [u, v, 1]ᵀ = H · [x_A, x_B, x_C]ᵀ
 *       H = [[0, 1, 1/2], [0, 0, √3/2], [1, 1, 1]]   —— 三列恰为三个顶点的齐次坐标
 *   det H = √3/2 ≠ 0  ⇒  重心坐标 ↔ 笛卡尔坐标 是双射（仿射同构），反变换 x = H⁻¹ [u, v, 1]ᵀ。
 *
 *   投影 P：(x_A, x_B, T) → (x_A, x_B)，P = [[1,0,0],[0,1,0]]，rank P = 2，ker P = span(e_T)。
 */

/** 顶点齐次坐标矩阵 H（3×3），列 = A、B、C 顶点 (u, v, 1) */
export const H_MAT: Mat = [
  [0, 1, 0.5],
  [0, 0, SQRT3_2],
  [1, 1, 1],
];

/** 不含齐次行的 2×3 线性部分 M：[u, v]ᵀ = M x（仅在 Σx = 1 的平面上与仿射映射一致） */
export const M_LIN: Mat = [
  [0, 1, 0.5],
  [0, 0, SQRT3_2],
];

/** 投影矩阵 P（3 → 2） */
export const P_MAT: Mat = [
  [1, 0, 0],
  [0, 1, 0],
];

/** 独立坐标 → 完整成分：x = x_C顶点 + E·(x_A, x_B)，E = [[1,0],[0,1],[−1,−1]] */
export const E_MAT: Mat = [
  [1, 0],
  [0, 1],
  [-1, -1],
];

export function compToCart(x: Comp): [number, number] {
  const r = matVec(H_MAT, x);
  return [r[0], r[1]];
}

export function cartToComp(u: number, v: number): Comp {
  const Hi = inverse(H_MAT)!;
  const r = matVec(Hi, [u, v, 1]);
  return [r[0], r[1], r[2]];
}

export interface MapAnalysis {
  name: string;
  M: Mat;
  rank: number;
  singular: Vec;
  nullBasis: Vec[];
  det: number | null;
  /** 文字结论 */
  verdict: string;
}

export function analyzeMap(name: string, M: Mat): MapAnalysis {
  const r = rank(M);
  const s = svd(M).S;
  const ns = nullSpace(M);
  const square = M.length === M[0].length;
  const d = square ? det(M) : null;
  const n = M[0].length;
  let verdict: string;
  if (square && r === n) verdict = `满秩方阵（det = ${d!.toFixed(4)}）：映射可逆，信息无损。`;
  else verdict = `rank = ${r} < ${n}：零空间维数 ${n - r}，映射不可逆；沿零空间方向的分量被丢弃。`;
  return { name, M, rank: r, singular: s.slice(0, Math.min(M.length, n)), nullBasis: ns, det: d, verdict };
}

/** 三维状态（独立坐标）q = (x_A, x_B, T) */
export type State3 = [number, number, number];

export function stateOf(x: Comp, T: number): State3 {
  return [x[0], x[1], T];
}

export function project(q: State3): [number, number] {
  const r = matVec(P_MAT, q);
  return [r[0], r[1]];
}

/** 投影的纤维 P⁻¹(q₂) = {(x_A, x_B, T) : T ∈ [Tlo, Thi]}，取样 n 个点 */
export function fiber(q2: [number, number], Tlo: number, Thi: number, n = 5): State3[] {
  return Array.from({ length: n }, (_, k) => [q2[0], q2[1], Tlo + ((Thi - Tlo) * k) / (n - 1)] as State3);
}

export interface Reconstruction {
  /** 仅有成分坐标：T 完全不可恢复 */
  none: { determinable: false; reason: string };
  /** 已知 T 位于液相面上，且有完整的液相面函数 T_liq(x)：可唯一恢复 */
  surface: { T: number; reason: string };
  /** 只有间隔 ΔT 的等温线：只能定出温度带 */
  contours: { lo: number; hi: number; estimate: number; maxErr: number; reason: string; bandHasExtremum: boolean };
}

/**
 * 从二维投影恢复温度的三种信息条件。
 * 液相面是函数图像 T = T_liq(x)（每个成分只有一个液相线温度），故 P 限制在液相面上是单射。
 */
export function reconstructT(d: PhaseDiagram, x: Comp, step: number): Reconstruction {
  const Tl = d.liquidus(x).T;
  const lo = Math.floor(Tl / step) * step;
  const hi = lo + step;
  // 检查该温度带内是否含有温度极值（不变点或界线极大点）：若有，等温线不能界定温度
  let ext = false;
  for (const iv of d.topo.invariants) if (iv.T > lo && iv.T < hi && dist(iv.x, x) < 0.08) ext = true;
  return {
    none: { determinable: false, reason: 'ker P = span(e_T)：任意 T 都映到同一点，投影本身不含该状态的温度信息。' },
    surface: { T: Tl, reason: '附加约束 T = T_liq(x_A, x_B)：液相面是单值函数，P 在液相面上为单射，温度可唯一恢复。' },
    contours: {
      lo,
      hi,
      estimate: (lo + hi) / 2,
      maxErr: step / 2,
      bandHasExtremum: ext,
      reason: ext
        ? '该温度带附近有温度极值（不变点或界线极大点），仅凭相邻等温线无法界定温度。'
        : `仅知等温线：T 被夹在相邻两条等温线之间，取中值的误差 ≤ ΔT/2 = ${step / 2} K。`,
    },
  };
}

function dist(a: Comp, b: Comp) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 液相面梯度（笛卡尔坐标，K / 单位边长），由中心差分求得。
 * 等温线切向 ⊥ ∇T；等温线间距 ≈ ΔT / |∇T|。
 */
export function liquidusGradient(d: PhaseDiagram, x: Comp, h = 1e-4): { g: [number, number]; T: number; si: number } {
  const [u, v] = compToCart(x);
  const L = d.liquidus(x);
  const f = (uu: number, vv: number) => {
    const y = cartToComp(uu, vv);
    if (Math.min(...y) < 0) return NaN;
    // 只在同一初晶面内求导，避免跨越界线（导数不连续）
    return d.th.Tsat(L.si, y);
  };
  let gu = (f(u + h, v) - f(u - h, v)) / (2 * h);
  let gv = (f(u, v + h) - f(u, v - h)) / (2 * h);
  if (!Number.isFinite(gu)) gu = (f(u + h, v) - L.T) / h || (L.T - f(u - h, v)) / h;
  if (!Number.isFinite(gv)) gv = (f(u, v + h) - L.T) / h || (L.T - f(u, v - h)) / h;
  return { g: [gu || 0, gv || 0], T: L.T, si: L.si };
}

// ------------------------------------------------------------------ 参数曲线

export interface CurveParam {
  cv: BoundaryCurve;
  /** 笛卡尔坐标点 */
  P: [number, number][];
  /** 累积弧长 */
  s: number[];
  T: number[];
  length: number;
}

export function parametrize(cv: BoundaryCurve): CurveParam {
  const P = cv.pts.map(compToCart);
  const s = [0];
  for (let k = 1; k < P.length; k++) s.push(s[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
  return { cv, P, s, T: cv.T.slice(), length: s[s.length - 1] };
}

export interface CurveFrame {
  s: number;
  /** 曲线点（笛卡尔）与成分 */
  p: [number, number];
  x: Comp;
  T: number;
  /** 单位切向量 dp/ds（沿参数增加方向） */
  t: [number, number];
  /** dT/ds */
  dTds: number;
  /** 降温方向的单位切向量 */
  tCool: [number, number];
}

/**
 * 曲线在弧长 s 处的标架：在窗口 |s' − s| ≤ w 内对 p(s') 与 T(s') 做局部二次最小二乘，
 * 取 s 处导数。对栅格提取的折线这比逐段差分稳定得多。
 */
export function frameAt(cp: CurveParam, s: number, w?: number): CurveFrame {
  const win = w ?? Math.max(0.012, cp.length * 0.04);
  const sc = Math.min(cp.length, Math.max(0, s));
  const idx: number[] = [];
  for (let k = 0; k < cp.s.length; k++) if (Math.abs(cp.s[k] - sc) <= win) idx.push(k);
  if (idx.length < 3) {
    // 取最近的 3 个点
    const ord = cp.s.map((v, k) => [Math.abs(v - sc), k]).sort((a, b) => a[0] - b[0]);
    idx.length = 0;
    for (let k = 0; k < Math.min(3, ord.length); k++) idx.push(ord[k][1]);
  }
  const fit = (vals: number[]) => quadFit(idx.map((k) => cp.s[k] - sc), idx.map((k) => vals[k]));
  const fu = fit(cp.P.map((p) => p[0]));
  const fv = fit(cp.P.map((p) => p[1]));
  const fT = fit(cp.T);
  const du = fu[1];
  const dv = fv[1];
  const nrm = Math.hypot(du, dv) || 1;
  const t: [number, number] = [du / nrm, dv / nrm];
  const dTds = fT[1] / nrm;
  const sg = dTds <= 0 ? 1 : -1;
  const p: [number, number] = [fu[0], fv[0]];
  return { s: sc, p, x: cartToComp(p[0], p[1]), T: fT[0], t, dTds, tCool: [t[0] * sg, t[1] * sg] };
}

/** y ≈ c0 + c1·s + c2·s²（最小二乘） */
function quadFit(s: number[], y: number[]): [number, number, number] {
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const a2 = a * a;
    S0 += 1; S1 += a; S2 += a2; S3 += a2 * a; S4 += a2 * a2;
    Y0 += y[i]; Y1 += a * y[i]; Y2 += a2 * y[i];
  }
  const A: Mat = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  if (s.length < 3 || Math.abs(det(A)) < 1e-30) {
    // 线性
    const den = S0 * S2 - S1 * S1;
    const c1 = den ? (S0 * Y1 - S1 * Y0) / den : 0;
    return [(Y0 - c1 * S1) / S0, c1, 0];
  }
  const inv = inverse(A)!;
  const c = matVec(inv, [Y0, Y1, Y2]);
  return [c[0], c[1], c[2]];
}
