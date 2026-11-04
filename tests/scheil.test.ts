import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS } from '../src/core/presets';
import { scheil } from '../src/math/scheil';

describe('Scheil：自适应步长与事件定位', () => {
  for (const p of PRESETS) {
    const d = new PhaseDiagram(p.params);
    it(`'${p.id}'：与固定 0.25 K 步长的终态一致，步数显著减少，液相分数单调`, () => {
      for (const ex of p.examples.slice(0, 2)) {
        const a = scheil(d, ex.x);
        const b = scheil(d, ex.x, { dT: 0.25 });
        const fa = a[a.length - 1];
        const fb = b[b.length - 1];
        for (const id of new Set([...Object.keys(fa.solids), ...Object.keys(fb.solids)])) expect(Math.abs((fa.solids[id] ?? 0) - (fb.solids[id] ?? 0))).toBeLessThan(2e-3);
        if (b.length > 50) expect(a.length).toBeLessThan(b.length);
        for (let i = 1; i < a.length; i++) expect(a[i].fL).toBeLessThanOrEqual(a[i - 1].fL + 1e-12);
      }
    });
  }

  it("'ss-eutectic' 默认成分：步数 ≤ 200（原 747）", () => {
    const d = new PhaseDiagram(PRESETS.find((p) => p.id === 'ss-eutectic')!.params);
    expect(scheil(d, [0.6, 0.25, 0.15]).length).toBeLessThanOrEqual(200);
  });

  it("'simple-eutectic'：终凝平台温度 = 三元共晶点温度（≤ 0.1 K），平台上液相一次耗尽", () => {
    const d = new PhaseDiagram(PRESETS.find((p) => p.id === 'simple-eutectic')!.params);
    const E = d.topo.invariants.find((v) => v.rank === 'ternary')!;
    const st = scheil(d, [0.35, 0.3, 0.35]);
    const fin = st[st.length - 1];
    expect(fin.plateau).toBe(true);
    expect(fin.fL).toBe(0);
    expect(Math.abs(fin.T - E.T)).toBeLessThan(0.1);
    expect(Object.keys(fin.solids).sort().join()).toBe('A,B,C');
  });
});
