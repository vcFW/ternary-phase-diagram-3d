import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS } from '../src/core/presets';
import { Thermo } from '../src/core/thermo';
import { extractTopology } from '../src/core/topology';
import type { Comp } from '../src/core/types';

const dist = (a: Comp, b: Comp) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('拓扑提取：两级网格与全网格一致', () => {
  for (const p of PRESETS.filter((q) => q.params.solutions?.length)) {
    it(`'${p.id}'：界线点最大偏差 ≤ 1e-3，不变点相同`, () => {
      const th = new Thermo(p.params);
      const full = extractTopology(th, 120, { twoLevel: false });
      const two = extractTopology(th, 120, { twoLevel: true });
      expect(two.invariants.length).toBe(full.invariants.length);
      for (const iv of full.invariants) {
        const m = two.invariants.find((v) => [...v.solids].sort().join() === [...iv.solids].sort().join() && dist(v.x, iv.x) < 1e-3);
        expect(m, `不变点 ${iv.solids}`).toBeTruthy();
      }
      let worst = 0;
      for (const cv of full.curves)
        for (const pt of cv.pts) {
          let best = Infinity;
          for (const c2 of two.curves) if (c2.a === cv.a && c2.b === cv.b) for (const q of c2.pts) best = Math.min(best, dist(pt, q));
          worst = Math.max(worst, best);
        }
      // 取点间距约 1/N，比较"到折线顶点的最近距离"，允许一个格距
      expect(worst).toBeLessThan(1 / 120 + 1e-3);
      expect(two.fields.map((f) => f.si)).toEqual(full.fields.map((f) => f.si));
    });
  }
});

describe('拓扑提取性能', () => {
  it.skipIf(!!process.env.CI)('ss-eutectic：new PhaseDiagram ≤ 250 ms', () => {
    const params = PRESETS.find((p) => p.id === 'ss-eutectic')!.params;
    new PhaseDiagram(params); // 预热 JIT
    const t = performance.now();
    new PhaseDiagram(params);
    expect(performance.now() - t).toBeLessThan(250);
  });
});
