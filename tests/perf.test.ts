import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS } from '../src/core/presets';

/**
 * 各体系构建耗时上限（取 3 次最快者）。
 * npm test 默认并行跑全部测试文件，CPU 争用会放大耗时，故阈值放宽 5 倍；
 * `npm run test:perf` 串行、严格阈值（性能预算的正式口径）。CI 环境跳过。
 */
const K = process.env.PERF_STRICT ? 1 : 5;
describe.skipIf(!!process.env.CI)('性能：new PhaseDiagram 耗时上限', () => {
  for (const p of PRESETS) {
    const limit = (p.params.solutions?.length ? 250 : 100) * K;
    it(`'${p.id}' ≤ ${limit} ms`, () => {
      new PhaseDiagram(p.params); // 预热 JIT
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        new PhaseDiagram(p.params);
        best = Math.min(best, performance.now() - t);
      }
      expect(best).toBeLessThan(limit);
    });
  }
});
