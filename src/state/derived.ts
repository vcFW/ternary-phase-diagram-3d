import { useMemo } from 'react';
import type { PhaseDiagram } from '../core/diagram';
import type { Comp, Equilibrium, InvariantPoint } from '../core/types';
import { gibbsDuhemOfEq } from '../math/curves';
import { minimizeGibbs, type GMinResult } from '../math/gibbsMin';
import { phaseFractions } from '../math/lever';
import { analyzeReaction, reactionThermo, type RxAnalysis, type RxPhase, type RxThermo } from '../math/reaction';
import { analyzePoint, type PointAnalysis } from '../math/pointAnalysis';
import { scheil, type ScheilStep } from '../math/scheil';
import { useStore } from './store';

/**
 * 派生计算的唯一入口：所有页面通过这里取得同一物理状态的分析结果，避免各页面重复实现或重复计算。
 * 缓存键 = 相图实例 uid + 成分 + 温度。
 */
const LRU = 24;
const caches = new Map<string, Map<string, unknown>>();

export function memo<T>(bucket: string, key: string, fn: () => T): T {
  let m = caches.get(bucket);
  if (!m) caches.set(bucket, (m = new Map()));
  if (m.has(key)) {
    const v = m.get(key) as T;
    m.delete(key);
    m.set(key, v);
    return v;
  }
  const v = fn();
  m.set(key, v);
  if (m.size > LRU) m.delete(m.keys().next().value as string);
  return v;
}

const kx = (x: Comp) => x.map((v) => v.toFixed(6)).join(',');

export function gibbsMinAt(d: PhaseDiagram, x0: Comp, T: number): GMinResult {
  return memo('gmin', `${d.uid}|${kx(x0)}|${T.toFixed(4)}`, () => minimizeGibbs(d.th, x0, T));
}

export function scheilOf(d: PhaseDiagram, x0: Comp): ScheilStep[] {
  return memo('scheil', `${d.uid}|${kx(x0)}`, () => scheil(d, x0));
}

export interface InvariantAnalysis {
  iv: InvariantPoint;
  phases: RxPhase[];
  rx: RxAnalysis;
  thermo: RxThermo | null;
}

export function invariantAnalyses(d: PhaseDiagram): InvariantAnalysis[] {
  return memo('inv', `${d.uid}`, () =>
    d.topo.invariants.map((iv) => {
      const phases: RxPhase[] = [{ label: 'L', x: iv.x, si: -1 }, ...iv.solids.map((si, k) => ({ label: d.solids[si].label, x: iv.solidX[k] ?? d.solids[si].n, si }))];
      const rx = analyzeReaction(phases);
      return { iv, phases, rx, thermo: rx.nu ? reactionThermo(d.th, phases, rx.nu) : null };
    }),
  );
}

export function eqAnalysis(d: PhaseDiagram, x0: Comp, T: number, eq: Equilibrium) {
  return memo('eqa', `${d.uid}|${kx(x0)}|${T.toFixed(4)}|${eq.key}|${eq.phases.map((p) => p.frac.toFixed(9)).join()}`, () => ({
    lever: phaseFractions(eq.phases.map((p) => p.x), x0),
    gd: gibbsDuhemOfEq(d.th, eq.phases, T),
  }));
}

/** 同步派生：按键缓存的 useMemo（缓存键 = 相图 uid + 调用方给出的键） */
export function useDerived<T>(d: PhaseDiagram, key: string, fn: () => T): T {
  return useMemo(() => memo('derived', `${d.uid}|${key}`, fn), [d, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 当前全局物理状态的完整点分析（几何 / 稳定性 / 反应 / 数学），各分析页共用 */
export function usePointAnalysis(): PointAnalysis | null {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  const trace = useStore((s) => s.trace);
  return useMemo(() => {
    try {
      return analyzePoint(d, x0, T, eq, trace);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [d, x0, T, eq, trace]);
}

/** 当前全局物理状态的分析（React 钩子） */
export function useEqAnalysis() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  return useMemo(() => ({ d, x0, T, eq, ...eqAnalysis(d, x0, T, eq) }), [d, x0, T, eq]);
}
