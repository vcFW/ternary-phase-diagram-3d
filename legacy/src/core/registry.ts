import { TernaryEutecticDiagram } from './diagram';
import type { ModelParams, SystemMeta } from './types';

/**
 * 体系注册表。
 *
 * 第一版只包含"教学用简单三元共晶模型"，参数为假想组元 A、B、C 的示意值，
 * 不代表任何真实材料。真实钢铁体系（Fe–C–Mn、Fe–C–Cr 等）具有固溶体、
 * 包晶反应与多种化合物，无法用本模型描述，需通过 PhaseDataProvider 接口
 * 接入 CALPHAD 计算或实验数据（见 src/core/provider.ts）。
 */

export interface SystemEntry {
  meta: SystemMeta;
  /** 可用体系的默认参数 */
  params?: ModelParams;
}

export const REGULAR_PARAMS: ModelParams = {
  components: [
    { symbol: 'A', name: '组元 A', Tm: 1450 + 273.15, dH: 32000 },
    { symbol: 'B', name: '组元 B', Tm: 1250 + 273.15, dH: 26000 },
    { symbol: 'C', name: '组元 C', Tm: 1100 + 273.15, dH: 22000 },
  ],
  omega: { AB: -9000, BC: -6000, CA: -12000 },
};

export const IDEAL_PARAMS: ModelParams = {
  components: REGULAR_PARAMS.components.map((c) => ({ ...c })) as ModelParams['components'],
  omega: { AB: 0, BC: 0, CA: 0 },
};

export const SYSTEMS: SystemEntry[] = [
  {
    meta: {
      id: 'edu-regular',
      name: '教学模型 · 正规溶液三元共晶',
      provenance: 'educational',
      available: true,
      description:
        '假想组元 A–B–C，固相互不溶、液相为正规溶液（Ω<0）。液相等温线为曲线，单变线与共晶点由相平衡方程数值求解。参数为示意值，非实测数据。',
    },
    params: REGULAR_PARAMS,
  },
  {
    meta: {
      id: 'edu-ideal',
      name: '教学模型 · 理想溶液三元共晶',
      provenance: 'educational',
      available: true,
      description:
        '假想组元 A–B–C，液相为理想溶液（Ω=0，Schröder–van Laar 方程）。此时 T_i 仅取决于 x_i，液相等温线为平行于对边的直线。参数为示意值，非实测数据。',
    },
    params: IDEAL_PARAMS,
  },
  {
    meta: {
      id: 'fe-c-mn',
      name: 'Fe–C–Mn（待接入）',
      provenance: 'calphad',
      available: false,
      description: '真实钢铁体系需接入 CALPHAD 热力学数据库计算结果，本版本仅预留数据接口，不提供任何虚构数据。',
    },
  },
  {
    meta: {
      id: 'fe-c-cr',
      name: 'Fe–C–Cr（待接入）',
      provenance: 'calphad',
      available: false,
      description: '真实钢铁体系需接入 CALPHAD 热力学数据库计算结果，本版本仅预留数据接口，不提供任何虚构数据。',
    },
  },
];

export function buildDiagram(meta: SystemMeta, params: ModelParams): TernaryEutecticDiagram {
  return new TernaryEutecticDiagram(meta, params);
}
