import type { PhaseDiagram } from '../core/diagram';
import type { Comp } from '../core/types';

/**
 * Gulliver–Scheil 凝固（极限非平衡模型）—— 明确的假设：
 *   1. 固相中无扩散（已析出的固相被"冻结"，不再参与反应，因此不会被回溶）；
 *   2. 液相内完全混合（液相成分均匀）；
 *   3. 固/液界面处局部平衡（每一步液相按平衡相图析出固相）。
 * 它是扩散极慢的极限，而不是动力学预测：真实凝固介于平衡冷却与 Scheil 之间，需要扩散/动力学模型才能定量。
 *
 * 对本模型（化学计量固相）的实现：每降 dT，把"当前液相"作为新的总成分求平衡；
 * 新析出的固相计入累积量并移出体系，剩余液相继续冷却。
 */
export interface ScheilStep {
  T: number;
  /** 剩余液相分数（相对初始总量） */
  fL: number;
  xL: Comp;
  /** 当步析出的固相 */
  forming: string[];
  /** 累积固相（数量） */
  solids: Record<string, number>;
  /** 累积固相的平均成分（固溶体逐层析出、成分各不相同；化学计量相即其成分） */
  solidsX: Record<string, Comp>;
}

export function scheil(d: PhaseDiagram, x0: Comp, opts?: { dT?: number; Tend?: number; fLmin?: number }): ScheilStep[] {
  const dT = opts?.dT ?? 1;
  const Tend = opts?.Tend ?? d.tRange().Tmin;
  const fLmin = opts?.fLmin ?? 1e-4;
  let xL: Comp = [...x0] as Comp;
  let fL = 1;
  const acc: Record<string, number> = {};
  const accX: Record<string, Comp> = {};
  const out: ScheilStep[] = [];
  let T = d.liquidus(x0).T + 0.01;
  out.push({ T, fL, xL, forming: [], solids: {}, solidsX: {} });
  let hint: ReturnType<PhaseDiagram['equilibrium']> | null = null;
  while (T > Tend && fL > fLmin) {
    T -= dT;
    const eq = d.equilibrium(xL, T, hint);
    hint = eq;
    const L = eq.phases.find((p) => p.si < 0);
    const forming: string[] = [];
    for (const p of eq.phases) {
      if (p.si < 0) continue;
      const m = fL * p.frac;
      const old = acc[p.id] ?? 0;
      const ox = accX[p.id] ?? p.x;
      accX[p.id] = [0, 1, 2].map((i) => (old * ox[i] + m * p.x[i]) / (old + m || 1)) as Comp;
      acc[p.id] = old + m;
      forming.push(p.id);
    }
    if (!L) {
      fL = 0;
      out.push({ T, fL, xL, forming, solids: { ...acc }, solidsX: { ...accX } });
      break;
    }
    fL *= L.frac;
    xL = L.x;
    out.push({ T, fL, xL, forming, solids: { ...acc }, solidsX: { ...accX } });
  }
  return out;
}
