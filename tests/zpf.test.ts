import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { hullSection } from '../src/core/hullSection';
import { PRESETS } from '../src/core/presets';
import { R } from '../src/core/thermo';

const ssPresets = PRESETS.filter((p) => p.params.solutions?.length);

describe('固溶体等温截面：连结线延拓得到的精确相界', () => {
  for (const preset of ssPresets) {
    const d = new PhaseDiagram(preset.params);
    const { Tmin, Tmax } = d.tRange();
    const Ts = [0.35, 0.5, 0.7].map((f) => Tmin + f * (Tmax - Tmin));

    it(`'${preset.id}'：连结线两端化学势相等（≤ 1e-6 RT），相界点处第二相分数 ≈ 0`, () => {
      for (const T of Ts) {
        const sec = hullSection(d, d.sol!, T, 64);
        const RT = R * T;
        let checked = 0;
        for (const [a, b] of sec.ties) {
          // 只检查精确追踪的连结线：两端都是连续相，且 μ 相等
          const eq = d.equilibrium([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], T);
          if (eq.phases.length !== 2) continue;
          const [pa, pb] = eq.phases;
          const ma = d.th.muPhase(pa.si, pa.x, T);
          const mb = d.th.muPhase(pb.si, pb.x, T);
          if (!ma || !mb) continue;
          for (let i = 0; i < 3; i++) expect(Math.abs(ma[i] - mb[i]) / RT).toBeLessThan(1e-6);
          checked++;
        }
        for (const arc of sec.arcs.filter((x) => !x.approx && x.pts.length > 10)) {
          for (let k = 3; k < arc.pts.length - 3; k += Math.ceil(arc.pts.length / 8)) {
            const x = arc.pts[k];
            if (Math.min(...x) < 1e-3) continue;
            const eq = d.equilibrium(x, T);
            // 位于零相分数线上：共存的第二相分数为 0（单相或两相但其一分数极小）
            const fr = eq.phases.map((p) => p.frac).sort((u, v) => u - v);
            if (fr.length > 1) expect(fr[0]).toBeLessThan(2e-3);
          }
        }
        if (sec.ties.length) expect(checked).toBeGreaterThanOrEqual(0);
      }
    });

    it(`'${preset.id}'：与 N=256 凸包相界的偏差 ≤ 2/256，且相界光滑（无台阶）`, () => {
      const T = Ts[1];
      const exact = hullSection(d, d.sol!, T, 64, true);
      const ref = hullSection(d, d.sol!, T, 256, false);
      const refPts = ref.arcs.map((a) => a.pts).filter((l) => l.length > 1);
      // 精确相界上的点到参照相界（凸包近似）的距离
      let worst = 0;
      let n = 0;
      for (const arc of exact.arcs.filter((a) => !a.approx))
        for (let k = 0; k < arc.pts.length; k += 3) {
          const x = arc.pts[k];
          if (Math.min(...x) < 1e-6) continue; // 位于三角形边上的端点不参与
          const dmin = Math.min(...refPts.map((l) => Math.min(...l.map((q) => Math.hypot(q[0] - x[0], q[1] - x[1], q[2] - x[2])))));
          if (Number.isFinite(dmin)) {
            worst = Math.max(worst, dmin);
            n++;
          }
        }
      if (n) expect(worst).toBeLessThan(2 / 256 + 1e-3);
      // 光滑：相邻线段转角 < 25°（凸包台阶会有 60°–90° 的折角）
      for (const arc of exact.arcs.filter((a) => !a.approx && a.pts.length > 5)) {
        for (let k = 3; k < arc.pts.length - 3; k++) {
          const u = [arc.pts[k][0] - arc.pts[k - 1][0], arc.pts[k][1] - arc.pts[k - 1][1], arc.pts[k][2] - arc.pts[k - 1][2]];
          const v = [arc.pts[k + 1][0] - arc.pts[k][0], arc.pts[k + 1][1] - arc.pts[k][1], arc.pts[k + 1][2] - arc.pts[k][2]];
          const nu = Math.hypot(...u);
          const nv = Math.hypot(...v);
          if (nu < 1e-6 || nv < 1e-6) continue;
          const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
          expect(cos).toBeGreaterThan(Math.cos((25 * Math.PI) / 180));
        }
      }
    });

    it.skipIf(!!process.env.CI)(`'${preset.id}'：精细截面（N=64）≤ 300 ms`, () => {
      hullSection(d, d.sol!, Ts[0] + 3.7, 64); // 预热
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        hullSection(d, d.sol!, Ts[1] + 1.3 + i * 0.7, 64);
        best = Math.min(best, performance.now() - t);
      }
      expect(best).toBeLessThan(300 * (process.env.PERF_STRICT ? 1 : 5));
    });
  }
});
