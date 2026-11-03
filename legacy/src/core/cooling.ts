import { vertex } from './barycentric';
import { pairId, type TernaryEutecticDiagram } from './diagram';
import type { Comp, CompIndex, RegionKey } from './types';

/**
 * 平衡冷却过程（无过冷、完全平衡、固相无扩散限制——理想杠杆规则）。
 *
 * 时间轴采用最简集总热平衡（恒定散热速率 q）：
 *   q·dt = C_p·|dT| + Σ_s ΔH_s·df_s
 * 由此得到的示意冷却曲线在液相线、单变线处出现斜率转折，在不变反应温度出现平台。
 * 该时间轴仅用于教学演示，不代表任何真实工艺的动力学。
 */

export type CoolingStage = 'liquid' | 'primary' | 'binary' | 'invariant' | 'solid';

export interface CoolingSample {
  t: number;
  T: number;
  fL: number;
  fs: [number, number, number];
  liquid: Comp | null;
  region: RegionKey;
  stage: CoolingStage;
  /** 不变反应进度 0–1（仅平台段） */
  xi?: number;
}

export type CoolingEventKind = 'liquidus' | 'monovariant' | 'invariantStart' | 'end';

export interface CoolingEvent {
  kind: CoolingEventKind;
  t: number;
  T: number;
  title: string;
  detail: string;
}

export interface Constituent {
  name: string;
  fraction: number;
  phases: CompIndex[];
}

export interface CoolingResult {
  x0: Comp;
  samples: CoolingSample[];
  events: CoolingEvent[];
  tTotal: number;
  plateau: { T: number; t0: number; t1: number; fL0: number; liquid: Comp; kind: 'ternary' | 'binary' | 'pure' };
  constituents: Constituent[];
  /** 液相成分轨迹（结晶路径），含温度 */
  path: { comp: Comp; T: number }[];
  primary: CompIndex;
}

const CP = 30; // J/(mol·K)
const Q = 1; // 任意单位，时间最终归一化

export function simulateCooling(d: TernaryEutecticDiagram, x0: Comp, opts?: { dT?: number }): CoolingResult {
  const dT = opts?.dT ?? 1;
  const sym = d.params.components.map((c) => c.symbol);
  const comps = d.params.components;
  const nonzero = ([0, 1, 2] as CompIndex[]).filter((i) => x0[i] > 1e-7);
  const L0 = d.liquidus(x0);
  const TL = L0.T;
  const primary = L0.primary;

  let kind: 'ternary' | 'binary' | 'pure';
  let Tp: number;
  let yP: Comp;
  let partner: CompIndex | null = null;
  let T2: number | null = null;
  if (nonzero.length === 1) {
    kind = 'pure';
    Tp = comps[primary].Tm;
    yP = vertex(primary);
  } else if (nonzero.length === 2) {
    kind = 'binary';
    const [i, j] = nonzero;
    const b = d.binary[pairId(i, j)];
    Tp = b.T;
    yP = b.comp;
    partner = primary === i ? j : i;
  } else {
    kind = 'ternary';
    Tp = d.eutectic.T;
    yP = d.eutectic.comp;
    const pe = d.primaryPathEnd(x0);
    T2 = pe.T;
    partner = pe.partner;
  }

  const Tstart = Math.min(d.tRange[1], TL + 80);
  const Tend = Math.max(d.tRange[0], Tp - 100);

  // 温度网格：等步长 + 精确插入事件温度
  const grid = new Set<number>();
  for (let T = Tstart; T > Tend; T -= dT) grid.add(T);
  grid.add(Tend);
  grid.add(Tp);
  if (kind !== 'pure') grid.add(TL);
  if (T2 !== null) grid.add(T2);
  const temps = [...grid].sort((a, b) => b - a);

  const samples: CoolingSample[] = [];
  let t = 0;
  let prev: CoolingSample | null = null;
  const pushSample = (s: Omit<CoolingSample, 't'>) => {
    if (prev) {
      let dtv = (CP * Math.abs(prev.T - s.T)) / Q;
      for (let k = 0; k < 3; k++) dtv += (comps[k].dH * Math.max(0, s.fs[k] - prev.fs[k])) / Q;
      t += dtv;
    }
    const full: CoolingSample = { ...s, t };
    samples.push(full);
    prev = full;
  };

  const stateAt = (T: number): Omit<CoolingSample, 't'> => {
    if (kind === 'pure') {
      const liquid = T >= Tp;
      const fs: [number, number, number] = [0, 0, 0];
      if (!liquid) fs[primary] = 1;
      return {
        T,
        fL: liquid ? 1 : 0,
        fs,
        liquid: liquid ? vertex(primary) : null,
        region: liquid ? 'L' : `L+${primary}`,
        stage: liquid ? 'liquid' : 'solid',
      };
    }
    const eq = d.equilibrium(x0, T);
    const fs: [number, number, number] = [0, 0, 0];
    let fL = 0;
    for (const p of eq.phases) {
      if (p.phase === 'L') fL = p.fraction;
      else fs[p.phase] = p.fraction;
    }
    let stage: CoolingStage;
    if (eq.region === 'L') stage = 'liquid';
    else if (eq.region === 'S' || fL < 1e-9) stage = 'solid';
    else if (eq.region.split('+').length === 2) stage = 'primary';
    else stage = 'binary';
    return { T, fL, fs, liquid: fL > 1e-9 ? eq.liquid : null, region: eq.region, stage };
  };

  let plateau = { T: Tp, t0: 0, t1: 0, fL0: 0, liquid: yP, kind };
  for (const T of temps) {
    if (T > Tp) {
      pushSample(stateAt(T));
      continue;
    }
    if (T === Tp) {
      // 平台起点（反应前状态 = T_p⁺ 极限）
      const pre = kind === 'pure' ? stateAt(Tp + 1e-9) : stateAt(Tp);
      if (kind === 'binary' && pre.fL < 1e-9) {
        // 恰在 T_p 时 classify 落入退化三角形，取上方极限
        Object.assign(pre, stateAt(Tp + 1e-7));
        pre.T = Tp;
      }
      pre.T = Tp;
      pushSample(pre);
      const fL0 = pre.fL;
      plateau = { T: Tp, t0: t, t1: t, fL0, liquid: yP, kind };
      const N = 40;
      for (let n = 1; n <= N; n++) {
        const xi = n / N;
        const fs: [number, number, number] = [
          pre.fs[0] + fL0 * xi * yP[0],
          pre.fs[1] + fL0 * xi * yP[1],
          pre.fs[2] + fL0 * xi * yP[2],
        ];
        pushSample({
          T: Tp,
          fL: fL0 * (1 - xi),
          fs,
          liquid: n < N ? yP : null,
          region: pre.region,
          stage: 'invariant',
          xi,
        });
      }
      plateau.t1 = t;
      continue;
    }
    const s = stateAt(T);
    s.stage = 'solid';
    s.fL = 0;
    s.liquid = null;
    pushSample(s);
  }

  // 归一化时间
  const tTotal = t;
  for (const s of samples) s.t /= tTotal;
  plateau.t0 /= tTotal;
  plateau.t1 /= tTotal;

  const tAt = (T: number) => samples.find((s) => s.T <= T + 1e-9)?.t ?? 0;
  const cT = (T: number) => `${(T - 273.15).toFixed(1)} °C`;

  // ---- 事件 ----
  const events: CoolingEvent[] = [];
  const P = sym[primary];
  if (kind === 'pure') {
    events.push({
      kind: 'invariantStart',
      t: plateau.t0,
      T: Tp,
      title: `纯组元 ${P} 在熔点恒温凝固`,
      detail: `单元系两相平衡 L ⇌ ${P}，F = 1 − 2 + 1 = 0，温度保持 ${cT(Tp)} 直至液相耗尽。`,
    });
  } else {
    events.push({
      kind: 'liquidus',
      t: tAt(TL),
      T: TL,
      title: `到达液相面：开始析出初晶 ${P}`,
      detail: `成分点触及 ${P} 初晶面，L → ${P}。液相成分沿 ${P} 顶点与成分点连线的延长线移动（背离 ${P} 顶点），F = 2。`,
    });
  }
  if (kind === 'ternary' && T2 !== null && partner !== null && T2 - Tp > 0.5) {
    const Q2 = sym[partner];
    const pr = [primary, partner].sort();
    events.push({
      kind: 'monovariant',
      t: tAt(T2),
      T: T2,
      title: `液相到达单变线 E_${sym[pr[0]]}${sym[pr[1]]}–E：二元共晶反应`,
      detail: `L → ${P} + ${Q2} 同时析出，液相成分沿单变线向三元共晶点 E 移动；三相平衡 F = 1，温度与液相成分一一对应。`,
    });
  }
  if (kind === 'ternary') {
    events.push({
      kind: 'invariantStart',
      t: plateau.t0,
      T: Tp,
      title: '到达三元共晶温度：四相不变反应',
      detail: `L(E) → ${sym[0]} + ${sym[1]} + ${sym[2]}，F = 3 − 4 + 1 = 0，温度保持 ${cT(Tp)} 不变，剩余液相 ${(plateau.fL0 * 100).toFixed(1)}% 全部转变为三元共晶组织。`,
    });
  } else if (kind === 'binary' && partner !== null) {
    events.push({
      kind: 'invariantStart',
      t: plateau.t0,
      T: Tp,
      title: '到达二元共晶温度：恒温共晶反应',
      detail: `成分位于二元边上，L → ${P} + ${sym[partner]}，二元系 F = 2 − 3 + 1 = 0，温度保持 ${cT(Tp)}。`,
    });
  }
  events.push({
    kind: 'end',
    t: plateau.t1,
    T: Tp,
    title: '凝固结束',
    detail: '液相消失，继续冷却仅为固相降温（本模型固相互不溶，无固态相变）。',
  });

  // ---- 组织组成物 ----
  const constituents: Constituent[] = [];

  if (kind === 'pure') {
    constituents.push({ name: `${P}`, fraction: 1, phases: [primary] });
  } else if (kind === 'binary' && partner !== null) {
    const sPre = samples.find((s) => s.T === Tp && s.stage !== 'invariant');
    constituents.push({ name: `初晶 ${P}`, fraction: sPre ? sPre.fs[primary] : 0, phases: [primary] });
    constituents.push({ name: `二元共晶 (${P}+${sym[partner]})`, fraction: plateau.fL0, phases: [primary, partner].sort() as CompIndex[] });
  } else if (partner !== null && T2 !== null) {
    const at2 = samples.find((s) => s.T === T2);
    const sPre = samples.find((s) => s.T === Tp && s.stage !== 'invariant');
    const fPrim = at2 ? at2.fs[primary] : 0;
    const fBin = sPre ? sPre.fs[primary] + sPre.fs[partner] - fPrim : 0;
    constituents.push({ name: `初晶 ${P}`, fraction: fPrim, phases: [primary] });
    const pr = [primary, partner].sort() as CompIndex[];
    if (fBin > 1e-6) constituents.push({ name: `二元共晶 (${sym[pr[0]]}+${sym[pr[1]]})`, fraction: fBin, phases: pr });
    constituents.push({ name: `三元共晶 (${sym[0]}+${sym[1]}+${sym[2]})`, fraction: plateau.fL0, phases: [0, 1, 2] });
  }

  const path = samples
    .filter((s) => s.liquid && s.T <= TL + 1e-9 && s.stage !== 'invariant')
    .map((s) => ({ comp: s.liquid!, T: s.T }));
  if (kind !== 'pure') path.push({ comp: yP, T: Tp });

  return { x0, samples, events, tTotal, plateau, constituents, path, primary };
}

function lowerIndex(samples: CoolingSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return 0;
  if (t >= samples[hi].t) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 时间 t (0–1) 处的插值状态 */
export function sampleAt(r: CoolingResult, t: number): CoolingSample {
  const s = r.samples;
  const n = lowerIndex(s, t);
  const a = s[n];
  const b = s[Math.min(n + 1, s.length - 1)];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const mix = (p: number, q: number) => p + (q - p) * u;
  let liquid: Comp | null = null;
  if (a.liquid && b.liquid) liquid = [mix(a.liquid[0], b.liquid[0]), mix(a.liquid[1], b.liquid[1]), mix(a.liquid[2], b.liquid[2])];
  else liquid = u < 0.5 ? a.liquid : b.liquid;
  const base = u < 0.5 ? a : b;
  return {
    t,
    T: mix(a.T, b.T),
    fL: mix(a.fL, b.fL),
    fs: [mix(a.fs[0], b.fs[0]), mix(a.fs[1], b.fs[1]), mix(a.fs[2], b.fs[2])],
    liquid,
    region: base.region,
    stage: base.stage,
    xi: a.xi !== undefined || b.xi !== undefined ? mix(a.xi ?? 0, b.xi ?? 1) : undefined,
  };
}

/** 给定温度对应的时间（平台温度返回平台起点） */
export function timeAtT(r: CoolingResult, T: number): number {
  const s = r.samples;
  if (T >= s[0].T) return 0;
  for (let n = 1; n < s.length; n++) {
    if (s[n].T <= T) {
      const a = s[n - 1];
      const b = s[n];
      if (a.T === b.T) return a.t;
      const u = (a.T - T) / (a.T - b.T);
      return a.t + (b.t - a.t) * u;
    }
  }
  return 1;
}
