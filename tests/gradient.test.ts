import { expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { PhaseDiagram } from '../src/core/diagram';
it('解析梯度 gradTsat 与中心差分一致（全部预设、全部固相，相对误差 < 1e-4）', () => {
  for (const p of PRESETS) {
    const d = new PhaseDiagram(p.params);
    let worst = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 300; k++) {
      const a = 0.05 + 0.9 * rnd(), b = (0.9 - 0.9 * a + 0.05) * rnd() + 0.02; const c = 1 - a - b; if (c < 0.02) continue;
      const x: [number, number, number] = [a, b, c];
      for (let si = 0; si < d.ns; si++) {
        const g = d.th.gradTsat(si, x); if (!g) continue;
        const h = 1e-6;
        for (const dir of [[1, -1, 0], [0, 1, -1], [1, 0, -1]]) {
          const xp: any = x.map((v, i) => v + h * dir[i]), xm: any = x.map((v, i) => v - h * dir[i]);
          const fd = (d.th.Tsat(si, xp) - d.th.Tsat(si, xm)) / (2 * h);
          const an = g[0] * dir[0] + g[1] * dir[1] + g[2] * dir[2];
          // 只比较两侧都有定义（T_s > 0）的点：T_s = 0 处是分段定义的边界
          if (Number.isFinite(fd) && d.th.Tsat(si, x) > 1 && d.th.Tsat(si, xp) > 1 && d.th.Tsat(si, xm) > 1) worst = Math.max(worst, Math.abs(fd - an) / (1 + Math.abs(fd)));
        }
      }
    }
    expect(worst).toBeLessThan(1e-4);
  }
});

it('单变线求点：牛顿迭代平均 ≤ 5 次，回退到初值的比例 < 1%', async () => {
  const { PRESETS } = await import('../src/core/presets');
  const { PhaseDiagram } = await import('../src/core/diagram');
  let calls = 0;
  let fallbacks = 0;
  let iters = 0;
  for (const p of PRESETS) {
    const d = new PhaseDiagram(p.params);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 1; k < 60; k++) {
      const T = Tmin + (k / 60) * (Tmax - Tmin);
      for (let a = 0; a < d.ns; a++) for (let b = a + 1; b < d.ns; b++) d.univariantAt(a, b, T);
    }
    calls += d.refineStats.calls;
    fallbacks += d.refineStats.fallbacks;
    iters += d.refineStats.iters;
  }
  expect(calls).toBeGreaterThan(100);
  expect(fallbacks / calls).toBeLessThan(0.01);
  expect(iters / Math.max(1, calls - fallbacks)).toBeLessThanOrEqual(5);
});

it('liquidusGradient（解析）与中心差分一致', async () => {
  const { PRESETS } = await import('../src/core/presets');
  const { PhaseDiagram } = await import('../src/core/diagram');
  const { liquidusGradient, compToCart, cartToComp } = await import('../src/math/spaces');
  for (const p of PRESETS) {
    const d = new PhaseDiagram(p.params);
    for (const x of [[0.4, 0.3, 0.3], [0.2, 0.5, 0.3], [0.6, 0.2, 0.2], [0.1, 0.2, 0.7]] as [number, number, number][]) {
      const L = d.liquidus(x);
      const [u, v] = compToCart(x);
      const h = 1e-5;
      const f = (uu: number, vv: number) => d.th.Tsat(L.si, cartToComp(uu, vv));
      const fd = [(f(u + h, v) - f(u - h, v)) / (2 * h), (f(u, v + h) - f(u, v - h)) / (2 * h)];
      const g = liquidusGradient(d, x).g;
      expect(Math.abs(g[0] - fd[0]) / (1 + Math.abs(fd[0]))).toBeLessThan(1e-4);
      expect(Math.abs(g[1] - fd[1]) / (1 + Math.abs(fd[1]))).toBeLessThan(1e-4);
    }
  }
});
