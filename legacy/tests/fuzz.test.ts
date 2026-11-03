import { expect, test } from 'vitest';
import { TernaryEutecticDiagram } from '../src/core/diagram';
import { REGULAR_PARAMS, SYSTEMS } from '../src/core/registry';
import type { Comp, ModelParams } from '../src/core/types';

// 在界面允许的参数范围内随机抽样：通过 validate() 的模型必须满足杠杆规则与截面一致性
test('random parameter sets: valid models are self-consistent', () => {
  let valid = 0;
  for (let n = 0; n < 60; n++) {
    const p: ModelParams = JSON.parse(JSON.stringify(REGULAR_PARAMS));
    p.components.forEach((c) => {
      c.Tm = 600 + 273.15 + Math.random() * 1400;
      c.dH = 8000 + Math.random() * 50000;
    });
    p.omega = { AB: -30000 + Math.random() * 38000, BC: -30000 + Math.random() * 38000, CA: -30000 + Math.random() * 38000 };
    let d: TernaryEutecticDiagram;
    try {
      d = new TernaryEutecticDiagram(SYSTEMS[0].meta, p);
    } catch {
      continue;
    }
    if (d.validate().length) continue;
    valid++;
    for (let m = 0; m < 300; m++) {
      const a = Math.random();
      const b = Math.random() * (1 - a);
      const x: Comp = [a, b, 1 - a - b];
      const T = d.tRange[0] + Math.random() * (d.tRange[1] - d.tRange[0]);
      const eq = d.equilibrium(x, T);
      for (let k = 0; k < 3; k++) {
        const bal = eq.phases.reduce((s, ph) => s + ph.fraction * ph.comp[k], 0);
        expect(bal).toBeCloseTo(x[k], 6);
      }
      if (eq.region !== 'L' && eq.liquid) expect(d.liquidus(eq.liquid).T).toBeCloseTo(T, 2);
    }
  }
  expect(valid).toBeGreaterThan(10);
});
