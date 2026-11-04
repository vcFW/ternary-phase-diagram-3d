import { computeTrace } from '../src/core/cooling';
import { PhaseDiagram } from '../src/core/diagram';
import type { Comp, SystemParams } from '../src/core/types';

const comps = (): SystemParams['components'] => [
  { symbol: 'A', name: '组元 A', Tm: 1573.15, dH: 21000 },
  { symbol: 'B', name: '组元 B', Tm: 1223.15, dH: 15000 },
  { symbol: 'C', name: '组元 C', Tm: 1423.15, dH: 18000 },
];
const params: SystemParams = {
  components: comps(),
  omega: { AB: 3330, AC: 3824, BC: -4288 },
  compounds: [{ id: 'S', label: 'S', formula: 'S', n: [0.397, 0.14, 0.463], dHf: -1482, dSf: 0.49 }],
  Cp: 30,
};
const d = new PhaseDiagram(params);
console.log('invariants:');
for (const iv of d.topo.invariants) console.log(' ', iv.id, iv.rank, iv.reaction.type, iv.reaction.text, (iv.T - 273.15).toFixed(0) + '°C', iv.x.map((v) => v.toFixed(3)).join(','));
console.log('fields:', d.topo.fields.map((f) => `${d.solids[f.si].label}:${(f.area * 100).toFixed(1)}%`).join(' '));
console.log('S congruent:', d.topo.compounds.map((c) => `${d.solids[c.si].label}:${c.congruent}`).join(' '));
const out: string[] = [];
for (let a = 0.1; a < 0.9; a += 0.1)
  for (let b = 0.05; b < 0.9 - a; b += 0.1) {
    const x: Comp = [a, b, 1 - a - b];
    const tr = computeTrace(d, x);
    out.push(`${x.map((v) => v.toFixed(2)).join(',')} -> ${tr.finalKey}  | ${tr.events.filter((e) => e.kind !== 'end').map((e) => e.title.slice(0, 22)).join(' ; ')}`);
  }
console.log(out.join('\n'));
