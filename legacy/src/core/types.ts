/**
 * 核心类型定义。
 *
 * 成分统一使用摩尔分数三元组 Comp = [x_A, x_B, x_C]，且 x_A + x_B + x_C = 1。
 * 温度在计算核心中一律使用开尔文 (K)，仅在界面显示时转换为摄氏度。
 */

export type Comp = [number, number, number];
export type CompIndex = 0 | 1 | 2;

/** 相区标识：'L'、'L+0'、'L+0+1'（固相下标升序）、'S'（三固相 A+B+C）。 */
export type RegionKey = string;

export interface ComponentDef {
  /** 组元符号，如 "A" */
  symbol: string;
  /** 组元显示名 */
  name: string;
  /** 纯组元熔点 / K */
  Tm: number;
  /** 摩尔熔化焓 / (J·mol⁻¹) */
  dH: number;
}

/** 液相正规溶液相互作用参数 Ω / (J·mol⁻¹)，Ω=0 时退化为理想溶液。 */
export interface InteractionParams {
  AB: number;
  BC: number;
  CA: number;
}

export interface ModelParams {
  components: [ComponentDef, ComponentDef, ComponentDef];
  omega: InteractionParams;
}

export type DataProvenance = 'educational' | 'experimental' | 'calphad';

/** 体系元数据：用于区分教学模型与真实数据，并为后续真实体系接入预留。 */
export interface SystemMeta {
  id: string;
  name: string;
  provenance: DataProvenance;
  description: string;
  /** 是否可用（真实钢铁体系目前仅为接口占位） */
  available: boolean;
}

export interface PhaseAmount {
  /** 'L' 或固相组元下标 */
  phase: 'L' | CompIndex;
  /** 相的摩尔分数（杠杆规则） */
  fraction: number;
  /** 该相成分 */
  comp: Comp;
}

export interface EquilibriumState {
  region: RegionKey;
  phases: PhaseAmount[];
  /** 液相成分（若存在液相） */
  liquid: Comp | null;
  /** 相律自由度（恒压凝聚体系 F = C − P + 1） */
  dof: number;
}

export interface SpecialPoint {
  id: string;
  kind: 'melting' | 'binaryEutectic' | 'ternaryEutectic';
  label: string;
  comp: Comp;
  T: number;
  /** 涉及的组元 */
  members: CompIndex[];
}

export interface MonovariantSample {
  /** 第三组元在液相中的含量（参数化变量） */
  c: number;
  y: Comp;
  T: number;
}

export interface MonovariantLine {
  id: string;
  /** 两个初晶相 i<j */
  i: CompIndex;
  j: CompIndex;
  /** 第三组元 */
  k: CompIndex;
  /** 自二元共晶点 (高温) 至三元共晶点 (低温) 的有序采样 */
  samples: MonovariantSample[];
}

export interface VerticalLine {
  /** 截面两端点 */
  p1: Comp;
  p2: Comp;
}
