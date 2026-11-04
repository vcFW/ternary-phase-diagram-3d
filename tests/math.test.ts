import { describe, expect, it } from 'vitest';
import { fromXY, toXY, triBary } from '../src/core/barycentric';
import { PhaseDiagram } from '../src/core/diagram';
import { PRESETS, getPreset } from '../src/core/presets';
import type { Comp } from '../src/core/types';
import { binaryEquilibrium, edgeCurves } from '../src/math/binary';
import { alkemadeCheck, analyzeCurveAt, gibbsDuhemOfEq, tangentIntersect } from '../src/math/curves';
import { minimizeGibbs } from '../src/math/gibbsMin';
import { phaseFractions } from '../src/math/lever';
import { cond, det, gaussSteps, inverse, lstsq, matMul, nullSpace, rank, solve, svd, transpose } from '../src/math/linalg';
import { analyzeReaction, reactionThermo } from '../src/math/reaction';
import { scheil } from '../src/math/scheil';
import { cartToComp, compToCart, H_MAT, P_MAT } from '../src/math/spaces';
import { runValidation } from '../src/math/validation';
import { useStore } from '../src/state/store';
import { decodeState, encodeState } from '../src/state/urlState';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function randComp(r: () => number): Comp {
  const a = -Math.log(r() + 1e-9);
  const b = -Math.log(r() + 1e-9);
  const c = -Math.log(r() + 1e-9);
  const s = a + b + c;
  return [a / s, b / s, c / s];
}

describe('线性代数内核', () => {
  it('SVD 重构 A = U Σ Vᵀ，V 正交', () => {
    const r = rng(11);
    for (let k = 0; k < 50; k++) {
      const m = 2 + Math.floor(r() * 3);
      const n = 2 + Math.floor(r() * 3);
      const A = Array.from({ length: m }, () => Array.from({ length: n }, () => r() * 2 - 1));
      const { U, S, V } = svd(A);
      const US = U.map((row) => row.map((v, j) => v * S[j]));
      const B = matMul(US, transpose(V));
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) expect(Math.abs(B[i][j] - A[i][j])).toBeLessThan(1e-12);
      const VtV = matMul(transpose(V), V);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(Math.abs(VtV[i][j] - (i === j ? 1 : 0))).toBeLessThan(1e-12);
    }
  });
  it('秩、零空间、行列式、求解、逆、最小二乘', () => {
    expect(rank([[1, 2, 3], [2, 4, 6], [1, 0, 1]])).toBe(2);
    const ns = nullSpace([[1, 2, 3], [2, 4, 6], [1, 0, 1]]);
    expect(ns.length).toBe(1);
    const v = ns[0];
    expect(Math.abs(v[0] + 2 * v[1] + 3 * v[2])).toBeLessThan(1e-12);
    expect(det([[2, 1, 0], [1, 3, 1], [0, 1, 4]])).toBeCloseTo(18, 12);
    const x = solve([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [1, 2, 3])!;
    expect(2 * x[0] + x[1]).toBeCloseTo(1, 12);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
    const Ai = inverse([[4, 7], [2, 6]])!;
    expect(Ai[0][0]).toBeCloseTo(0.6, 12);
    expect(cond([[1, 0], [0, 1e-6]])).toBeCloseTo(1e6, 3);
    expect(cond([[1, 2], [2, 4]])).toBe(Infinity);
    const ls = lstsq([[1, 0], [0, 1], [1, 1]], [1, 1, 3]);
    expect(ls.residual).toBeGreaterThan(0.5);
    const g = gaussSteps([[2, 1, 3], [1, 3, 5]]);
    expect(g.x![0]).toBeCloseTo(0.8, 12);
    expect(g.x![1]).toBeCloseTo(1.4, 12);
  });
});

describe('坐标变换', () => {
  it('H 映射与 core.toXY 一致，且往返精确', () => {
    const r = rng(5);
    expect(det(H_MAT)).toBeCloseTo(Math.sqrt(3) / 2, 14);
    for (let k = 0; k < 300; k++) {
      const x = randComp(r);
      const a = compToCart(x);
      const b = toXY(x);
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThan(1e-14);
      const y = cartToComp(a[0], a[1]);
      const z = fromXY(a[0], a[1]);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(y[i] - x[i])).toBeLessThan(1e-12);
        expect(Math.abs(z[i] - x[i])).toBeLessThan(1e-12);
      }
    }
  });
  it('投影 P：rank 2，零空间 = e_T', () => {
    expect(rank(P_MAT)).toBe(2);
    const n = nullSpace(P_MAT);
    expect(n.length).toBe(1);
    expect(Math.abs(Math.abs(n[0][2]) - 1)).toBeLessThan(1e-14);
  });
});

const diagrams = PRESETS.map((p) => ({ p, d: new PhaseDiagram(p.params) }));

describe.each(diagrams)('数学层 · $p.id', ({ d }) => {
  it('相分数线性系统与构造式平衡一致；非负；守恒', () => {
    const r = rng(21);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 0; k < 200; k++) {
      const x = randComp(r);
      const T = Tmin + r() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      if (eq.phases.length < 2 || eq.phases.length > 3) continue;
      const lf = phaseFractions(eq.phases.map((p) => p.x), x);
      if (lf.status === 'ill' || lf.status === 'singular') continue;
      expect(lf.residual).toBeLessThan(1e-7);
      lf.f!.forEach((v, i) => {
        expect(v).toBeGreaterThan(-1e-7);
        expect(Math.abs(v - eq.phases[i].frac)).toBeLessThan(1e-6);
      });
    }
  });

  it('相律一致性：Gibbs–Duhem 矩阵的零空间维数 = 4 − P', () => {
    const r = rng(22);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 0; k < 200; k++) {
      const x = randComp(r);
      const T = Tmin + r() * (Tmax - Tmin);
      const eq = d.equilibrium(x, T);
      const gd = gibbsDuhemOfEq(d.th, eq.phases, T);
      expect(gd.F).toBe(3 - eq.phases.length + 1);
    }
  });

  it('不变点反应：ker N 一维，守恒残差为 0，分类与拓扑模块一致，ΔG_r(T_inv) = 0', () => {
    for (const iv of d.topo.invariants.filter((v) => v.rank === 'ternary')) {
      const phases = [{ label: 'L', x: iv.x, si: -1 }, ...iv.solids.map((si, k) => ({ label: d.solids[si].label, x: iv.solidX[k], si }))];
      const rx = analyzeReaction(phases);
      expect(rx.nullDim).toBe(1);
      expect(rx.residual).toBeLessThan(1e-12);
      expect(rx.cls).toBe(iv.reaction.type);
      // 与 core 中 reactionAt 的系数一致
      iv.reaction.terms.filter((t) => t.si >= 0).forEach((t) => {
        const k = phases.findIndex((p) => p.si === t.si);
        expect(Math.abs(rx.nu![k] - t.coef)).toBeLessThan(1e-8);
      });
      const th = reactionThermo(d.th, phases, rx.nu!);
      expect(Math.abs(th.dG(iv.T))).toBeLessThan(1e-3);
      // 降温方向：消耗液相
      expect(th.dG(iv.T - 5)).toBeLessThan(0);
    }
  });

  it('吉布斯能最小化（LP 对偶）与构造式求解器一致；化学势相等', () => {
    const r = rng(23);
    const { Tmin, Tmax } = d.tRange();
    for (let k = 0; k < 40; k++) {
      const x = randComp(r);
      const T = Tmin + 80 + r() * (Tmax - Tmin - 80);
      const g = minimizeGibbs(d.th, x, T);
      const e = d.equilibrium(x, T);
      expect(g.converged).toBe(true);
      expect(Math.abs(g.G - e.G)).toBeLessThan(5e-3);
      expect(g.massResidual).toBeLessThan(1e-9);
      expect(g.minReducedCost).toBeGreaterThan(-1e-6);
      const L = g.phases.find((p) => p.si < 0);
      if (L && g.phases.length > 1) {
        const mu = d.th.muLiq(L.x, T);
        for (let i = 0; i < 3; i++) expect(Math.abs(mu[i] - g.mu[i])).toBeLessThan(1);
      }
      // 固相在切面上（互补松弛）
      for (const p of g.phases.filter((q) => q.si >= 0)) expect(Math.abs(g.solidReduced[p.si].r)).toBeLessThan(1e-6);
    }
  });

  it('二元边公切线：液相切点与三元求解器在该边上的液相一致', () => {
    const r = rng(24);
    for (let k = 0; k < 12; k++) {
      const T = d.tRange().Tmin + 150 + r() * 500;
      const be = binaryEquilibrium(edgeCurves(d.th, 0, 1, T), T);
      for (const t of be.tangents) {
        if (t.left === 'L' || t.right === 'L') {
          const xL = t.left === 'L' ? t.xa : t.xb;
          const xS = t.left === 'L' ? t.xb : t.xa;
          const x0 = 0.5 * (xL + xS);
          const eq = d.equilibrium([1 - x0, x0, 0], T);
          const L = eq.phases.find((p) => p.si < 0);
          if (!L) continue;
          expect(Math.abs(L.x[1] - xL)).toBeLessThan(2e-6);
        }
      }
    }
  });

  it('切线规则与拓扑模块的界线类型一致（远离分段端点）', () => {
    for (const cv of d.topo.curves) {
      for (const pc of cv.pieces) {
        const lo = Math.min(pc.i0, pc.i1);
        const hi = Math.max(pc.i0, pc.i1);
        if (hi - lo < 10) continue;
        const k = Math.floor((lo + hi) / 2);
        let s = 0;
        for (let i = 1; i <= k; i++) s += Math.hypot(toXY(cv.pts[i])[0] - toXY(cv.pts[i - 1])[0], toXY(cv.pts[i])[1] - toXY(cv.pts[i - 1])[1]);
        const an = analyzeCurveAt(d, cv, s);
        if (an.ti.kind === 'parallel') continue;
        expect(an.ti.kind === 'eutectic' ? 'eutectic' : 'peritectic').toBe(pc.kind);
      }
    }
  });

  it('Scheil：液相分数单调不增，质量守恒，终态全固', () => {
    const r = rng(25);
    for (let k = 0; k < 4; k++) {
      const x = randComp(r);
      const st = scheil(d, x, { dT: 2 });
      let last = 1;
      for (const s of st) {
        expect(s.fL).toBeLessThanOrEqual(last + 1e-12);
        last = s.fL;
      }
      const fin = st[st.length - 1];
      const mix = [0, 0, 0];
      for (const [id, f] of Object.entries(fin.solids)) {
        const y = fin.solidsX[id];
        for (let i = 0; i < 3; i++) mix[i] += f * y[i];
      }
      for (let i = 0; i < 3; i++) mix[i] += fin.fL * fin.xL[i];
      for (let i = 0; i < 3; i++) expect(Math.abs(mix[i] - x[i])).toBeLessThan(1e-6);
    }
  });
});

describe('Alkemade 定理（数值）', () => {
  it('界线与连线交点 = 温度极大点；交点处 dT = 0', () => {
    for (const id of ['binary-congruent', 'ternary-incongruent']) {
      const d = new PhaseDiagram(getPreset(id).params);
      const hits = d.topo.curves.map((c) => alkemadeCheck(d, c)).filter((a) => a.sCross !== null && a.sMax !== null);
      expect(hits.length).toBeGreaterThan(0);
      for (const a of hits) {
        expect(Math.abs(a.sCross! - a.sMax!)).toBeLessThan(4e-3);
        expect(Math.abs(a.dTatCross!)).toBeLessThan(1e-9);
      }
    }
  });
  it('切线求交解析算例', () => {
    const ti = tangentIntersect([0.3, 0.2], [0.6, 0.8], [1, 0, 0], [0, 1, 0]);
    expect(ti.tau).toBeCloseTo(-0.25, 12);
    expect(ti.lambda).toBeCloseTo(0.15, 12);
    expect(triBary([0.5, 0.5, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1])[0]).toBeCloseTo(0.5, 12);
  });
});

describe('验证算例（与"数学实验与验证"页面同源）', () => {
  const cases = runValidation();
  it('共 11 组', () => expect(cases.length).toBe(11));
  for (const c of cases)
    for (const k of c.checks)
      it(`算例 ${c.id} · ${k.name}`, () => {
        expect(k.pass, `${k.name}: 期望 ${k.expected}，计算 ${k.computed}，误差 ${k.err}`).toBe(true);
      });
});

describe('跨页面物理状态同步', () => {
  it('URL 编码 ⇄ 解码往返', () => {
    const st = { presetId: 'ternary-incongruent', x0: [0.2, 0.5, 0.3] as Comp, T: 1100.25, override: { stab: 2500, omega: -1000, dTm: [10, 0, -20] as [number, number, number] } };
    const q = encodeState(st, new URLSearchParams('foo=1'));
    expect(q.get('foo')).toBe('1');
    const back = decodeState(q);
    expect(back.presetId).toBe(st.presetId);
    back.x0!.forEach((v, i) => expect(v).toBeCloseTo(st.x0[i], 4));
    expect(back.T).toBeCloseTo(st.T, 2);
    expect(back.override).toEqual(st.override);
    expect(decodeState(new URLSearchParams('x=a,b,c&T=-5&p=nope'))).toEqual({});
  });

  it('单一状态源：hydrate 后所有派生量（平衡、冷却轨迹）与该状态一致', () => {
    const s = useStore.getState();
    s.hydrate({ presetId: 'binary-congruent', x0: [0.3, 0.2, 0.5], T: 1050 });
    const t = useStore.getState();
    expect(t.presetId).toBe('binary-congruent');
    expect(t.x0[2]).toBeCloseTo(0.5, 12);
    expect(t.T).toBeCloseTo(1050, 9);
    const eq = t.diagram.equilibrium(t.x0, t.T);
    expect(t.eq.key).toBe(eq.key);
    expect(t.trace.x0).toBe(t.x0);
    // 改变成分（任一页面的拖动都调用 setX0）后，温度保持、平衡同步更新
    t.setX0([0.6, 0.2, 0.2]);
    const u = useStore.getState();
    expect(u.T).toBeCloseTo(1050, 9);
    expect(u.eq.key).toBe(u.diagram.equilibrium(u.x0, u.T).key);
    // 参数覆盖改变后相图实例更新，状态保留
    u.setOverride({ omega: -2000 });
    const v = useStore.getState();
    expect(v.diagram).not.toBe(u.diagram);
    expect(v.x0).toEqual(u.x0);
    expect(v.eq.key).toBe(v.diagram.equilibrium(v.x0, v.T).key);
    // 相机位姿保存
    v.setCamera({ pos: [1, 2, 3], target: [0, 0.4, 0] });
    expect(useStore.getState().camera!.pos).toEqual([1, 2, 3]);
  });
});

describe('固溶体求解器', () => {
  for (const id of ['ss-eutectic', 'ss-isomorphous']) {
    const d = new PhaseDiagram(getPreset(id).params);
    it(`${id}：热启动解 = 冷启动全局解；KKT 残差与化学势相等`, () => {
      const r = rng(31);
      const { Tmin, Tmax } = d.tRange();
      let hint: ReturnType<typeof d.equilibrium> | null = null;
      for (let k = 0; k < 120; k++) {
        const x = randComp(r);
        const T = Tmin + r() * (Tmax - Tmin);
        const warm = d.equilibrium(x, T, hint);
        hint = warm;
        const cold = d.equilibrium(x, T, null);
        expect(warm.key).toBe(cold.key);
        expect(Math.abs(warm.G - cold.G)).toBeLessThan(1e-6);
        // 共存的连续相化学势两两相等
        const mus = warm.phases.map((p) => d.th.muPhase(p.si, p.x, T)).filter((m): m is Comp => !!m);
        for (const m of mus) for (let i = 0; i < 3; i++) expect(Math.abs(m[i] - mus[0][i])).toBeLessThan(1e-4);
      }
    });
  }
});
