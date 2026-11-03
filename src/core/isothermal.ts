import { hullSection } from './hullSection';
import { SQRT3_2, toXY } from './barycentric';
import type { PhaseDiagram } from './diagram';
import type { Comp } from './types';

/**
 * 等温截面的精确几何：在固定 T 下，
 *   · 液相 + 单固相两相区 = 以固相点为顶点、饱和液相曲线（弧）为底的扇形（连结线扫过）；
 *   · 三相区 = 连结三角形（液相点 = 两条弧的交点，即该温度的单变线点）；
 *   · 纯固相区 = 稳定的相容三角形；其余为单液相区。
 */
export interface IsoRegion {
  key: string;
  kind: 'two' | 'three' | 'solid';
  poly: Comp[];
  /** 下凸包剖分出的小块（固溶体体系）：只填色，不描边、不单独标注 */
  fine?: boolean;
}

export interface IsoArc {
  si: number;
  pts: Comp[];
  /** 弧两端的邻接固相（-1 表示到达成分三角形边界） */
  startNb: number;
  endNb: number;
}

export interface IsoSection {
  T: number;
  regions: IsoRegion[];
  arcs: IsoArc[];
  ties: [Comp, Comp][];
  /** 三相连结三角形的液相顶点 */
  invariantPts: { x: Comp; solids: [number, number] }[];
}

const NA = 240; // 均匀角度采样数

/** 成分空间中由笛卡尔方向 (dx,dy) 给出的变化量 */
function dirComp(dx: number, dy: number): Comp {
  const dc = dy / SQRT3_2;
  const db = dx - 0.5 * dc;
  return [-db - dc, db, dc];
}

function arcsFor(d: PhaseDiagram, si: number, T: number): IsoArc[] {
  const th = d.th;
  const xs = d.solids[si].n;
  if (th.Tsat(si, xs) <= T) return [];
  const ns = d.ns;
  const XYs = toXY(xs);

  // 采样角度：均匀 + 指向各顶点 + 指向本固相参与的所有单变线交点（保证弧端点精确）
  const angles: number[] = [];
  for (let k = 0; k < NA; k++) angles.push((2 * Math.PI * k) / NA);
  const addDir = (x: Comp) => {
    const q = toXY(x);
    if (Math.hypot(q[0] - XYs[0], q[1] - XYs[1]) > 1e-9) angles.push(Math.atan2(q[1] - XYs[1], q[0] - XYs[0]));
  };
  for (let v = 0; v < 3; v++) {
    const x: Comp = [0, 0, 0];
    x[v] = 1;
    addDir(x);
  }
  for (let s2 = 0; s2 < ns; s2++) {
    if (s2 === si) continue;
    for (const xl of d.univariantAt(Math.min(si, s2), Math.max(si, s2), T)) addDir(xl);
  }
  const ang = Array.from(new Set(angles.map((a) => (a + 2 * Math.PI) % (2 * Math.PI)))).sort((a, b) => a - b);
  const n = ang.length;

  /** 沿角度 a 的射线：返回液相饱和点；射线指向三角形外或无根返回 null */
  const rayAt = (a: number): Comp | null => {
    const dc = dirComp(Math.cos(a), Math.sin(a));
    let rhit = Infinity;
    for (let i = 0; i < 3; i++) {
      if (dc[i] < -1e-12) {
        if (xs[i] < 1e-12) {
          if (dc[i] < -1e-9) return null;
          continue;
        }
        rhit = Math.min(rhit, -xs[i] / dc[i]);
      }
    }
    if (!isFinite(rhit) || rhit < 1e-9) return null;
    const at = (r: number): Comp => [xs[0] + r * dc[0], xs[1] + r * dc[1], xs[2] + r * dc[2]];
    const Pend = at(rhit);
    if (th.Tsat(si, Pend) >= T) return null;
    let lo = 0;
    let hi = rhit;
    for (let it = 0; it < 40; it++) {
      const mid = 0.5 * (lo + hi);
      if (th.Tsat(si, at(mid)) > T) lo = mid;
      else hi = mid;
    }
    const r = 0.5 * (lo + hi);
    return at(r);
  };
  const offender = (x: Comp): number => {
    let best = -1;
    let bt = T + 1e-7;
    for (let s = 0; s < ns; s++) {
      if (s === si) continue;
      const t = th.Tsat(s, x);
      if (t > bt) {
        bt = t;
        best = s;
      }
    }
    return best;
  };
  const pt: (Comp | null)[] = ang.map((a) => rayAt(a));
  const off = pt.map((x) => (x ? offender(x) : -2));
  const valid = (k: number) => pt[((k % n) + n) % n] !== null;
  const stable = (k: number) => valid(k) && off[((k % n) + n) % n] === -1;
  const angOf = (k: number) => {
    const q = Math.floor(k / n);
    return ang[((k % n) + n) % n] + q * 2 * Math.PI;
  };

  const refine = (kS: number, kU: number): { x: Comp; nb: number } | null => {
    if (!valid(kU)) return null;
    let a = angOf(kS);
    let b = angOf(kU);
    let xa = pt[((kS % n) + n) % n]!;
    let nb = off[((kU % n) + n) % n];
    for (let it = 0; it < 28; it++) {
      const m = 0.5 * (a + b);
      const x = rayAt(m);
      if (!x) break;
      const o = offender(x);
      if (o === -1) {
        a = m;
        xa = x;
      } else {
        b = m;
        nb = o;
      }
    }
    return { x: xa, nb };
  };

  let start = -1;
  for (let k = 0; k < n; k++)
    if (!stable(k)) {
      start = k;
      break;
    }
  if (start < 0) start = 0;
  const arcs: IsoArc[] = [];
  let cur: Comp[] = [];
  let startNb = -1;
  const flush = (endNb: number) => {
    if (cur.length >= 2) arcs.push({ si, pts: cur, startNb, endNb });
    cur = [];
  };
  for (let q = 0; q < n; q++) {
    const k = start + q;
    if (stable(k)) {
      if (cur.length === 0) {
        startNb = -1;
        if (valid(k - 1) && !stable(k - 1)) {
          const r = refine(k, k - 1);
          if (r) {
            cur.push(r.x);
            startNb = r.nb;
          }
        }
      }
      cur.push(pt[k % n]!);
    } else if (cur.length) {
      let endNb = -1;
      if (valid(k)) {
        const r = refine(k - 1, k);
        if (r) {
          cur.push(r.x);
          endNb = r.nb;
        }
      }
      flush(endNb);
    }
  }
  flush(-1);
  return arcs;
}

export function isothermal(d: PhaseDiagram, T: number): IsoSection {
  if (d.sol) return hullSection(d, d.sol, T);
  const regions: IsoRegion[] = [];
  const arcs: IsoArc[] = [];
  const ties: [Comp, Comp][] = [];
  const invariantPts: IsoSection['invariantPts'] = [];
  const seen = new Set<string>();
  for (let si = 0; si < d.ns; si++) {
    const as = arcsFor(d, si, T);
    for (const a of as) {
      arcs.push(a);
      const xs = d.solids[si].n;
      regions.push({ key: `L+${d.solids[si].id}`, kind: 'two', poly: [xs, ...a.pts] });
      const stepT = Math.max(1, Math.floor(a.pts.length / 7));
      for (let k = 0; k < a.pts.length; k += stepT) ties.push([xs, a.pts[k]]);
      for (const [nb, pos] of [
        [a.startNb, a.pts[0]],
        [a.endNb, a.pts[a.pts.length - 1]],
      ] as [number, Comp][]) {
        if (nb < 0) continue;
        const lo = Math.min(si, nb);
        const hi = Math.max(si, nb);
        const key = `${lo}-${hi}-${pos[0].toFixed(4)}-${pos[1].toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        regions.push({
          key: `L+${[d.solids[lo].id, d.solids[hi].id].join('+')}`,
          kind: 'three',
          poly: [pos, d.solids[lo].n, d.solids[hi].n],
        });
        invariantPts.push({ x: pos, solids: [lo, hi] });
      }
    }
  }
  for (const f of d.solidFacetsAt(T)) {
    regions.push({ key: f.map((i) => d.solids[i].id).join('+'), kind: 'solid', poly: f.map((i) => d.solids[i].n) });
  }
  return { T, regions, arcs, ties, invariantPts };
}

export { SQRT3_2 };
