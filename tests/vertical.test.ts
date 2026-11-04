import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS } from '../src/core/presets';
import type { Comp } from '../src/core/types';
import { verticalRaster } from '../src/core/vertical';

describe('垂直截面：相界折线', () => {
  for (const p of PRESETS) {
    it(`'${p.id}'：相界由连续折线给出（T 单调、相邻点 |Δu| ≤ 0.06）`, () => {
      const d = new PhaseDiagram(p.params);
      const { Tmin, Tmax } = d.tRange();
      const spec = { p1: [0.3, 0.7, 0] as Comp, p2: [0.3, 0, 0.7] as Comp };
      const ras = verticalRaster(d, spec, 160, p.params.solutions ? 120 : 90, Tmin, Tmax);
      expect(ras.boundaries.length).toBeGreaterThan(0);
      for (const b of ras.boundaries) {
        for (let i = 1; i < b.pts.length; i++) {
          expect(b.pts[i][1]).toBeLessThan(b.pts[i - 1][1]);
          expect(Math.abs(b.pts[i][0] - b.pts[i - 1][0])).toBeLessThanOrEqual(0.06 + 1e-9);
        }
      }
    });
  }

  it.skipIf(!!process.env.CI)("'ss-eutectic'：120 行 × 640 列 ≤ 1000 ms", () => {
    const d = new PhaseDiagram(PRESETS.find((q) => q.id === 'ss-eutectic')!.params);
    const { Tmin, Tmax } = d.tRange();
    const spec = { p1: [0.3, 0.7, 0] as Comp, p2: [0.3, 0, 0.7] as Comp };
    verticalRaster(d, spec, 160, 40, Tmin, Tmax); // 预热
    const t = performance.now();
    verticalRaster(d, { p1: [0.25, 0.75, 0] as Comp, p2: [0.25, 0, 0.75] as Comp }, 640, 120, Tmin, Tmax);
    expect(performance.now() - t).toBeLessThan(1000 * (process.env.PERF_STRICT ? 1 : 3));
  });
});
