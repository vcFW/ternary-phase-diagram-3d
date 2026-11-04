/**
 * 一次性搜索脚本：在"含三元化合物 S 的体系"参数空间中寻找出现三元包晶点（双转熔点 P：L + α + β ⇌ γ）的参数组。
 * 用法：npx vite-node scripts/search-peritectic.ts [样本数] [随机种子]
 * 筛选：topo.invariants 中有 reaction.type === 'peritectic' 的三元点，且四个初晶区面积均 ≥ 3%；
 * 以"最小初晶区面积 + 转熔点与相邻不变点的温度间隔"排序，打印前若干组。选定的参数固化在 core/presets.ts。
 */
import { Thermo } from '../src/core/thermo';
import { extractTopology } from '../src/core/topology';
import type { Comp, SystemParams } from '../src/core/types';

const N = Number(process.argv[2] ?? 4000);
let seed = Number(process.argv[3] ?? 7) >>> 0;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const uni = (a: number, b: number) => a + (b - a) * rnd();

const base = (): SystemParams['components'] => [
  { symbol: 'A', name: '组元 A', Tm: 1573.15, dH: 21000 },
  { symbol: 'B', name: '组元 B', Tm: 1223.15, dH: 15000 },
  { symbol: 'C', name: '组元 C', Tm: 1423.15, dH: 18000 },
];

interface Hit {
  score: number;
  params: SystemParams;
  minArea: number;
  Tp: number;
  Tnext: number;
  invs: string;
}
const hits: Hit[] = [];
for (let k = 0; k < N; k++) {
  const comps = base();
  if (!process.env.NO_DTM) for (const c of comps) c.Tm += uni(-120, 120);
  const nS: Comp = (() => {
    const a = uni(0.15, 0.65);
    const b = uni(0.1, 1 - a - 0.1);
    return [a, b, 1 - a - b];
  })();
  const params: SystemParams = {
    components: comps,
    omega: { AB: uni(-5000, 5000), AC: uni(-5000, 5000), BC: uni(-5000, 5000) },
    compounds: [{ id: 'S', label: 'S', formula: 'S', n: nS, dHf: -uni(500, 6000), dSf: uni(-2, 2) }],
    Cp: 30,
  };
  let topo;
  try {
    topo = extractTopology(new Thermo(params), 90);
  } catch {
    continue;
  }
  const per = topo.invariants.filter((v) => v.rank === 'ternary' && v.reaction.type === 'peritectic');
  if (!per.length) continue;
  if (topo.fields.length < 4 || topo.fields.some((f) => f.area < 0.03)) continue;
  const minArea = Math.min(...topo.fields.map((f) => f.area));
  const tern = topo.invariants.filter((v) => v.rank === 'ternary');
  const P = per[0];
  const others = tern.filter((v) => v !== P).map((v) => Math.abs(v.T - P.T));
  const gap = others.length ? Math.min(...others) : 0;
  hits.push({ score: minArea * 10 + Math.min(gap, 60) / 60, params, minArea, Tp: P.T, Tnext: gap, invs: tern.map((v) => `${v.reaction.type[0]}${(v.T - 273.15).toFixed(0)}`).join(' ') });
}
hits.sort((a, b) => b.score - a.score);
console.log(`样本 ${N}，满足条件 ${hits.length}`);
for (const h of hits.slice(0, 8)) {
  const s = h.params.compounds[0];
  console.log(
    `score ${h.score.toFixed(3)} minArea ${(h.minArea * 100).toFixed(1)}% P=${(h.Tp - 273.15).toFixed(0)}°C gap ${h.Tnext.toFixed(0)}K  [${h.invs}]  n=${s.n.map((v) => v.toFixed(3))} dHf=${s.dHf.toFixed(0)} dSf=${s.dSf.toFixed(2)} Ω=${Object.values(h.params.omega).map((v) => v.toFixed(0))} dTm=${h.params.components.map((c, i) => (c.Tm - base()[i].Tm).toFixed(0))}`,
  );
}
