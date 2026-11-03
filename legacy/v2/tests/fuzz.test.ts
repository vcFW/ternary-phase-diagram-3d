import { describe, expect, it } from 'vitest';
import { computeTrace } from '../src/core/cooling';
import { PhaseDiagram } from '../src/core/diagram';
import { isothermal } from '../src/core/isothermal';
import { PRESETS } from '../src/core/presets';
import { buildParams, defaultOverride } from '../src/state/store';
import type { Comp } from '../src/core/types';
import { verticalRaster } from '../src/core/vertical';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('随机参数扫描：任意合法参数下引擎自洽、不抛错', () => {
  const r = rng(11);
  for (let k = 0; k < 14; k++) {
    const p = PRESETS[k % 3];
    const ov = defaultOverride();
    if (p.tunable >= 0) ov.stab = 200 + r() * 5800;
    ov.omega = (r() - 0.55) * 11000;
    ov.dTm = [(r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 300];
    it(`${p.id} #${k}`, () => {
      const d = new PhaseDiagram(buildParams(p, ov));
      const { Tmin, Tmax } = d.tRange();
      expect(Tmax).toBeGreaterThan(Tmin);
      for (const iv of d.topo.invariants.filter((v) => v.rank === 'ternary')) {
        for (const s of iv.solids) expect(Math.abs(d.th.Tsat(s, iv.x) - iv.T)).toBeLessThan(1e-2);
      }
      for (let q = 0; q < 4; q++) {
        const a = r();
        const b = r() * (1 - a);
        const x: Comp = [a, b, 1 - a - b];
        const tr = computeTrace(d, x);
        expect(tr.samples.length).toBeGreaterThan(2);
        expect(tr.finalKey.includes('L')).toBe(false);
      }
      const sec = isothermal(d, Tmin + (Tmax - Tmin) * 0.4);
      expect(sec.regions.length).toBeGreaterThan(0);
      const ras = verticalRaster(d, { p1: [0.2, 0.8, 0], p2: [0.3, 0, 0.7] }, 80, 60, Tmin, Tmax);
      expect(ras.keys.length).toBeGreaterThan(1);
    });
  }
});
