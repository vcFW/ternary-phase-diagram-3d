import { describe, expect, it } from 'vitest';
import { computeTrace } from '../src/core/cooling';
import { PhaseDiagram } from '../src/core/diagram';
import { getPreset } from '../src/core/presets';

describe("预设 'ternary-peritectic'：含三类三元不变点", () => {
  const preset = getPreset('ternary-peritectic');
  const d = new PhaseDiagram(preset.params);
  const tern = d.topo.invariants.filter((v) => v.rank === 'ternary');

  it('三元不变点恰含共晶 E、过渡点 U、双转熔点 P 各一个', () => {
    expect(tern.map((v) => v.reaction.type).sort()).toEqual(['eutectic', 'peritectic', 'transition']);
    const P = tern.find((v) => v.reaction.type === 'peritectic')!;
    // L + A + C ⇌ S：两个固相被消耗（反应系数两个负号）
    expect(P.reaction.terms.filter((t) => t.si >= 0 && t.coef < -1e-7).length).toBe(2);
    expect(P.reaction.text).toContain('⇌ S');
  });

  it('四个初晶区面积均 ≥ 3%；S 为不一致熔融', () => {
    expect(d.topo.fields.length).toBe(4);
    for (const f of d.topo.fields) expect(f.area).toBeGreaterThanOrEqual(0.03);
    expect(d.topo.compounds[0].congruent).toBe(false);
  });

  it('典型成分：终点在 P / 穿过 P 后到 E / 经 U / S 初晶；终态与事件序列符合描述', () => {
    const ev = (x: number[]) => computeTrace(d, x as [number, number, number]).events.map((e) => e.title);
    const [endAtP, throughP, viaU, sPrimary] = preset.examples;
    expect(ev(endAtP.x).some((t) => t.startsWith('P'))).toBe(true);
    expect(ev(endAtP.x).some((t) => t.startsWith('E'))).toBe(false);
    expect(ev(throughP.x).some((t) => t.startsWith('P'))).toBe(true);
    expect(ev(throughP.x).some((t) => t.startsWith('E'))).toBe(true);
    expect(ev(viaU.x).some((t) => t.startsWith('U'))).toBe(true);
    expect(ev(sPrimary.x).some((t) => t.startsWith('P') || t.startsWith('U'))).toBe(false);
  });
});
