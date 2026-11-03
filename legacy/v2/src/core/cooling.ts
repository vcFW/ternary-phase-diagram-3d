import type { PhaseDiagram } from './diagram';
import type { Comp, Equilibrium, PhaseAmount } from './types';

/**
 * 平衡冷却：对固定总成分，沿温度逐点求平衡（路径无关），自动检出相组成变化。
 * · 相组成改变 1 个相：连续事件（液相线、单变线、相消失）；
 * · 改变 ≥ 2 个相：四相不变反应平台，温度不变，反应进度 ξ 由 0 到 1，相分数在反应前后状态间线性变化；
 * · 冷却时间轴由真实焓平衡给出：Q = Cp(T0−T) + H(T0) − H(T)，恒定散热功率 → t ∝ Q，因此平台长度正比于潜热。
 */
export interface TraceSample {
  t: number;
  T: number;
  eq: Equilibrium;
  /** 平台内的反应进度（非平台为 -1） */
  xi: number;
  /** 所属事件（平台）索引，非平台为 -1 */
  plateau: number;
}

export interface TraceEvent {
  kind: 'liquidus' | 'univariant' | 'invariant' | 'vanish' | 'end';
  T: number;
  t: number;
  title: string;
  detail: string;
  /** 事件首个样本下标 */
  index: number;
  plateau: boolean;
  /** 液相成分（若存在） */
  xL: Comp | null;
}

export interface Trace {
  x0: Comp;
  Tliq: number;
  samples: TraceSample[];
  events: TraceEvent[];
  tEnd: number;
  /** 终态相组成 */
  finalKey: string;
  finalPhases: PhaseAmount[];
  /** 液相成分轨迹 */
  liquidPath: { x: Comp; T: number; t: number }[];
  narrative: string[];
}

function sig(eq: Equilibrium): string {
  return eq.key;
}

const cel = (K: number) => `${(K - 273.15).toFixed(0)} °C`;

export function computeTrace(d: PhaseDiagram, x0: Comp, opts?: { dT?: number; Tstart?: number; Tend?: number }): Trace {
  const th = d.th;
  const Cp = d.params.Cp;
  const dT = opts?.dT ?? 1;
  const Tliq = th.liquidus(x0).T;
  const range = d.tRange();
  const T0 = opts?.Tstart ?? Tliq + 40;
  const Tend = opts?.Tend ?? Math.max(range.Tmin, 300);

  const H = (eq: Equilibrium, T: number) => {
    let h = Cp * T;
    for (const p of eq.phases) h += p.frac * (p.si < 0 ? th.Hliq(p.x) : th.Hsol(p.si));
    return h;
  };

  const samples: TraceSample[] = [];
  const events: TraceEvent[] = [];
  const Hstart = H(d.equilibrium(x0, T0), T0);
  const push = (T: number, eq: Equilibrium, xi: number, plateau: number, Qplateau?: number) => {
    const Q = Qplateau ?? Hstart - H(eq, T);
    samples.push({ t: Q, T, eq, xi, plateau });
  };

  const ids = (e: Equilibrium) => new Set(e.phases.map((p) => p.id));
  const symDiff = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    a.forEach((v) => !b.has(v) && n++);
    b.forEach((v) => !a.has(v) && n++);
    return n;
  };
  const lq = (e: Equilibrium) => e.phases.find((p) => p.si < 0)?.x ?? null;

  let T = T0;
  let prev = d.equilibrium(x0, T);
  push(T, prev, -1, -1);
  const bisect = (hi: number, lo: number, sg: string): number => {
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (hi + lo);
      if (sig(d.equilibrium(x0, mid)) === sg) hi = mid;
      else lo = mid;
    }
    return 0.5 * (hi + lo);
  };

  while (T > Tend + 1e-9) {
    const Tn = Math.max(Tend, T - dT);
    const eq = d.equilibrium(x0, Tn);
    if (sig(eq) === sig(prev)) {
      push(Tn, eq, -1, -1);
      prev = eq;
      T = Tn;
      continue;
    }
    // 事件定位
    const Te = bisect(T, Tn, sig(prev));
    const above = d.equilibrium(x0, Te + 1e-5);
    const below = d.equilibrium(x0, Te - 1e-5);
    const nChange = symDiff(ids(above), ids(below));
    const Qe = Hstart - H(above, Te + 1e-5);
    const xL = lq(above) ?? lq(below);
    // 先补充事件温度处的样本（反应前）
    push(Te, above, -1, -1);
    if (nChange >= 2) {
      // 不变反应平台
      const union = new Map<string, PhaseAmount>();
      for (const p of above.phases) union.set(p.id, { ...p });
      for (const p of below.phases) if (!union.has(p.id)) union.set(p.id, { ...p, frac: 0 });
      const fa = new Map(above.phases.map((p) => [p.id, p.frac]));
      const fb = new Map(below.phases.map((p) => [p.id, p.frac]));
      const Hb = H(below, Te - 1e-5);
      const Ha = H(above, Te + 1e-5);
      const nSub = 30;
      const pi = events.length;
      for (let k = 1; k <= nSub; k++) {
        const xi = k / nSub;
        const phases: PhaseAmount[] = [];
        union.forEach((p, id) => {
          const f = (1 - xi) * (fa.get(id) ?? 0) + xi * (fb.get(id) ?? 0);
          if (f > 1e-12) {
            const comp = id === 'L' ? (xL ?? p.x) : p.x;
            phases.push({ ...p, frac: f, x: comp });
          }
        });
        phases.sort((a, b) => a.si - b.si);
        const e2: Equilibrium = { phases, key: phases.map((p) => p.id).join('+'), dof: 0, G: 0 };
        push(Te, e2, xi, pi, Qe + (Ha - Hb) * xi);
      }
      const iv = d.topo.invariants.find((v) => v.rank === 'ternary' && Math.abs(v.T - Te) < 0.05)
        ?? d.topo.invariants.find((v) => Math.abs(v.T - Te) < 0.05);
      const gone = [...ids(above)].filter((v) => !ids(below).has(v));
      const born = [...ids(below)].filter((v) => !ids(above).has(v));
      // 由反应前后相分数之差得到反应式（减少者为反应物，增加者为产物）
      const reactants: string[] = [];
      const products: string[] = [];
      union.forEach((_, id) => {
        const dlt = (fb.get(id) ?? 0) - (fa.get(id) ?? 0);
        if (dlt < -1e-9) reactants.push(id);
        else if (dlt > 1e-9) products.push(id);
      });
      const rxn = `${reactants.join(' + ')} → ${products.join(' + ')}`;
      let detail = iv
        ? `${iv.name}：${iv.reaction.text.replace('⇌', '→')}，恒温进行；本成分的实际反应为 ${rxn}。`
        : `等温反应（液相与固相成分点共线的拟二元情形）：${rxn}，恒温进行。`;
      detail += gone.length ? ` 反应后 ${gone.join('、')} 消失` : '';
      detail += born.length ? `${gone.length ? '，' : ' 反应后'}${born.join('、')} 出现` : '';
      detail += `；反应后相组成：${below.phases.map((p) => p.id).join(' + ')}。`;
      events.push({
        kind: 'invariant',
        T: Te,
        t: 0,
        title: iv ? `${iv.label} 点不变反应：${rxn}` : `等温反应：${rxn}`,
        detail,
        index: samples.length - nSub - 1,
        plateau: true,
        xL,
      });
      prev = below;
      T = Te;
      push(Te - 1e-4, below, -1, -1);
      T = Te - 1e-4;
      continue;
    }
    // 连续事件
    const a = ids(above);
    const b = ids(below);
    const added = [...b].filter((v) => !a.has(v));
    const removed = [...a].filter((v) => !b.has(v));
    let kind: TraceEvent['kind'] = 'univariant';
    let title = '';
    let detail = '';
    const idx = samples.length - 1;
    if (a.size === 1 && a.has('L')) {
      kind = 'liquidus';
      title = `液相线：初晶 ${added.join('、')} 开始析出`;
      detail = `温度降至 ${cel(Te)} 时液相对 ${added.join('、')} 饱和，L → ${added.join('、')}。`;
    } else if (removed.includes('L')) {
      kind = 'vanish';
      title = '液相消失，凝固结束';
      detail = `${cel(Te)} 时液相耗尽，之后为纯固相组合。`;
    } else if (removed.length) {
      kind = 'vanish';
      const nm = removed.join('、');
      title = `${nm} 被耗尽`;
      detail = `转熔反应进行中 ${nm} 被回溶殆尽，液相离开转熔线继续沿初晶面或另一单变线演化。`;
    } else {
      // 新增固相：判断共晶型 / 转熔型（观察新相共存后的相分数变化）
      const e1 = d.equilibrium(x0, Te - 0.002);
      const e2 = d.equilibrium(x0, Te - 0.02);
      const resorb: string[] = [];
      for (const p of e1.phases) {
        if (p.si < 0) continue;
        const q = e2.phases.find((r) => r.id === p.id);
        if (q && q.frac < p.frac - 1e-7) resorb.push(p.id);
      }
      const grown = e1.phases.filter((p) => p.si >= 0 && !resorb.includes(p.id)).map((p) => p.id);
      if (resorb.length) {
        title = `进入转熔线：${resorb.join('、')} 开始回溶，${added.join('、')} 析出`;
        detail = `L + ${resorb.join(' + ')} → ${grown.join(' + ')}（转熔反应，双箭头界线）。液相成分沿转熔线移动，先析出相被部分回溶。`;
      } else {
        title = `进入共晶线：${added.join('、')} 与 ${grown.filter((g) => !added.includes(g)).join('、') || '先析出相'} 共同析出`;
        detail = `L → ${grown.join(' + ')}（共晶型单变反应，单箭头界线）。液相成分沿单变线向低温方向移动。`;
      }
    }
    events.push({ kind, T: Te, t: 0, title, detail, index: idx, plateau: false, xL });
    prev = below;
    T = Te;
    push(Te - 1e-4, below, -1, -1);
    T = Te - 1e-4;
  }

  // 归一：时间 = Q/Q_end·100，保证单调（异常小回退修正）
  const Qend = samples[samples.length - 1].t || 1;
  let last = 0;
  for (const s of samples) {
    s.t = Math.max(last, s.t);
    last = s.t;
  }
  const scale = 100 / Math.max(Qend, 1e-9);
  for (const s of samples) s.t *= scale;
  // 事件时间
  for (const ev of events) ev.t = samples[Math.max(0, Math.min(samples.length - 1, ev.index))].t;
  const fin = samples[samples.length - 1];
  events.push({
    kind: 'end',
    T: fin.T,
    t: fin.t,
    title: `冷却至 ${cel(fin.T)}`,
    detail: `最终相组成：${fin.eq.phases.map((p) => `${p.id} ${(p.frac * 100).toFixed(1)}%`).join('，')}。`,
    index: samples.length - 1,
    plateau: false,
    xL: null,
  });
  const liquidPath: Trace['liquidPath'] = [];
  for (const s of samples) {
    const l = s.eq.phases.find((p) => p.si < 0);
    if (l && s.eq.phases.length > 1) liquidPath.push({ x: l.x, T: s.T, t: s.t });
  }
  const narrative = events.map((e) => `${cel(e.T)}　${e.title}`);
  return {
    x0,
    Tliq,
    samples,
    events,
    tEnd: samples[samples.length - 1].t,
    finalKey: fin.eq.key,
    finalPhases: fin.eq.phases,
    liquidPath,
    narrative,
  };
}

/** 时间 t 处的样本下标（最近） */
export function sampleIndexAtTime(tr: Trace, t: number): number {
  const s = tr.samples;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(s[lo - 1].t - t) < Math.abs(s[lo].t - t)) lo--;
  return lo;
}

/** 温度 T 处第一个样本下标（降温序列中首个 ≤ T 者） */
export function sampleIndexAtT(tr: Trace, T: number): number {
  const s = tr.samples;
  for (let i = 0; i < s.length; i++) if (s[i].T <= T + 1e-9) return i;
  return s.length - 1;
}
