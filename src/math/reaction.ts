import type { Thermo } from '../core/thermo';
import type { Comp } from '../core/types';
import { fromCols, matVec, nullSpace, rank, svd, type Mat, type Vec } from './linalg';

/**
 * 反应 = 成分矩阵的零空间。
 *
 * 设 p 个相的成分列向量组成 N = [c₁ … c_p]（3×p，行 = 组元 A、B、C）。
 * 任一反应 Σ νᵢ φᵢ = 0（νᵢ < 0 为反应物、> 0 为产物，单位：摩尔原子）满足组元守恒
 *        N ν = 0     ⇔   ν ∈ ker N.
 * 由秩–零化度定理  dim ker N = p − rank N：
 *   · 三个不共线的相：rank 3，ker = {0} —— 它们之间不存在任何守恒反应；
 *   · 四相（L, α, β, γ）且三固相不共线：rank 3，ker 一维 —— 反应唯一（差一个比例因子）；
 *   · 三相共线（例如液相落在两固相连线上）：rank 2，出现一维零空间 —— "拟二元"反应 L ⇌ α + β。
 *
 * 取 ν_L = −1 归一化（降温方向消耗液相），则固相系数恰为液相点关于固相三角形的重心坐标：
 *   全为正    → 液相在三角形内        → 三元共晶   L → α + β + γ
 *   一负      → 液相在"交叉位"        → 过渡点     L + α → β + γ
 *   两负      → 液相在"共轭位"（顶角外）→ 双转熔     L + α + β → γ
 *
 * 但零空间只回答"守恒允许什么"。哪些相能共存由热力学（公切面）决定；反应朝哪个方向进行
 * 由反应吉布斯能 ΔG_r(T) = Σ νᵢ Gᵢ 的符号决定 —— 在不变点温度处 ΔG_r = 0。
 */

export interface RxPhase {
  label: string;
  x: Comp;
  /** -1 = 液相；否则为固相下标 */
  si: number;
}

export type RxClass = 'eutectic' | 'transition' | 'peritectic' | 'binary-eutectic' | 'binary-peritectic' | 'none' | 'degenerate' | 'multiple';

export interface RxAnalysis {
  N: Mat;
  rank: number;
  singular: Vec;
  nullDim: number;
  /** 归一化后的反应系数（ν_L = −1，若含液相） */
  nu: Vec | null;
  /** ‖N ν‖∞ */
  residual: number;
  cls: RxClass;
  text: string;
  message: string;
}

export function analyzeReaction(phases: RxPhase[]): RxAnalysis {
  const N = fromCols(phases.map((p) => p.x));
  const S = svd(N).S;
  const r = rank(N, 1e-10);
  const ns = nullSpace(N, 1e-10);
  const base = { N, rank: r, singular: S.slice(0, Math.min(3, phases.length)), nullDim: ns.length };
  if (ns.length === 0)
    return {
      ...base,
      nu: null,
      residual: 0,
      cls: 'none',
      text: '—',
      message: `rank N = ${r} = 相数：ker N = {0}。这些相之间不存在满足组元守恒的反应。`,
    };
  if (ns.length > 1)
    return {
      ...base,
      nu: null,
      residual: 0,
      cls: 'multiple',
      text: '—',
      message: `零空间维数 ${ns.length} > 1：存在多个线性无关的守恒反应（相成分点高度退化，如多点共线/重合）。`,
    };
  let nu = ns[0].slice();
  const iL = phases.findIndex((p) => p.si < 0);
  const ref = iL >= 0 ? iL : nu.reduce((b, v, i) => (Math.abs(v) > Math.abs(nu[b]) ? i : b), 0);
  if (Math.abs(nu[ref]) < 1e-12) {
    // 液相系数为 0：反应只发生在固相之间（液相不参与），属于退化情形
    const k = nu.reduce((b, v, i) => (Math.abs(v) > Math.abs(nu[b]) ? i : b), 0);
    nu = nu.map((v) => v / Math.abs(nu[k]));
    return { ...base, nu, residual: Math.max(...matVec(N, nu).map(Math.abs)), cls: 'degenerate', text: rxText(phases, nu), message: '液相系数为零：守恒反应只涉及固相（固相成分点共线），液相不参与。' };
  }
  const s = -1 / nu[ref];
  nu = nu.map((v) => v * s);
  const resid = Math.max(...matVec(N, nu).map(Math.abs));
  const solidCoefs = nu.filter((_, i) => i !== iL);
  const nNeg = solidCoefs.filter((v) => v < -1e-9).length;
  const nZero = solidCoefs.filter((v) => Math.abs(v) <= 1e-9).length;
  let cls: RxClass;
  let message: string;
  if (iL < 0) {
    cls = 'degenerate';
    message = '不含液相的守恒关系。';
  } else if (phases.length === 4) {
    if (nZero > 0) {
      cls = 'degenerate';
      message = '有固相系数为 0：液相落在固相三角形的一条边上（拟二元退化情形）。';
    } else if (nNeg === 0) {
      cls = 'eutectic';
      message = '三个固相系数均为正：液相点在固相三角形内（重心位） ⇒ 三元共晶型。';
    } else if (nNeg === 1) {
      cls = 'transition';
      message = '一个固相系数为负：液相点在三角形一边之外（交叉位） ⇒ 过渡点（单转熔）型。';
    } else {
      cls = 'peritectic';
      message = '两个固相系数为负：液相点在三角形一个顶角之外（共轭位） ⇒ 双转熔（三元包晶）型。';
    }
  } else if (phases.length === 3) {
    cls = nNeg === 0 ? 'binary-eutectic' : 'binary-peritectic';
    message = nNeg === 0 ? '三相共线且液相居中：L → α + β（共晶型）。' : '三相共线且液相在外侧：L + α → β（包晶型）。';
  } else {
    cls = 'degenerate';
    message = '';
  }
  return { ...base, nu, residual: resid, cls, text: rxText(phases, nu), message };
}

function rxText(phases: RxPhase[], nu: Vec): string {
  const f = (v: number) => (Math.abs(Math.abs(v) - 1) < 1e-9 ? '' : `${Math.abs(v).toFixed(3)} `);
  const left = phases.map((p, i) => ({ p, v: nu[i] })).filter((t) => t.v < -1e-9).map((t) => `${f(t.v)}${t.p.label}`);
  const right = phases.map((p, i) => ({ p, v: nu[i] })).filter((t) => t.v > 1e-9).map((t) => `${f(t.v)}${t.p.label}`);
  return `${left.join(' + ') || '∅'} → ${right.join(' + ') || '∅'}`;
}

export interface RxThermo {
  /** ΔG_r(T) / (J·mol⁻¹)，相成分固定 */
  dG: (T: number) => number;
  dH: number;
  dS: number;
  /** ΔG_r = 0 的温度（ΔH/ΔS） */
  T0: number;
}

/**
 * 反应吉布斯能（相成分固定在给定值，例如不变点处）：
 *   ΔG_r(T) = ν_L G_L(x_L, T) + Σ ν_s G_s(T)
 * 本模型中 ΔH_r、ΔS_r 与温度无关（ΔCp = 0），因此 ΔG_r(T) = ΔH_r − T ΔS_r 为线性函数。
 * 注意：这是"固定成分的相之间的反应"的 ΔG，而不是成分相关的自由能曲面 G_φ(x, T) 本身。
 */
export function reactionThermo(th: Thermo, phases: RxPhase[], nu: Vec): RxThermo {
  const G = (T: number) =>
    phases.reduce((s, p, i) => s + nu[i] * th.Gphase(p.si, p.x, T), 0);
  const dH = phases.reduce((s, p, i) => s + nu[i] * th.Hphase(p.si, p.x), 0);
  const h = 1;
  const Tref = 1000;
  const dS = -(G(Tref + h) - G(Tref - h)) / (2 * h);
  return { dG: G, dH, dS, T0: dS !== 0 ? dH / dS : NaN };
}
