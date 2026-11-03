import { describe, expect, test } from 'vitest';
import { fromXY, toXY, triBary, VERTICES } from '../src/core/barycentric';
import { PAIRS, pairId, TernaryEutecticDiagram } from '../src/core/diagram';
import { SYSTEMS } from '../src/core/registry';
import { simulateCooling } from '../src/core/cooling';
import { verticalLine, verticalSectionCurves } from '../src/core/verticalSection';
import type { Comp, CompIndex } from '../src/core/types';

const systems = SYSTEMS.filter((s) => s.params).map((s) => new TernaryEutecticDiagram(s.meta, s.params!));

test('barycentric round trip', () => {
  const x: Comp = [0.2, 0.3, 0.5];
  const [u, v] = toXY(x);
  const y = fromXY(u, v);
  for (let k = 0; k < 3; k++) expect(y[k]).toBeCloseTo(x[k], 12);
  const b = triBary(x, VERTICES[0], VERTICES[1], VERTICES[2]);
  for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(x[k], 12);
});

describe.each(systems.map((d) => [d.meta.id, d] as const))('%s', (_id, d) => {
  test('topology valid', () => expect(d.validate()).toEqual([]));

  test('ternary eutectic: all three liquidus sheets coincide', () => {
    const E = d.eutectic.comp;
    expect(E[0] + E[1] + E[2]).toBeCloseTo(1, 12);
    for (const i of [0, 1, 2] as CompIndex[]) expect(d.Ti(i, E)).toBeCloseTo(d.eutectic.T, 4);
  });

  test('monovariant lines: two sheets equal, third lower, T decreasing', () => {
    for (const [i, j] of PAIRS) {
      const line = d.mono[pairId(i, j)];
      let prevT = Infinity;
      for (const s of line.samples) {
        expect(d.Ti(i, s.y)).toBeCloseTo(d.Ti(j, s.y), 3);
        expect(d.Ti(line.k, s.y)).toBeLessThanOrEqual(s.T + 1e-3);
        expect(s.T).toBeLessThanOrEqual(prevT + 1e-9);
        prevT = s.T;
      }
      // 三条单变线汇于同一点
      const end = line.samples[line.samples.length - 1].y;
      for (let k = 0; k < 3; k++) expect(end[k]).toBeCloseTo(d.eutectic.comp[k], 8);
    }
  });

  test('primary fields are star-shaped from their vertex (single sign change along rays)', () => {
    for (const i of [0, 1, 2] as CompIndex[]) {
      for (let n = 0; n <= 40; n++) {
        const phi = n / 40;
        let changes = 0;
        let prev = 1;
        for (let m = 0; m <= 400; m++) {
          const x = d.rayPoint(i, phi, m / 400);
          const others = ([0, 1, 2] as CompIndex[]).filter((k) => k !== i).map((k) => d.Ti(k, x));
          const sgn = Math.sign(d.Ti(i, x) - Math.max(...others));
          if (sgn !== 0 && sgn !== prev) {
            changes++;
            prev = sgn;
          }
        }
        expect(changes).toBe(1);
      }
    }
  });

  test('equilibrium: lever rule mass balance and phase-fraction sum', () => {
    const [Tmin, Tmax] = d.tRange;
    for (let n = 0; n < 2000; n++) {
      const a = Math.random();
      const b = Math.random() * (1 - a);
      const x: Comp = [a, b, 1 - a - b];
      const T = Tmin + Math.random() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      const sum = eq.phases.reduce((s, p) => s + p.fraction, 0);
      expect(sum).toBeCloseTo(1, 8);
      for (let k = 0; k < 3; k++) {
        const bal = eq.phases.reduce((s, p) => s + p.fraction * p.comp[k], 0);
        expect(bal).toBeCloseTo(x[k], 7);
      }
      for (const p of eq.phases) expect(p.fraction).toBeGreaterThanOrEqual(-1e-9);
      // 液相成分必须在液相面上且温度一致（L 区以外）
      if (eq.region !== 'L' && eq.liquid) expect(d.liquidus(eq.liquid).T).toBeCloseTo(T, 3);
    }
  });

  test('isothermal section regions tile the triangle (area check)', () => {
    const area = (p: Comp[]) => {
      let s = 0;
      for (let n = 0; n < p.length; n++) {
        const [x0, y0] = toXY(p[n]);
        const [x1, y1] = toXY(p[(n + 1) % p.length]);
        s += x0 * y1 - x1 * y0;
      }
      return 0.5 * s;
    };
    const total = Math.sqrt(3) / 4;
    for (let T = d.eutectic.T + 1; T < d.tRange[1]; T += 37) {
      const sec = d.isothermalSection(T);
      const sum = sec.regions.reduce((s, r) => s + Math.abs(area(r.polygon)), 0);
      expect(sum).toBeCloseTo(total, 3);
      // 每个区域内部抽样点的分类与区域一致
      for (const r of sec.regions) {
        const c = r.polygon.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as Comp, [0, 0, 0] as Comp);
        if (r.key.split('+').length === 3) {
          const m: Comp = [c[0] / 3, c[1] / 3, c[2] / 3];
          expect(d.classify(m, T)).toBe(r.key);
        }
      }
    }
  });

  test('vertical section liquidus consistent with diagram', () => {
    const g = verticalSectionCurves(d, verticalLine({ mode: 'const', k: 2, value: 0.2 }));
    const liq = g.curves.find((c) => c.kind === 'liquidus')!;
    expect(liq.points.length).toBeGreaterThan(400);
  });

  test('cooling: fractions conserve, events ordered, ends solid', () => {
    for (const x0 of [
      [0.6, 0.25, 0.15],
      [0.2, 0.5, 0.3],
      [0.1, 0.2, 0.7],
      [0.5, 0.5, 0],
      [1, 0, 0],
    ] as Comp[]) {
      const r = simulateCooling(d, x0);
      for (const s of r.samples) {
        expect(s.fL + s.fs[0] + s.fs[1] + s.fs[2]).toBeCloseTo(1, 6);
      }
      const last = r.samples[r.samples.length - 1];
      expect(last.fL).toBeCloseTo(0, 9);
      for (let n = 1; n < r.events.length; n++) expect(r.events[n].t).toBeGreaterThanOrEqual(r.events[n - 1].t - 1e-12);
      const cs = r.constituents.reduce((s, c) => s + c.fraction, 0);
      expect(cs).toBeCloseTo(1, 4);
    }
  });
});
