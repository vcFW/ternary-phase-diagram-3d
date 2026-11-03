import type { Comp, CompIndex, ModelParams } from './types';

export const R_GAS = 8.314462618;

/**
 * 液相线模型：纯固相 i 与液相平衡的条件 μ_i^S = μ_i^L。
 *
 *   ΔH_i (1 − T/T_m,i) + R T ln x_i + G_i^ex(x) = 0
 *
 * 取 ΔC_p = 0，液相为三元正规溶液：
 *   G_i^ex = Ω_ij x_j² + Ω_ik x_k² + (Ω_ij + Ω_ik − Ω_jk) x_j x_k
 *
 * 由此得到闭式解（Schröder–van Laar 方程的正规溶液推广）：
 *
 *   T_i(x) = (ΔH_i + G_i^ex) / (ΔH_i / T_m,i − R ln x_i)
 *
 * T_i(x) 表示"以 i 为初晶相"的液相面；实际液相面为三者的上包络
 *   T_liq(x) = max_i T_i(x)。
 */
export interface LiquidusModel {
  /** 以组元 i 为初晶相的液相面温度 / K */
  Ti(i: CompIndex, x: Comp): number;
  readonly params: ModelParams;
}

function omegaPair(p: ModelParams, i: CompIndex, j: CompIndex): number {
  const key = [i, j].sort().join('');
  if (key === '01') return p.omega.AB;
  if (key === '12') return p.omega.BC;
  return p.omega.CA;
}

export function partialExcess(p: ModelParams, i: CompIndex, x: Comp): number {
  const j = ((i + 1) % 3) as CompIndex;
  const k = ((i + 2) % 3) as CompIndex;
  const wij = omegaPair(p, i, j);
  const wik = omegaPair(p, i, k);
  const wjk = omegaPair(p, j, k);
  return wij * x[j] * x[j] + wik * x[k] * x[k] + (wij + wik - wjk) * x[j] * x[k];
}

export function createRegularSolutionLiquidus(params: ModelParams): LiquidusModel {
  const comps = params.components;
  return {
    params,
    Ti(i, x) {
      const xi = x[i];
      if (xi <= 1e-300) return 0;
      const c = comps[i];
      const num = c.dH + partialExcess(params, i, x);
      const den = c.dH / c.Tm - R_GAS * Math.log(Math.min(1, xi));
      const T = num / den;
      return T > 0 ? T : 0;
    },
  };
}
