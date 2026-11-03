/**
 * 核心类型。成分一律为摩尔分数三元组 Comp = [x_A, x_B, x_C]（和为 1），温度在核心中一律为开尔文。
 */

export type Comp = [number, number, number];
export type CompIndex = 0 | 1 | 2;

export interface ComponentDef {
  symbol: string;
  name: string;
  /** 纯组元熔点 / K */
  Tm: number;
  /** 摩尔熔化焓 / (J·mol⁻¹) */
  dH: number;
}

/** 化合物（化学计量固相，固相互不溶）。n 为每摩尔原子（单元）中 A、B、C 的摩尔分数。 */
export interface CompoundDef {
  id: string;
  /** 显示名，例如 "D" */
  label: string;
  /** 化学式，例如 "AB" */
  formula: string;
  n: Comp;
  /** 由纯固相组元生成的焓变 / (J·mol⁻¹·单元)，负值 */
  dHf: number;
  /** 由纯固相组元生成的熵变 / (J·mol⁻¹·K⁻¹·单元) */
  dSf: number;
}

/**
 * 固溶体相（正规溶液）：G(y,T) = Σ yᵢ(aᵢ − T bᵢ) + RT Σ yᵢ ln yᵢ + Σ_{i<j} Ωᵢⱼ yᵢ yⱼ。
 * 基准与其余各相相同：纯组元在其稳定固态结构中 G = 0。g0[i] = [aᵢ, bᵢ] 即组元 i 在该结构中的晶格稳定性 °Gᵢ = aᵢ − T bᵢ。
 */
export interface SolutionPhaseDef {
  id: string;
  label: string;
  /** 显示用，例如 "(A)" */
  formula: string;
  /** 名义成分（基体组元顶点），用于标注 */
  n: Comp;
  g0: [[number, number], [number, number], [number, number]];
  omega: { AB: number; AC: number; BC: number };
}

export interface SystemParams {
  components: [ComponentDef, ComponentDef, ComponentDef];
  /** 固溶体相；若给出，则纯组元固相不再作为独立的化学计量相（由固溶体取代） */
  solutions?: SolutionPhaseDef[];
  /** 液相正规溶液相互作用参数 Ω / (J·mol⁻¹)，二元项 */
  omega: { AB: number; AC: number; BC: number };
  compounds: CompoundDef[];
  /** 各相共同的摩尔热容 / (J·mol⁻¹·K⁻¹)，仅用于冷却曲线 */
  Cp: number;
}

export interface Solid {
  index: number;
  id: string;
  label: string;
  formula: string;
  n: Comp;
  kind: 'element' | 'binary' | 'ternary' | 'solution';
  /** 固溶体参数（kind = 'solution'） */
  sol?: { a: Comp; b: Comp; om: Comp };
  dHf: number;
  dSf: number;
  /** 溶解常数：Σ nᵢΔHᵢ − ΔHf  与  Σ nᵢΔHᵢ/Tmᵢ − ΔSf */
  Hs: number;
  Ss: number;
}

export interface PhaseAmount {
  /** -1 表示液相，否则为固相下标 */
  si: number;
  id: string;
  frac: number;
  x: Comp;
}

export interface Equilibrium {
  phases: PhaseAmount[];
  /** 相区键：'L'、'L+A'、'L+A+D'、'A+D+C' */
  key: string;
  /** 恒压凝聚体系相律 F = C − P + 1 = 4 − P */
  dof: number;
  /** 吉布斯能（相对纯固相组元）/ (J·mol⁻¹) */
  G: number;
}

export type ReactionType = 'eutectic' | 'transition' | 'peritectic';

export interface Reaction {
  /** 各相系数（液相 -1：总是被消耗；固相正为生成、负为消耗） */
  terms: { si: number; coef: number }[];
  type: ReactionType;
  /** 例如 "L + A ⇌ D + C" */
  text: string;
}

export interface InvariantPoint {
  id: string;
  label: string;
  rank: 'ternary' | 'binary';
  x: Comp;
  T: number;
  /** 与液相共存的固相下标（三元 3 个、二元 2 个） */
  solids: number[];
  reaction: Reaction;
  /** 各共存固相在不变点处的成分（化学计量相即其固定成分；固溶体随体系而定） */
  solidX: Comp[];
  /** 中文名称 */
  name: string;
}

export interface CurvePiece {
  /** 在 pts 中的起止下标（含），顺序为降温方向 */
  i0: number;
  i1: number;
  kind: ReactionType;
  /** 转熔线中被回溶的固相 */
  resorbed: number;
}

export interface BoundaryCurve {
  id: string;
  a: number;
  b: number;
  pts: Comp[];
  T: number[];
  pieces: CurvePiece[];
  /** 温度极大值点（鞍点）在 pts 中的下标 */
  maxima: number[];
}

export interface PrimaryField {
  si: number;
  /** 栅格面积占比 */
  area: number;
  /** 标注位置 */
  centroid: Comp;
  /** 该固相液相线最高值（相区内） */
  Tmax: number;
}

export interface CompoundInfo {
  si: number;
  congruent: boolean;
  /** 化合物成分点处该固相自身的（假想）熔点 / K */
  Thyp: number;
  /** 化合物成分点处实际液相线 / K 及其初晶相 */
  Tliq: number;
  liqSi: number;
  /** 有自己的初晶区 */
  hasField: boolean;
  /** 分解（包晶）温度 / K：不一致熔融时为含该化合物的最高温不变点，否则为熔点 */
  Tdecomp: number | null;
  /** 描述 */
  text: string;
}

export interface FacetInfo {
  /** 三固相下标 */
  s: [number, number, number];
}
