import { segIntersect, toXY } from './barycentric';
import type { PhaseDiagram } from './diagram';
import type { Comp } from './types';

/**
 * 垂直截面：沿成分三角形上的线段 p1→p2（参数 u∈[0,1]）切开三维相图。
 *
 * 不做逐像素平衡计算，而是逐"温度行"求出沿截面线的所有可能相界断点：
 *   (i)  各固相饱和面与截面线的交点；
 *   (ii) 三相区连结三角形两条侧边（液相点→固相点）与截面线的交点（随 T 变化）；
 *   (iii) 固-固连结线与截面线的交点（与 T 无关）。
 * 断点之间区间内相组成恒定，只需在区间中点求一次平衡即可 —— 相界位置沿 u 方向精确到亚像素。
 */
export interface VerticalSpec {
  p1: Comp;
  p2: Comp;
}

export interface VerticalRaster {
  W: number;
  H: number;
  Tmin: number;
  Tmax: number;
  /** 行 0 对应 Tmax */
  labels: Uint16Array;
  keys: string[];
  /** 液相线沿 u 的采样 */
  liquidus: Float64Array;
  /** 沿线各固相饱和温度（用于亚稳线绘制） */
  tsat: Float64Array[];
}

export function lerpComp(a: Comp, b: Comp, t: number): Comp {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function verticalRaster(d: PhaseDiagram, spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number): VerticalRaster {
  const th = d.th;
  const ns = d.ns;
  const U = Math.max(400, W * 2) + 1;
  const tsat = Array.from({ length: ns }, () => new Float64Array(U));
  const liquidus = new Float64Array(U);
  for (let k = 0; k < U; k++) {
    const x = lerpComp(spec.p1, spec.p2, k / (U - 1));
    let m = 0;
    for (let s = 0; s < ns; s++) {
      const t = th.Tsat(s, x);
      tsat[s][k] = t;
      if (t > m) m = t;
    }
    liquidus[k] = m;
  }
  if (d.sol) return scanRaster(d, spec, W, H, Tmin, Tmax, liquidus, tsat);
  const P = toXY(spec.p1);
  const Q = toXY(spec.p2);
  // (iii) 固-固连结线
  const staticBreaks: number[] = [];
  for (let a = 0; a < ns; a++)
    for (let b = a + 1; b < ns; b++) {
      const r = segIntersect(P, Q, toXY(d.solids[a].n), toXY(d.solids[b].n));
      if (r && r[0] > 1e-9 && r[0] < 1 - 1e-9 && r[1] >= -1e-9 && r[1] <= 1 + 1e-9) staticBreaks.push(r[0]);
    }

  const keyIds = new Map<string, number>();
  const keys: string[] = [];
  const idOf = (k: string) => {
    let v = keyIds.get(k);
    if (v === undefined) {
      v = keys.length;
      keys.push(k);
      keyIds.set(k, v);
    }
    return v;
  };
  idOf('L');
  const labels = new Uint16Array(W * H);
  const pairs: [number, number][] = [];
  for (let a = 0; a < ns; a++) for (let b = a + 1; b < ns; b++) pairs.push([a, b]);
  const solidXY = d.solids.map((s) => toXY(s.n));

  for (let j = 0; j < H; j++) {
    const T = Tmax - ((j + 0.5) / H) * (Tmax - Tmin);
    const br: number[] = [0, 1, ...staticBreaks];
    // (i)
    for (let s = 0; s < ns; s++) {
      const arr = tsat[s];
      for (let k = 0; k < U - 1; k++) {
        const a = arr[k] - T;
        const b = arr[k + 1] - T;
        if ((a > 0 && b <= 0) || (a <= 0 && b > 0)) br.push((k + a / (a - b)) / (U - 1));
      }
    }
    // (ii)
    for (const [a, b] of pairs) {
      const xls = d.univariantAt(a, b, T);
      for (const xl of xls) {
        const L = toXY(xl);
        for (const sx of [solidXY[a], solidXY[b]]) {
          const r = segIntersect(P, Q, L, sx);
          if (r && r[0] > 0 && r[0] < 1 && r[1] >= -1e-9 && r[1] <= 1 + 1e-9) br.push(r[0]);
        }
      }
    }
    br.sort((p, q) => p - q);
    let prevId = -1;
    let prevU = 0;
    const row = j * W;
    const paint = (u0: number, u1: number, id: number) => {
      const c0 = Math.round(u0 * W);
      const c1 = Math.round(u1 * W);
      for (let c = c0; c < c1; c++) labels[row + c] = id;
    };
    for (let k = 0; k < br.length - 1; k++) {
      const u0 = br[k];
      const u1 = br[k + 1];
      if (u1 - u0 < 1e-9) continue;
      const um = 0.5 * (u0 + u1);
      const xm = lerpComp(spec.p1, spec.p2, um);
      const ki = Math.min(U - 1, Math.round(um * (U - 1)));
      let id: number;
      if (liquidus[ki] <= T - 1e-9 && th.liquidus(xm).T <= T) id = 0;
      else id = idOf(d.equilibrium(xm, T).key);
      if (id === prevId) continue;
      if (prevId >= 0) paint(prevU, u0, prevId);
      prevId = id;
      prevU = u0;
    }
    if (prevId >= 0) paint(prevU, 1, prevId);
  }
  return { W, H, Tmin, Tmax, labels, keys, liquidus, tsat };
}

/** 截面线与某成分点的最近距离处的参数 u，距离过大返回 null（用于标出化合物线位置） */
export function uOfPoint(spec: VerticalSpec, x: Comp, tol = 1e-6): number | null {
  const P = toXY(spec.p1);
  const Q = toXY(spec.p2);
  const X = toXY(x);
  const dx = Q[0] - P[0];
  const dy = Q[1] - P[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-14) return null;
  const u = ((X[0] - P[0]) * dx + (X[1] - P[1]) * dy) / len2;
  if (u < -tol || u > 1 + tol) return null;
  const cx = P[0] + u * dx;
  const cy = P[1] + u * dy;
  if (Math.hypot(X[0] - cx, X[1] - cy) > tol) return null;
  return Math.min(1, Math.max(0, u));
}

/**
 * 固溶体体系：连结线端点随温度、成分变化，不能预先列出断点。逐温度行沿 u 等距取样求平衡
 * （相邻样本互为热启动提示），相组合改变处二分定位相界（精度 ≈ 1/(K·2⁹)）。
 */
function scanRaster(d: PhaseDiagram, spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number, liquidus: Float64Array, tsat: Float64Array[]): VerticalRaster {
  const keyIds = new Map<string, number>();
  const keys: string[] = [];
  const idOf = (k: string) => {
    let v = keyIds.get(k);
    if (v === undefined) {
      v = keys.length;
      keys.push(k);
      keyIds.set(k, v);
    }
    return v;
  };
  idOf('L');
  const labels = new Uint16Array(W * H);
  const K = 40;
  const U = liquidus.length;
  let rowHint: ReturnType<PhaseDiagram['equilibrium']> | null = null;
  for (let j = 0; j < H; j++) {
    const T = Tmax - ((j + 0.5) / H) * (Tmax - Tmin);
    const us: number[] = [];
    const ks: number[] = [];
    const hints: (ReturnType<PhaseDiagram['equilibrium']> | null)[] = [];
    let hint = rowHint;
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      const ki = Math.min(U - 1, Math.round(u * (U - 1)));
      let id = 0;
      let eq = null;
      if (liquidus[ki] > T - 1e-9) {
        eq = d.equilibrium(lerpComp(spec.p1, spec.p2, u), T, hint);
        hint = eq;
        id = idOf(eq.key);
      }
      us.push(u);
      ks.push(id);
      hints.push(eq);
      if (k === 0) rowHint = eq ?? rowHint;
    }
    const row = j * W;
    let u0 = 0;
    for (let k = 0; k < K; k++) {
      if (ks[k + 1] === ks[k]) continue;
      let lo = us[k];
      let hi = us[k + 1];
      let hl = hints[k] ?? hints[k + 1];
      for (let it = 0; it < 9; it++) {
        const m = 0.5 * (lo + hi);
        const ki = Math.min(U - 1, Math.round(m * (U - 1)));
        let id = 0;
        if (liquidus[ki] > T - 1e-9) {
          const e = d.equilibrium(lerpComp(spec.p1, spec.p2, m), T, hl);
          hl = e;
          id = idOf(e.key);
        }
        if (id === ks[k]) lo = m;
        else hi = m;
      }
      const ub = 0.5 * (lo + hi);
      for (let c = Math.round(u0 * W); c < Math.round(ub * W); c++) labels[row + c] = ks[k];
      u0 = ub;
    }
    for (let c = Math.round(u0 * W); c < W; c++) labels[row + c] = ks[K];
  }
  return { W, H, Tmin, Tmax, labels, keys, liquidus, tsat };
}
