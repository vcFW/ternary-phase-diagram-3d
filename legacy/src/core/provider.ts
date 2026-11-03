import type { Comp, CompIndex, EquilibriumState, RegionKey, SpecialPoint, SystemMeta } from './types';

/**
 * 相图数据提供者接口（扩展点）。
 *
 * 当前实现：TernaryEutecticDiagram（教学用简单三元共晶模型，解析/数值精确求解）。
 *
 * 接入真实钢铁体系（如 Fe–C–Mn、Fe–C–Cr）的建议路径：
 *   1. 由 CALPHAD 软件（Thermo-Calc / OpenCalphad / pycalphad 等）离线计算
 *      规则网格 (x, T) 上的平衡相组成，导出为 JSON/二进制网格；
 *   2. 实现本接口：classify / equilibrium 在网格上插值，相界由等值面提取
 *      （Marching Tetrahedra）生成，替代当前的解析曲面；
 *   3. 在 registry.ts 中注册，并将 meta.provenance 标注为 'calphad' 或 'experimental'，
 *      界面会据此显示数据来源，避免与教学模型混淆。
 *
 * 注意：真实体系含固溶体（γ-Fe、α-Fe）、包晶反应与碳化物，其拓扑与简单共晶不同，
 * 因此视图层通过 RegionKey 与本接口交互，而不假定固定的相区数目。
 */
export interface PhaseDataProvider {
  readonly meta: SystemMeta;
  readonly tRange: [number, number];
  readonly specialPoints: SpecialPoint[];
  liquidus(x: Comp): { T: number; primary: CompIndex };
  classify(x: Comp, T: number): RegionKey;
  equilibrium(x: Comp, T: number): EquilibriumState;
}
