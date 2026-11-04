import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { getPreset } from '../src/core/presets';
import type { Comp } from '../src/core/types';
import { effectiveComponents, phaseRule } from '../src/math/phaseRule';

const build = (id: string) => new PhaseDiagram(getPreset(id).params);
const at = (d: PhaseDiagram, x: Comp, T: number) => {
  const eq = d.equilibrium(x, T);
  return { eq, r: phaseRule(d, eq, x) };
};

describe('相律：有效组元数', () => {
  const d = build('simple-eutectic');
  const Tl = (x: Comp) => d.liquidus(x).T;

  it('三角形内部 L + A：C = 3，F = 2', () => {
    const x: Comp = [0.7, 0.1, 0.2];
    const { eq, r } = at(d, x, Tl(x) - 20);
    expect(eq.key).toBe('L+A');
    expect(r).toMatchObject({ C: 3, P: 2, F: 2 });
  });

  it('A–B 边上 L + A：C = 2，F = 1', () => {
    const x: Comp = [0.5, 0.5, 0];
    const { eq, r } = at(d, x, Tl(x) - 20);
    expect(eq.phases.length).toBe(2);
    expect(r).toMatchObject({ C: 2, P: 2, F: 1 });
    expect(r.reason).toContain('C = 2');
  });

  it('顶点 A：纯固相、纯液相均 C = 1，F = 1', () => {
    const solid = at(d, [1, 0, 0], 600);
    expect(solid.r).toMatchObject({ C: 1, P: 1, F: 1 });
    const liq = at(d, [1, 0, 0], 2000);
    expect(liq.r).toMatchObject({ C: 1, P: 1, F: 1 });
  });

  it('平台上 F = 0', () => {
    const x: Comp = [0.35, 0.3, 0.35];
    const eq = d.equilibrium(x, Tl(x) - 20);
    expect(phaseRule(d, eq, x, true).F).toBe(0);
  });

  it('binary-congruent：D–C 伪二元连线上 C+D 区 C = 2，F = 1；偏离连线则 C = 3', () => {
    const dc = build('binary-congruent');
    const x: Comp = [0.3, 0.3, 0.4];
    const eq = dc.equilibrium(x, 400);
    expect(eq.key).toBe('C+D');
    expect(phaseRule(dc, eq, x)).toMatchObject({ C: 2, P: 2, F: 1 });
    const y: Comp = [0.32, 0.3, 0.38];
    const eqy = dc.equilibrium(y, 400);
    expect(eqy.phases.length).toBe(3);
    expect(phaseRule(dc, eqy, y).C).toBe(3);
  });

  it('binary-congruent：线外内部 L + D 两相区不降 C', () => {
    const dc = build('binary-congruent');
    const x: Comp = [0.4, 0.3, 0.3];
    const eq = dc.equilibrium(x, dc.liquidus(x).T - 5);
    expect(eq.key).toBe('L+D');
    expect(effectiveComponents(dc, x, eq).C).toBe(3);
  });

  it('binary-incongruent：D 不一致熔融，D–C 连线不是伪二元：C = 3', () => {
    const di = build('binary-incongruent');
    const x: Comp = [0.3, 0.3, 0.4];
    const eq = di.equilibrium(x, 400);
    expect(phaseRule(di, eq, x).C).toBe(3);
  });
});
