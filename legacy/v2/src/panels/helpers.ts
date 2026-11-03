import type { PhaseDiagram } from '../core/diagram';
import type { Comp } from '../core/types';

export function liquidusInfo(d: PhaseDiagram, x: Comp) {
  const q = d.liquidus(x);
  return { T: q.T, phase: d.solids[q.si].label };
}
