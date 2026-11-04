import type { PhaseDiagram } from '../core/diagram';
import type { Comp, Equilibrium } from '../core/types';
import { rank } from './linalg';

/**
 * 相律（恒压凝聚体系）：F = C − P + 1，其中 C 为"有效组元数"。
 *
 * 名义上三元体系 C = 3，但在下列情形独立组元数降低：
 *   1. 总成分 x₀ 中某组元含量为 0（落在边或顶点上）：C = x₀ 中非零组元的个数；
 *   2. x₀ 与全部平衡相成分位于同一条直线上，且该直线是两个稳定化学计量固相
 *      （纯组元或一致熔融化合物）的连线 —— 真正的伪二元截面：C = 2。
 * 注意"相点共线"本身不足以降低 C（内部两相区 L + A 的 x₀、液相、A 本来就共线），
 * 必须同时满足"直线是两个稳定固相的连线"。
 */
export interface PhaseRule {
  C: number;
  P: number;
  F: number;
  /** C 取值的原因，空串表示名义三元（无需注释） */
  reason: string;
}

const EPS_ZERO = 1e-9;
/** 共线判定：[pᵢ − x₀] 的奇异值阈值（成分单位） */
const COLLINEAR_TOL = 1e-6;

/** 点 x 是否落在 x₀ 与 y 所确定的直线上：矩阵 [pᵢ − x₀] 秩 ≤ 1 */
function collinearWith(x0: Comp, pts: Comp[]): boolean {
  const M = pts.map((p) => [p[0] - x0[0], p[1] - x0[1], p[2] - x0[2]]);
  return rank(M, COLLINEAR_TOL) <= 1;
}

/** 找到过 x₀ 与全部平衡相、且经过两个稳定化学计量固相的直线；返回这两个固相的标签 */
function pseudoBinaryLine(d: PhaseDiagram, eq: Equilibrium, x0: Comp): [string, string] | null {
  const stable: number[] = [];
  d.solids.forEach((s, i) => {
    if (s.kind === 'element') stable.push(i);
    else if (s.kind === 'solution') return;
    else if (d.topo.compounds.find((c) => c.si === i)?.congruent) stable.push(i);
  });
  const phasePts = eq.phases.map((p) => p.x);
  for (let a = 0; a < stable.length; a++)
    for (let b = a + 1; b < stable.length; b++) {
      const pa = d.solids[stable[a]].n;
      const pb = d.solids[stable[b]].n;
      if (collinearWith(x0, [pa, pb, ...phasePts])) return [d.solids[stable[a]].label, d.solids[stable[b]].label];
    }
  return null;
}

export function effectiveComponents(d: PhaseDiagram, x0: Comp, eq: Equilibrium): { C: number; reason: string } {
  const C0 = x0.filter((v) => v > EPS_ZERO).length;
  if (C0 === 1) return { C: 1, reason: '总成分为纯组元，C = 1' };
  if (C0 === 2) return { C: 2, reason: 'x₀ 在三角形边上（某组元含量为 0），C = 2（二元子体系）' };
  const line = pseudoBinaryLine(d, eq, x0);
  if (line) return { C: 2, reason: `x₀ 与全部平衡相位于 ${line[0]}–${line[1]} 伪二元连线上，C = 2` };
  return { C: 3, reason: '' };
}

/**
 * @param onPlateau 冷却中处于不变反应平台（所有相共存的恒温阶段）：F 恒为 0
 */
export function phaseRule(d: PhaseDiagram, eq: Equilibrium, x0: Comp, onPlateau = false): PhaseRule {
  const { C, reason } = effectiveComponents(d, x0, eq);
  const P = eq.phases.length;
  const F = onPlateau ? 0 : Math.max(0, C - P + 1);
  return { C, P, F, reason: onPlateau ? (reason ? `${reason}；不变反应平台，F = 0` : '不变反应平台，F = 0') : reason };
}

/** 状态读数用的短文本，例如 "P = 2 · C = 2 · F = 1" */
export function phaseRuleText(r: PhaseRule): string {
  return `P = ${r.P} · C = ${r.C} · F = ${r.F}`;
}
