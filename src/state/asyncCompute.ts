import { useMemo } from 'react';
import { call, Channel, useWorkerFor } from '../compute/client';
import { ISO_N } from '../compute/api';
import type { PhaseDiagram } from '../core/diagram';
import type { IsoSection } from '../core/isothermal';
import { isothermal } from '../core/isothermal';
import { computeIso, computeVertical } from '../core/sections';
import type { Comp } from '../core/types';
import type { VerticalRaster, VerticalSpec } from '../core/vertical';
import type { ScheilStep } from '../math/scheil';
import { scheilOf } from './derived';
import { useStore } from './store';

/**
 * 异步派生计算（含固溶体体系的等温截面 / 垂直截面 / Scheil）。
 * 化学计量体系与无 Worker 环境：同步返回（stale = false）。
 * 固溶体体系：先请求粗分辨率立即渲染，再请求精细结果替换；结果按 (diagram.uid, 量化参数) 缓存；
 * 新结果到达时递增 store.asyncTick，订阅它的视图重绘。未就绪时返回同一相图上最近一次的结果（stale = true）。
 */
const MAX = 160;
const cache = new Map<string, unknown>();
const last = new Map<string, unknown>();
const requested = new Set<string>();
const channels = new Map<string, Channel>();

function chan(name: string): Channel {
  let c = channels.get(name);
  if (!c) channels.set(name, (c = new Channel()));
  return c;
}

function put(key: string, lastKey: string, v: unknown) {
  cache.set(key, v);
  last.set(lastKey, v);
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  useStore.setState((s) => ({ asyncTick: s.asyncTick + 1 }));
}

/** levels：由粗到细的 [缓存键, 计算] 列表。返回最细的已缓存结果，并确保更细的层级已请求。 */
function progressive<T>(channel: string, lastKey: string, levels: [string, () => Promise<T>][]): { value: T | null; stale: boolean } {
  let best = -1;
  for (let i = levels.length - 1; i >= 0; i--)
    if (cache.has(levels[i][0])) {
      best = i;
      break;
    }
  if (best < levels.length - 1) {
    const taskKey = levels[levels.length - 1][0];
    if (!requested.has(taskKey)) {
      requested.add(taskKey);
      const dropped = chan(channel).submit(taskKey, async () => {
        for (const [k, run] of levels) {
          if (cache.has(k)) continue;
          put(k, lastKey, await run());
        }
      });
      if (dropped) requested.delete(dropped);
    }
  }
  if (best >= 0) return { value: cache.get(levels[best][0]) as T, stale: best < levels.length - 1 };
  return { value: (last.get(lastKey) as T | undefined) ?? null, stale: true };
}

/** 等温截面：固溶体体系异步（粗 → 细） */
export function isoOf(d: PhaseDiagram, T: number): { sec: IsoSection | null; stale: boolean } {
  if (!useWorkerFor(d.params)) return { sec: computeIso(d, T), stale: false };
  const base = `iso|${d.uid}|${T.toFixed(1)}`;
  const r = progressive<IsoSection>('iso', `iso|${d.uid}`, [
    [`${base}|c`, () => call(d.params, 'iso', T, ISO_N.coarse)],
    [`${base}|f`, () => call(d.params, 'iso', T, ISO_N.fine)],
  ]);
  return { sec: r.value, stale: r.stale };
}

/** 垂直截面栅格：固溶体体系异步（W/4 × H/4 → 全分辨率） */
export function verticalOf(d: PhaseDiagram, spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number): { ras: VerticalRaster | null; stale: boolean } {
  const lo = (): [number, number] => [Math.max(40, W >> 2), Math.max(30, H >> 2)];
  if (!useWorkerFor(d.params)) {
    const [w, h] = lo();
    // 同步路径沿用原有的"先粗后精"由调用方（VerticalView）负责
    return { ras: computeVertical(d, spec, W || w, H || h, Tmin, Tmax), stale: false };
  }
  const sk = [...spec.p1, ...spec.p2].map((v) => v.toFixed(4)).join(',');
  const base = `vert|${d.uid}|${sk}|${Tmin.toFixed(0)}|${Tmax.toFixed(0)}`;
  const [w, h] = lo();
  const r = progressive<VerticalRaster>('vert', `vert|${d.uid}|${W}x${H}`, [
    [`${base}|${w}x${h}`, () => call(d.params, 'vertical', spec, w, h, Tmin, Tmax)],
    [`${base}|${W}x${H}`, () => call(d.params, 'vertical', spec, W, H, Tmin, Tmax)],
  ]);
  return { ras: r.value, stale: r.stale };
}

/** 相区包络（一组温度下该相区的截面多边形）：固溶体体系异步 */
export function regionSlicesOf(d: PhaseDiagram, key: string, Ts: number[]): { T: number; polys: Comp[][] }[] | null {
  if (!useWorkerFor(d.params)) return computeApiLocal(d, key, Ts);
  const k = `region|${d.uid}|${key}|${Ts.length}`;
  progressive<{ T: number; polys: Comp[][] }[]>('region', k, [[k, () => call(d.params, 'regionSlices', key, Ts)]]);
  return cache.has(k) ? (cache.get(k) as { T: number; polys: Comp[][] }[]) : null;
}

function computeApiLocal(d: PhaseDiagram, key: string, Ts: number[]) {
  return Ts.map((T) => ({ T, polys: isothermal(d, T).regions.filter((r) => r.key === key).map((r) => r.poly) }));
}

/** Scheil 凝固：固溶体体系异步；未就绪时 data 为仅含起点的占位序列（computing = true） */
export function useScheil(d: PhaseDiagram, x0: Comp): { data: ScheilStep[]; computing: boolean } {
  const tick = useStore((s) => s.asyncTick);
  return useMemo(() => {
    if (!useWorkerFor(d.params)) return { data: scheilOf(d, x0), computing: false };
    const key = `scheil|${d.uid}|${x0.map((v) => v.toFixed(5)).join(',')}`;
    const r = progressive<ScheilStep[]>('scheil', key, [[key, () => call(d.params, 'scheil', x0)]]);
    const stub: ScheilStep[] = [{ T: d.liquidus(x0).T, fL: 1, xL: x0, forming: [], solids: {}, solidsX: {} }];
    return { data: cache.has(key) ? (cache.get(key) as ScheilStep[]) : stub, computing: r.stale };
  }, [d, x0, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}
