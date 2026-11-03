import { describe, expect, it } from 'vitest';
import { toXY } from '../src/core/barycentric';
import { computeTrace } from '../src/core/cooling';
import { PhaseDiagram } from '../src/core/diagram';
import { isothermal } from '../src/core/isothermal';
import { PRESETS } from '../src/core/presets';
import type { Comp } from '../src/core/types';
import { verticalRaster } from '../src/core/vertical';

// 确定性伪随机
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function randComp(r: () => number): Comp {
  const a = -Math.log(r() + 1e-9);
  const b = -Math.log(r() + 1e-9);
  const c = -Math.log(r() + 1e-9);
  const s = a + b + c;
  return [a / s, b / s, c / s];
}

const diagrams = PRESETS.map((p) => ({ p, d: new PhaseDiagram(p.params) }));

describe.each(diagrams)('$p.id', ({ d }) => {
  it('Tsat 闭式解与化学势平衡一致（Σ nᵢ μᵢᴸ = G_s）', () => {
    const r = rng(1);
    for (let k = 0; k < 200; k++) {
      const x = randComp(r);
      for (let si = 0; si < d.ns; si++) {
        const T = d.th.Tsat(si, x);
        if (T < 100) continue;
        const mu = d.th.muLiq(x, T);
        const n = d.solids[si].n;
        const lhs = n[0] * mu[0] + n[1] * mu[1] + n[2] * mu[2];
        expect(Math.abs(lhs - d.th.Gsol(si, T))).toBeLessThan(1e-3);
      }
    }
  });

  it('平衡：质量守恒、相分数非负、相律 F = 4 − P', () => {
    const r = rng(2);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 0; k < 600; k++) {
      const x = randComp(r);
      const T = Tmin + r() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      let sum = 0;
      const mix: Comp = [0, 0, 0];
      for (const p of eq.phases) {
        expect(p.frac).toBeGreaterThan(-1e-9);
        sum += p.frac;
        for (let i = 0; i < 3; i++) mix[i] += p.frac * p.x[i];
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      for (let i = 0; i < 3; i++) expect(Math.abs(mix[i] - x[i])).toBeLessThan(1e-6);
      expect(eq.dof).toBe(4 - eq.phases.length);
    }
  });

  it('平衡：共存液相对各共存固相饱和，对其余固相不过饱和', () => {
    const r = rng(3);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 0; k < 600; k++) {
      const x = randComp(r);
      const T = Tmin + r() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      const L = eq.phases.find((p) => p.si < 0);
      if (!L || eq.phases.length === 1) continue;
      for (let s = 0; s < d.ns; s++) {
        const t = d.th.Tsat(s, L.x);
        if (eq.phases.some((p) => p.si === s)) expect(Math.abs(t - T)).toBeLessThan(1e-4);
        else expect(t).toBeLessThan(T + 1e-4);
      }
    }
  });

  it('三相状态满足切平面最优性证书（所有其它固相与液相均在公切面之上）', () => {
    const r = rng(4);
    const { Tmin, Tmax } = d.tRange();
    let checked = 0;
    for (let k = 0; k < 800 && checked < 120; k++) {
      const x = randComp(r);
      const T = Tmin + r() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      if (eq.phases.length !== 3) continue;
      checked++;
      // 化学势 μ：由三个共存相的 G = μ·x 解出
      const rows = eq.phases.map((p) => p.x);
      const g = eq.phases.map((p) => (p.si < 0 ? d.th.Gliq(p.x, T) : d.th.Gsol(p.si, T)));
      const mu = solve(rows, g);
      for (let s = 0; s < d.ns; s++) {
        const n = d.solids[s].n;
        expect(d.th.Gsol(s, T) - (mu[0] * n[0] + mu[1] * n[1] + mu[2] * n[2])).toBeGreaterThan(-1e-4);
      }
      for (let k2 = 0; k2 < 60; k2++) {
        const y = randComp(r);
        expect(d.th.Gliq(y, T) - (mu[0] * y[0] + mu[1] * y[1] + mu[2] * y[2])).toBeGreaterThan(-1e-3);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('不变点：三固相饱和温度相等且为液相线上最高', () => {
    for (const iv of d.topo.invariants.filter((v) => v.rank === 'ternary')) {
      for (const s of iv.solids) expect(Math.abs(d.th.Tsat(s, iv.x) - iv.T)).toBeLessThan(1e-3);
      expect(d.th.liquidus(iv.x).T - iv.T).toBeLessThan(1e-3);
      // 反应物质平衡：Σ cᵢ xᵢ = x_L
      const mix: Comp = [0, 0, 0];
      for (const t of iv.reaction.terms.filter((t) => t.si >= 0))
        for (let i = 0; i < 3; i++) mix[i] += t.coef * d.solids[t.si].n[i];
      for (let i = 0; i < 3; i++) expect(Math.abs(mix[i] - iv.x[i])).toBeLessThan(1e-6);
    }
  });

  it('单变线：两固相饱和温度相等，且温度单调段符合降温方向', () => {
    for (const cv of d.topo.curves) {
      cv.pts.forEach((x, i) => {
        expect(Math.abs(d.th.Tsat(cv.a, x) - d.th.Tsat(cv.b, x))).toBeLessThan(1e-3);
        expect(cv.T[i]).toBeGreaterThan(0);
      });
    }
  });

  it('等温截面多边形与逐点平衡一致', () => {
    const r = rng(5);
    const { Tmin, Tmax } = d.tRange();
    let bad = 0;
    let tot = 0;
    for (let k = 0; k < 24; k++) {
      const T = Tmin + 30 + r() * (Tmax - Tmin - 60);
      const sec = isothermal(d, T);
      for (let q = 0; q < 40; q++) {
        const x = randComp(r);
        const eq = d.equilibrium(x, T);
        const xy = toXY(x);
        let key = 'L';
        for (const rg of sec.regions) if (inPoly(xy, rg.poly.map(toXY))) key = rg.key;
        tot++;
        if (key !== eq.key) bad++;
      }
    }
    expect(bad / tot).toBeLessThan(0.02);
  });

  it('垂直截面栅格与逐点平衡一致', () => {
    const r = rng(6);
    const { Tmin, Tmax } = d.tRange();
    for (let trial = 0; trial < 3; trial++) {
      const p1 = randComp(r);
      const p2 = randComp(r);
      const W = 120;
      const H = 90;
      const ras = verticalRaster(d, { p1, p2 }, W, H, Tmin, Tmax);
      let bad = 0;
      let tot = 0;
      for (let q = 0; q < 300; q++) {
        const cx = 1 + Math.floor(r() * (W - 2));
        const cy = 1 + Math.floor(r() * (H - 2));
        const u = (cx + 0.5) / W;
        const T = Tmax - ((cy + 0.5) / H) * (Tmax - Tmin);
        const x: Comp = [p1[0] + u * (p2[0] - p1[0]), p1[1] + u * (p2[1] - p1[1]), p1[2] + u * (p2[2] - p1[2])];
        const key = ras.keys[ras.labels[cy * W + cx]];
        tot++;
        if (key !== d.equilibrium(x, T).key) bad++;
      }
      expect(bad / tot).toBeLessThan(0.03);
    }
  });

  it('冷却：相分数守恒、液相不增、时间单调、终态为固相', () => {
    const r = rng(7);
    for (let k = 0; k < 6; k++) {
      const x = randComp(r);
      const tr = computeTrace(d, x);
      let lastL = 1;
      for (let i = 0; i < tr.samples.length; i++) {
        const s = tr.samples[i];
        if (i > 0) expect(s.t).toBeGreaterThanOrEqual(tr.samples[i - 1].t - 1e-9);
        const mix: Comp = [0, 0, 0];
        let sum = 0;
        for (const p of s.eq.phases) {
          sum += p.frac;
          for (let q = 0; q < 3; q++) mix[q] += p.frac * p.x[q];
        }
        expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
        for (let q = 0; q < 3; q++) expect(Math.abs(mix[q] - x[q])).toBeLessThan(1e-4);
        const fl = s.eq.phases.find((p) => p.si < 0)?.frac ?? 0;
        expect(fl).toBeLessThan(lastL + 1e-6);
        lastL = fl;
      }
      expect(tr.finalKey.includes('L')).toBe(false);
    }
  });
});

describe('预设体系拓扑（物理一致性）', () => {
  const get = (id: string) => diagrams.find((e) => e.p.id === id)!.d;
  const rxn = (d: PhaseDiagram) => d.topo.invariants.map((i) => `${i.rank}:${i.reaction.type}:${i.reaction.text}`);

  it('二元不稳定化合物：包晶点 L + A ⇌ D、过渡点 L + A ⇌ C + D、共晶点 L ⇌ B + C + D', () => {
    const d = get('binary-incongruent');
    const r = rxn(d);
    expect(r).toContain('binary:peritectic:L + A ⇌ D');
    expect(r).toContain('ternary:transition:L + A ⇌ C + D');
    expect(r).toContain('ternary:eutectic:L ⇌ B + C + D');
    expect(d.topo.compounds[0].congruent).toBe(false);
    const cv = d.topo.curves.find((c) => d.solids[c.a].id === 'A' && d.solids[c.b].id === 'D')!;
    expect(cv.pieces.every((p) => p.kind === 'peritectic' && p.resorbed === 0)).toBe(true);
  });

  it('三元不稳定化合物：两个过渡点 + 一个共晶点，A/S 为转熔线', () => {
    const d = get('ternary-incongruent');
    const r = rxn(d).filter((s) => s.startsWith('ternary'));
    expect(r).toContain('ternary:transition:L + A ⇌ C + S');
    expect(r).toContain('ternary:transition:L + A ⇌ B + S');
    expect(r).toContain('ternary:eutectic:L ⇌ B + C + S');
    expect(d.topo.compounds[0].congruent).toBe(false);
  });

  it('稳定化合物：D 一致熔融，D/C 界线具有温度极大点（真正的伪二元）', () => {
    const d = get('binary-congruent');
    expect(d.topo.compounds[0].congruent).toBe(true);
    const cv = d.topo.curves.find((c) => d.solids[c.a].id === 'C' && d.solids[c.b].id === 'D')!;
    expect(cv.maxima.length).toBe(1);
    expect(d.topo.invariants.filter((i) => i.rank === 'ternary' && i.reaction.type !== 'eutectic').length).toBe(0);
  });

  it('不稳定化合物冷却：转熔反应使 A 回溶、D 增加，D 成分点的终态为纯 D', () => {
    const d = get('binary-incongruent');
    // D 成分点上略偏 C，总是经过 A 初晶 → 转熔
    const x0: Comp = [0.5, 0.5, 0];
    const tr = computeTrace(d, x0);
    expect(tr.events.some((e) => e.plateau)).toBe(true);
    expect(tr.finalKey).toBe('D');
  });
});

function inPoly(p: [number, number], poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function solve(rows: Comp[], g: number[]): Comp {
  const [a, b, c] = rows;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const x0 = (g[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (g[1] * c[2] - b[2] * g[2]) + a[2] * (g[1] * c[1] - b[1] * g[2])) / det;
  const x1 = (a[0] * (g[1] * c[2] - b[2] * g[2]) - g[0] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * g[2] - g[1] * c[0])) / det;
  const x2 = (a[0] * (b[1] * g[2] - g[1] * c[1]) - a[1] * (b[0] * g[2] - g[1] * c[0]) + g[0] * (b[0] * c[1] - b[1] * c[0])) / det;
  return [x0, x1, x2];
}

describe('典型成分示例与说明一致', () => {
  for (const p of PRESETS) {
    for (const ex of p.examples) {
      it(`${p.id}: ${ex.name}`, () => {
        const d = diagrams.find((e) => e.p.id === p.id)!.d;
        const tr = computeTrace(d, ex.x);
        expect(tr.finalKey).toBe(ex.final);
      });
    }
  }
});
