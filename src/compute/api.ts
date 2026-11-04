import { computeTrace, type Trace } from '../core/cooling';
import { PhaseDiagram } from '../core/diagram';
import { hullSection } from '../core/hullSection';
import { isothermal, type IsoSection } from '../core/isothermal';
import type { Topology } from '../core/topology';
import type { Comp, SystemParams } from '../core/types';
import { verticalRaster, type VerticalRaster, type VerticalSpec } from '../core/vertical';
import { scheil, type ScheilStep } from '../math/scheil';

/**
 * 计算 API：Worker 与"无 Worker 环境（Node 测试）"共用的纯函数集合。
 * 入参 / 返回值均为可结构化克隆的纯数据（不传类实例）；相图实例按参数哈希缓存在计算方内部。
 */
const cache = new Map<string, PhaseDiagram>();
const MAX_CACHE = 4;

export function paramsKey(p: SystemParams): string {
  return JSON.stringify(p);
}

export function diagramOf(params: SystemParams): PhaseDiagram {
  const key = paramsKey(params);
  let d = cache.get(key);
  if (d) {
    cache.delete(key);
  } else {
    d = new PhaseDiagram(params);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, d);
  return d;
}

/** 等温截面的网格精度：粗 / 细 */
export const ISO_N = { coarse: 32, fine: 64 } as const;

export const computeApi = {
  /** 构建相图拓扑，并附带给定成分的冷却轨迹（二者一起返回，保证状态一致） */
  build(params: SystemParams, x0: Comp): { topo: Topology; liqGrid: Float32Array; trace: Trace } {
    const d = diagramOf(params);
    return { topo: d.topo, liqGrid: d.liquidusGrid(), trace: computeTrace(d, x0) };
  },
  iso(params: SystemParams, T: number, N: number = ISO_N.fine): IsoSection {
    const d = diagramOf(params);
    return d.sol ? hullSection(d, d.sol, T, N) : isothermal(d, T);
  },
  vertical(params: SystemParams, spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number): VerticalRaster {
    return verticalRaster(diagramOf(params), spec, W, H, Tmin, Tmax);
  },
  /** 一系列等温截面中指定相区的多边形（三维"相区包络"用） */
  regionSlices(params: SystemParams, key: string, Ts: number[], N: number = ISO_N.coarse): { T: number; polys: Comp[][] }[] {
    const d = diagramOf(params);
    return Ts.map((T) => {
      const sec = d.sol ? hullSection(d, d.sol, T, N) : isothermal(d, T);
      return { T, polys: sec.regions.filter((r) => r.key === key).map((r) => r.poly) };
    });
  },
  trace(params: SystemParams, x0: Comp): Trace {
    return computeTrace(diagramOf(params), x0);
  },
  scheil(params: SystemParams, x0: Comp): ScheilStep[] {
    return scheil(diagramOf(params), x0, { dT: 0.5 });
  },
};

export type ComputeApi = typeof computeApi;
