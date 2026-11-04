import type { PhaseDiagram } from '../core/diagram';
import type { Comp } from '../core/types';

/**
 * Gulliver–Scheil 凝固（极限非平衡模型）—— 明确的假设：
 *   1. 固相中无扩散（已析出的固相被"冻结"，不再参与反应，因此不会被回溶）；
 *   2. 液相内完全混合（液相成分均匀）；
 *   3. 固/液界面处局部平衡（每一步液相按平衡相图析出固相）。
 * 它是扩散极慢的极限，而不是动力学预测：真实凝固介于平衡冷却与 Scheil 之间，需要扩散/动力学模型才能定量。
 *
 * 实现：每降 dT，把"当前液相"作为新的总成分求平衡；新析出的固相计入累积量并移出体系，剩余液相继续冷却。
 * 与 pycalphad 生态 scheil 包（simulate_scheil_solidification）的假设一致：液相均匀混合、固相不扩散、界面局部平衡；
 * 该包默认固定步长 1 K，这里采用自适应步长（0.25–10 K，按液相成分变化量控制），并在相集合改变处二分定位事件温度。
 */
export interface ScheilStep {
  T: number;
  /** 剩余液相分数（相对初始总量） */
  fL: number;
  xL: Comp;
  /** 当步析出的固相 */
  forming: string[];
  /** 累积固相（数量） */
  solids: Record<string, number>;
  /** 累积固相的平均成分（固溶体逐层析出、成分各不相同；化学计量相即其成分） */
  solidsX: Record<string, Comp>;
  /** 该步位于相集合改变的事件温度（二分定位，精度 ≤ eventTol） */
  event?: boolean;
  /** 终凝平台：剩余液相在该温度按不变反应（或固相线）一次结晶完毕 */
  plateau?: boolean;
}

export interface ScheilOpts {
  /** 给出则用固定步长（K）；缺省为自适应步长 */
  dT?: number;
  dTmin?: number;
  dTmax?: number;
  /** 自适应目标：每步液相成分（任一分量）的变化量 */
  dxTarget?: number;
  Tend?: number;
  fLmin?: number;
  /** 事件温度定位精度 / K */
  eventTol?: number;
}

type Eq = ReturnType<PhaseDiagram['equilibrium']>;

/**
 * 步长控制量：每个分量的变化量与其容许值之比的最大值（≤ 1 即满足）。
 * 容许值 = min(dxTarget, 2% 相对变化)，相对变化以分量自身（不小于 0.02）为尺度，
 * 使稀溶质（如 x_B = 0.03）的积分误差也受控。
 */
function stepRatio(a: Comp, b: Comp, dxTarget: number): number {
  let r = 0;
  for (let i = 0; i < 3; i++) {
    const tol = Math.min(dxTarget, 0.02 * Math.max(a[i], b[i], 0.02));
    r = Math.max(r, Math.abs(a[i] - b[i]) / tol);
  }
  return r;
}

export function scheil(d: PhaseDiagram, x0: Comp, opts?: ScheilOpts): ScheilStep[] {
  const fixed = opts?.dT;
  const dTmin = fixed ?? opts?.dTmin ?? 0.25;
  const dTmax = fixed ?? opts?.dTmax ?? 10;
  const dxTarget = opts?.dxTarget ?? 3e-3;
  const eventTol = opts?.eventTol ?? 0.05;
  const Tend = opts?.Tend ?? d.tRange().Tmin;
  const fLmin = opts?.fLmin ?? 1e-4;
  let xL: Comp = [...x0] as Comp;
  let fL = 1;
  const acc: Record<string, number> = {};
  const accX: Record<string, Comp> = {};
  const out: ScheilStep[] = [];
  let T = d.liquidus(x0).T + 0.01;
  out.push({ T, fL, xL, forming: [], solids: {}, solidsX: {} });
  let hint: Eq | null = null;
  let dT = fixed ?? 1;
  const setKey = (e: Eq) => e.phases.map((p) => p.id).sort().join('+');
  let prevSet: string | null = 'L';

  const addSolids = (eq: Eq, frac: number): string[] => {
    const forming: string[] = [];
    for (const p of eq.phases) {
      if (p.si < 0) continue;
      const m = frac * p.frac;
      const old = acc[p.id] ?? 0;
      const ox = accX[p.id] ?? p.x;
      accX[p.id] = [0, 1, 2].map((i) => (old * ox[i] + m * p.x[i]) / (old + m || 1)) as Comp;
      acc[p.id] = old + m;
      forming.push(p.id);
    }
    return forming;
  };
  const snapshot = (Tc: number, forming: string[], extra?: Partial<ScheilStep>) =>
    out.push({ T: Tc, fL, xL, forming, solids: { ...acc }, solidsX: { ...accX }, ...extra });

  while (T > Tend && fL > fLmin) {
    let Tn = Math.max(Tend, T - dT);
    let eq = d.equilibrium(xL, Tn, hint);
    let L = eq.phases.find((p) => p.si < 0);
    // 自适应：成分变化过大则减半重试
    if (fixed === undefined && L && dT > dTmin) {
      const dx = stepRatio(L.x, xL, dxTarget);
      if (dx > 3) {
        dT = Math.max(dTmin, dT / 2);
        continue;
      }
    }
    const key = setKey(eq);
    if (fixed === undefined && prevSet !== null && key !== prevSet) {
      // 相集合改变：二分定位事件温度（旧相集合仍成立的最低温度）
      let hi = T;
      let lo = Tn;
      while (hi - lo > eventTol) {
        const m = 0.5 * (hi + lo);
        if (setKey(d.equilibrium(xL, m, hint)) === prevSet) hi = m;
        else lo = m;
      }
      const hiEq = d.equilibrium(xL, hi, hint);
      const loEq = d.equilibrium(xL, lo, hint);
      const hiL = hiEq.phases.find((p) => p.si < 0);
      const loL = loEq.phases.find((p) => p.si < 0);
      if (hiL && !loL) {
        // 液相消失：剩余液相在 T* 一次结晶完毕（不变反应 / 固相线），记录终凝平台
        const formingEnd = addSolids(loEq, fL);
        snapshot(hi, [], { event: true });
        const frac = fL;
        fL = 0;
        void frac;
        snapshot(hi, formingEnd, { plateau: true, event: true });
        return out;
      }
      // 其余事件：停在事件温度，下一步越过它（跳过本次的集合比较）
      if (hiL) {
        const forming = addSolids(hiEq, fL);
        fL *= hiL.frac;
        xL = hiL.x;
        snapshot(hi, forming, { event: true });
        T = hi;
        hint = hiEq;
      }
      prevSet = null;
      dT = Math.max(dTmin, 0.25);
      continue;
    }
    hint = eq;
    const forming = addSolids(eq, fL);
    if (!L) {
      fL = 0;
      snapshot(Tn, forming);
      break;
    }
    const dx = stepRatio(L.x, xL, dxTarget);
    fL *= L.frac;
    xL = L.x;
    T = Tn;
    prevSet = key;
    snapshot(T, forming);
    if (fixed === undefined) dT = Math.min(dTmax, Math.max(dTmin, dT * Math.min(2, Math.max(0.5, 1 / Math.max(dx, 1e-12)))));
  }
  return out;
}
