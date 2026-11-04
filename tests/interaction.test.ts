import { describe, expect, it } from 'vitest';
import { PhaseDiagram } from '../src/core/diagram';
import { getPreset, PRESETS } from '../src/core/presets';
import { R } from '../src/core/thermo';
import type { Comp } from '../src/core/types';
import { minimizeGibbs } from '../src/math/gibbsMin';
import { analyzePoint, hessian } from '../src/math/pointAnalysis';
import { useStore } from '../src/state/store';

describe('边 / 顶点成分的吉布斯能最小化（回归：曾导致页面白屏）', () => {
  it('所有体系：边与顶点上 LP 结果与构造式求解器一致，且不抛异常', () => {
    for (const p of PRESETS) {
      const d = new PhaseDiagram(p.params);
      const { Tmin, Tmax } = d.tRange();
      for (let k = 0; k <= 10; k++)
        for (const e of [0, 1, 2])
          for (const T of [Tmin + 60, (Tmin + Tmax) / 2, Tmax - 80]) {
            const x: Comp = [0, 0, 0];
            x[(e + 1) % 3] = k / 10;
            x[(e + 2) % 3] = 1 - k / 10;
            const g = minimizeGibbs(d.th, x, T);
            expect(Math.abs(g.G - d.equilibrium(x, T).G)).toBeLessThan(1e-3);
            expect(g.massResidual).toBeLessThan(1e-9);
          }
    }
  });
  it('报告的状态 (0.6032, 0, 0.3968), 1086.48 K', () => {
    const d = new PhaseDiagram(getPreset('binary-incongruent').params);
    const x: Comp = [0.6032, 0, 0.3968];
    const g = minimizeGibbs(d.th, x, 1086.48);
    expect(g.mu[1]).toBe(-Infinity);
    expect(Math.abs(g.G - d.equilibrium(x, 1086.48).G)).toBeLessThan(1e-6);
  });
});

describe('点分析', () => {
  const d = new PhaseDiagram(getPreset('binary-incongruent').params);
  it('三相区：∂f/∂x₀ = A⁻¹ 的前两列（与有限差分一致）', () => {
    const T = Math.min(...d.topo.invariants.map((v) => v.T)) - 40;
    // 在固相三角形内部取点：三固相区，三个相成分恒定
    const x: Comp = [0.4, 0.35, 0.25];
    const eq = d.equilibrium(x, T);
    expect(eq.phases.length).toBe(3);
    const a = analyzePoint(d, x, T, eq);
    expect(a.sens.valid).toBe(true);
    const h = 1e-4;
    const x2: Comp = [x[0] + h, x[1] - h, x[2]];
    const e2 = d.equilibrium(x2, T);
    for (let k = 0; k < 3; k++) {
      const pred = a.sens.M[k][0] * h + a.sens.M[k][1] * -h;
      expect(Math.abs(e2.phases[k].frac - eq.phases[k].frac - pred)).toBeLessThan(1e-8);
    }
  });
  it('均匀液相：液相线以上稳定；以下为亚稳（Hessian 正定，存在析出驱动力）', () => {
    const x: Comp = [0.4, 0.3, 0.3];
    const Tl = d.liquidus(x).T;
    const above = analyzePoint(d, x, Tl + 20, d.equilibrium(x, Tl + 20));
    expect(above.stability.homogeneous[0].cls).toBe('stable');
    const below = analyzePoint(d, x, Tl - 30, d.equilibrium(x, Tl - 30));
    const L = below.stability.homogeneous[0];
    expect(L.cls).toBe('metastable');
    expect(L.eig[1]).toBeGreaterThan(0);
    expect(L.maxDF!.df).toBeGreaterThan(0);
    expect(L.excess).toBeGreaterThan(0);
    expect(below.stability.certificate).toBeGreaterThan(-1e-3);
  });
  it('理想液相 Hessian = RT[[1/x_A + 1/x_B, 1/x_A], [1/x_A, 1/x_A + 1/x_C]]', () => {
    const x: Comp = [0.5, 0.3, 0.2];
    const T = 1200;
    const H = hessian(d, -1, x, T);
    const RT = R * T;
    const ref = [
      [RT * (1 / x[0] + 1 / x[1]), RT / x[0]],
      [RT / x[0], RT * (1 / x[0] + 1 / x[2])],
    ];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) expect(Math.abs(H[i][j] - ref[i][j]) / ref[i][j]).toBeLessThan(1e-4);
  });
  it('大的正 Ω 使均匀液相失稳（Hessian 出现负特征值 = 旋节区）', () => {
    const p = structuredClone(getPreset('simple-eutectic').params);
    p.omega = { AB: 40000, AC: 40000, BC: 40000 };
    const d2 = new PhaseDiagram(p, 60);
    const x: Comp = [1 / 3, 1 / 3, 1 / 3];
    const T = 1600;
    const a = analyzePoint(d2, x, T, d2.equilibrium(x, T));
    expect(a.stability.homogeneous[0].cls).toBe('unstable');
  });
  it('三相界线处的即时反应与拓扑模块的界线类型一致', () => {
    let checked = 0;
    let peri = 0;
    for (const cv of d.topo.curves) {
      const pc = cv.pieces.find((q) => Math.abs(q.i1 - q.i0) > 12);
      if (!pc) continue;
      const k = Math.floor((pc.i0 + pc.i1) / 2);
      const T = cv.T[k] - 1e-3;
      // 取连结三角形内靠近液相点的总成分
      const xl = cv.pts[k];
      const sa = d.solids[cv.a].n;
      const sb = d.solids[cv.b].n;
      const x0: Comp = [0, 1, 2].map((i) => 0.8 * xl[i] + 0.1 * sa[i] + 0.1 * sb[i]) as Comp;
      const eq = d.equilibrium(x0, T);
      if (eq.phases.length !== 3 || !eq.phases.some((p) => p.si < 0)) continue;
      const a = analyzePoint(d, x0, T, eq);
      expect(a.reaction.type).toBe(pc.kind === 'peritectic' ? 'peritectic' : 'eutectic');
      checked++;
      if (pc.kind === 'peritectic') peri++;
    }
    expect(checked).toBeGreaterThan(2);
    expect(peri).toBeGreaterThan(0);
  });
});

describe('交互模式', () => {
  it('冷却凝固模式下总成分不可改变；程序性设定（force）可以；播放自动进入冷却模式', () => {
    const s = useStore.getState();
    s.setMode('composition');
    s.setX0([0.5, 0.25, 0.25]);
    const x = useStore.getState().x0;
    useStore.getState().setMode('cooling');
    useStore.getState().setX0([0.2, 0.2, 0.6]);
    expect(useStore.getState().x0).toEqual(x);
    expect(useStore.getState().notice).not.toBeNull();
    // 降温只改变 T，不改变 x₀
    const T0 = useStore.getState().T;
    useStore.getState().setT(T0 - 50);
    expect(useStore.getState().x0).toEqual(x);
    useStore.getState().setX0([0.2, 0.2, 0.6], false, true);
    expect(useStore.getState().x0[2]).toBeCloseTo(0.6, 12);
    useStore.getState().setMode('composition');
    useStore.getState().setPlaying(true);
    expect(useStore.getState().mode).toBe('cooling');
    useStore.getState().setPlaying(false);
  });
});

describe('冷却模式下的垂直截面', () => {
  it('切到冷却模式时截面自动过状态点，且后续单击只改变温度', async () => {
    const { currentSpec } = await import('../src/state/store');
    const { distToSection } = await import('../src/core/sections');
    const st = useStore.getState();
    st.setMode('composition');
    st.loadPreset('binary-incongruent');
    useStore.getState().setX0([0.6, 0.25, 0.15], false);
    let s = useStore.getState();
    expect(s.section.mode).toBe('join');
    expect(distToSection(currentSpec(s), s.x0)).toBeGreaterThan(0.01); // D–C 连线不过该点
    s.setMode('cooling');
    s = useStore.getState();
    expect(s.section.mode).toBe('point');
    expect(distToSection(currentSpec(s), s.x0)).toBeLessThan(1e-9);
    // 冷却模式拒绝改 x₀，但 setT 正常
    const x0 = [...s.x0];
    s.setX0([0.3, 0.3, 0.4]);
    expect(useStore.getState().x0).toEqual(x0);
    s.setMode('composition');
  });
});
