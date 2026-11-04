import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS } from '../src/core/presets';
import { simplex3 } from '../src/core/solution';
import type { Comp } from '../src/core/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 枚举所有 3 列基的参照最优值 */
function bruteLP(Y: Comp[], G: number[], x0: Comp): number {
  let best = Infinity;
  const n = Y.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++) {
        const cols = [Y[a], Y[b], Y[c]];
        const det =
          cols[0][0] * (cols[1][1] * cols[2][2] - cols[2][1] * cols[1][2]) -
          cols[1][0] * (cols[0][1] * cols[2][2] - cols[2][1] * cols[0][2]) +
          cols[2][0] * (cols[0][1] * cols[1][2] - cols[1][1] * cols[0][2]);
        if (Math.abs(det) < 1e-12) continue;
        // Cramer
        const M = (k: number) => {
          const c2 = cols.map((v, i) => (i === k ? x0 : v));
          return (
            c2[0][0] * (c2[1][1] * c2[2][2] - c2[2][1] * c2[1][2]) -
            c2[1][0] * (c2[0][1] * c2[2][2] - c2[2][1] * c2[0][2]) +
            c2[2][0] * (c2[0][1] * c2[1][2] - c2[1][1] * c2[0][2])
          );
        };
        const f = [M(0) / det, M(1) / det, M(2) / det];
        if (f.some((v) => v < -1e-10)) continue;
        best = Math.min(best, f[0] * G[a] + f[1] * G[b] + f[2] * G[c]);
      }
  return best;
}

describe('LP（单纯形）健壮性', () => {
  it('退化算例：x₀ 在顶点 / 边上，多列共面 G，状态为 optimal 且目标值与枚举法一致', () => {
    const r = rng(11);
    for (let trial = 0; trial < 300; trial++) {
      // 列：三个顶点 + 若干在边 / 顶点 / 内部的点；大部分列的 G 落在同一平面（四个共面列）
      const plane = [r() * 4 - 2, r() * 4 - 2, r() * 4 - 2];
      const Y: Comp[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const extra = 6 + Math.floor(r() * 4);
      for (let k = 0; k < extra; k++) {
        const t = r();
        const kind = Math.floor(r() * 3);
        Y.push(kind === 0 ? [t, 1 - t, 0] : kind === 1 ? [0, t, 1 - t] : [t / 2, t / 2, 1 - t]);
      }
      const G = Y.map((y, i) => y[0] * plane[0] + y[1] * plane[1] + y[2] * plane[2] + (i % 3 === 0 ? 0 : r() < 0.5 ? 0 : r() * 0.5));
      const x0s: Comp[] = [[1, 0, 0], [0.5, 0.5, 0], [0, 0.3, 0.7], [0.2, 0.3, 0.5]];
      for (const x0 of x0s) {
        const res = simplex3(Y, G, x0, [0, 1, 2], 500);
        expect(res.status).toBe('optimal');
        expect(res.iterations).toBeLessThan(100);
        const obj = res.basis.reduce((s, j, k) => s + res.f[k] * G[j], 0);
        expect(Math.abs(obj - bruteLP(Y, G, x0))).toBeLessThan(1e-8);
      }
    }
  });
});

describe('各体系在边 / 顶点 / 三相三角形顶点上逐点求解', () => {
  for (const p of PRESETS.filter((q) => q.params.solutions)) {
    it(`'${p.id}'：求解器无警告`, () => {
      const d = new PhaseDiagram(p.params);
      const { Tmin, Tmax } = d.tRange();
      const pts: Comp[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.4, 0.3, 0.3]];
      for (const iv of d.topo.invariants) pts.push(iv.x, ...iv.solidX);
      const warned: string[] = [];
      for (const x of pts) for (const f of [0.15, 0.5, 0.9]) {
        const T = Tmin + f * (Tmax - Tmin);
        const eq = d.equilibrium(x, T);
        if (eq.warning) warned.push(`${x.map((v) => v.toFixed(3))} @${T.toFixed(0)}: ${eq.warning}`);
      }
      expect(warned).toEqual([]);
    });
  }
});
