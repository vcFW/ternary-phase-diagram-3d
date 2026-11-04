import { toXY } from './barycentric';
import type { PhaseDiagram } from './diagram';
import type { IsoArc, IsoRegion, IsoSection } from './isothermal';
import type { Comp } from './types';
import type { SolutionEngine } from './solution';
import { traceTwoPhase, type TieTarget, type ZpfCurve } from './zpfTrace';

/**
 * 含固溶体体系的等温截面 = 所有相自由能面的下凸包在成分三角形上的投影。
 *
 * 在 N 级网格的每个成分点上取各相中最低的 G（同一竖线上较高的点不可能在下凸包上），
 * 加入化学计量相的点，求三维下凸包（增量法）。每个下凸包三角面按其三个顶点所属的相分类：
 *   · 同一相、边长 ~ 网格间距      → 单相区的一小块
 *   · 两种相                       → 两相区（该面跨越一条连结线）
 *   · 三种相                       → 三相连结三角形（随后用 KKT 牛顿法把三个顶点精化到精确成分）
 * 这正是"等温截面 = 公切面族"的离散实现。精度：相界位置约为 1/N。
 */

interface HP {
  x: number;
  y: number;
  z: number;
  si: number;
  c: Comp;
}

export const HULL_N = 64;

const cache = new Map<string, IsoSection>();

/** trace = false：不做连结线延拓，两相区一律用凸包近似（用作高分辨率参照与回退） */
export function hullSection(d: PhaseDiagram, eng: SolutionEngine, T: number, N = HULL_N, trace = true): IsoSection {
  const key = `${d.uid}|${T.toFixed(3)}|${N}|${trace ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const th = d.th;
  const pts: HP[] = [];
  const cont = eng.cont;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N - i; j++) {
      const e = 1e-9;
      const c: Comp = [Math.max(e, i / N), Math.max(e, j / N), Math.max(e, (N - i - j) / N)];
      let best = Infinity;
      let bs = -1;
      for (const si of cont) {
        const g = th.Gphase(si, c, T);
        if (g < best) {
          best = g;
          bs = si;
        }
      }
      const [u, v] = toXY(c);
      pts.push({ x: u, y: v, z: best, si: bs, c });
    }
  for (const s of th.solids) {
    if (s.sol) continue;
    const [u, v] = toXY(s.n);
    const z = th.Gphase(s.index, s.n, T);
    const dup = pts.findIndex((p) => Math.hypot(p.x - u, p.y - v) < 1e-9);
    if (dup >= 0) {
      if (pts[dup].z > z) pts[dup] = { x: u, y: v, z, si: s.index, c: s.n };
    } else pts.push({ x: u, y: v, z, si: s.index, c: s.n });
  }
  const faces = lowerHull(pts);
  const h = 1 / N;
  const idOf = (si: number) => (si < 0 ? 'L' : th.solids[si].id);
  const keyOf = (sis: number[]) =>
    Array.from(new Set(sis))
      .sort((a, b) => a - b)
      .map(idOf)
      .join('+');
  const regions: IsoRegion[] = [];
  const ties: [Comp, Comp][] = [];
  const arcs: IsoArc[] = [];
  const threes: { sis: number[]; c: Comp[] }[] = [];
  const twoFaces: { ids: [number, number, number]; sis: number[] }[] = [];
  for (const [a, b, c] of faces) {
    const P = [pts[a], pts[b], pts[c]];
    const sis = P.map((p) => p.si);
    const uniq = Array.from(new Set(sis));
    const maxEdge = Math.max(dxy(P[0], P[1]), dxy(P[1], P[2]), dxy(P[2], P[0]));
    const area = Math.abs((P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[2].x - P[0].x) * (P[1].y - P[0].y)) / 2;
    // 沿三角形边界的退化细长面（边界点共线）不代表任何相区
    if (area < 1e-3 * h * h) continue;
    // 三角网格中相邻点距离为 h，菱形的长对角线为 √3·h；超过 2.1h 才视为同一相内部的溶解度间隙
    if (uniq.length === 1 && maxEdge < 2.1 * h) {
      regions.push({ key: idOf(uniq[0]), kind: 'two', poly: P.map((p) => p.c), fine: true });
    } else if (uniq.length === 3) {
      threes.push({ sis, c: P.map((p) => p.c) });
    } else {
      twoFaces.push({ ids: [a, b, c], sis });
    }
  }

  // 三相连结三角形：合并后精化
  const invariantPts: IsoSection['invariantPts'] = [];
  const triangles: { sis: number[]; ys: Comp[] }[] = [];
  const merged = new Map<string, { sis: number[]; c: Comp[] }>();
  for (const t of threes) {
    const k = [...t.sis].sort((a, b) => a - b).join(',');
    if (!merged.has(k)) merged.set(k, t);
  }
  merged.forEach((t) => {
    const order = t.sis.map((si, k) => ({ si, c: t.c[k] })).sort((a, b) => a.si - b.si);
    const ctr: Comp = [0, 1, 2].map((i) => (order[0].c[i] + order[1].c[i] + order[2].c[i]) / 3) as Comp;
    // 以三角形重心为总成分做精确求解：只有确认为该三相平衡时才采用（并用精确成分作顶点）
    const ex = eng.equilibrium(ctr, T);
    if (!(ex.phases.length === 3 && ex.phases.map((p) => p.si).join() === order.map((o) => o.si).join())) return;
    const poly = ex.phases.map((p) => p.x);
    regions.push({ key: keyOf(order.map((o) => o.si)), kind: 'three', poly });
    triangles.push({ sis: order.map((o) => o.si), ys: poly });
    if (order[0].si < 0) invariantPts.push({ x: poly[0], solids: [order[1].si, order[2].si] });
  });

  // 两相区：按相对 + 连通性聚类，每个簇用连结线延拓得到精确相界；失败的簇回退为凸包近似
  const tieCand: [Comp, Comp][] = [];
  const emitApprox = (f: { ids: [number, number, number]; sis: number[] }) => {
    const P = f.ids.map((i) => pts[i]);
    const uniq = Array.from(new Set(f.sis));
    regions.push({ key: keyOf(f.sis), kind: 'two', poly: P.map((p) => p.c), fine: true });
    for (let k = 0; k < 3; k++) {
      const p = P[k];
      const q = P[(k + 1) % 3];
      if (uniq.length === 1) continue;
      if (p.si === q.si) arcs.push({ si: p.si, pts: [p.c, q.c], startNb: -1, endNb: -1, approx: true });
      else tieCand.push([p.c, q.c]);
    }
  };
  const byPair = new Map<string, typeof twoFaces>();
  for (const f of twoFaces) {
    const u = Array.from(new Set(f.sis)).sort((a, b) => a - b);
    const k = u.join(',');
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(f);
  }
  byPair.forEach((list, pairKey) => {
    const u = pairKey.split(',').map(Number);
    let p = u[0];
    let q = u.length > 1 ? u[1] : u[0];
    if (!th.isContinuous(p)) [p, q] = [q, p];
    // 连通簇（共享凸包顶点）
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map<number, number>();
    list.forEach((f, i) =>
      f.ids.forEach((v) => {
        const o = owner.get(v);
        if (o === undefined) owner.set(v, i);
        else parent[find(i)] = find(o);
      }),
    );
    const clusters = new Map<number, typeof list>();
    list.forEach((f, i) => {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r)!.push(f);
    });
    const targets: TieTarget[] = [];
    for (const tri of triangles) {
      const ip = tri.sis.indexOf(p);
      const iq = tri.sis.indexOf(q);
      if (ip >= 0 && iq >= 0 && ip !== iq) targets.push({ P: tri.ys[ip], Q: tri.ys[iq] });
    }
    const traced: ZpfCurve[] = [];
    clusters.forEach((faces) => {
      // 种子连结线：先取离簇中心最近的几个面；已被前面曲线覆盖的簇跳过
      let cx = 0;
      let cy = 0;
      for (const f of faces) for (const v of f.ids) {
        cx += pts[v].x / (3 * faces.length);
        cy += pts[v].y / (3 * faces.length);
      }
      const ranked = [...faces].sort((a, b) => cdist(a, cx, cy) - cdist(b, cx, cy)).slice(0, 8);
      // 种子连结线：取凸包两相面的重心，用精确求解器得到该点的两相平衡，其两相成分即种子
      const seedOf = (f: (typeof faces)[number]): [Comp, Comp] | null => {
        const vs = f.ids.map((i) => pts[i]);
        const ctr: Comp = [0, 1, 2].map((i) => (vs[0].c[i] + vs[1].c[i] + vs[2].c[i]) / 3) as Comp;
        const ex = eng.equilibrium(ctr, T);
        if (ex.phases.length !== 2) return null;
        const sorted = [ex.phases[0].si, ex.phases[1].si].sort((a, b) => a - b);
        if (sorted[0] !== Math.min(p, q) || sorted[1] !== Math.max(p, q)) return null;
        const a = ex.phases.find((ph) => ph.si === p);
        const b = ex.phases.find((ph) => ph.si === q && ph !== a);
        return a && b ? [a.x, b.x] : null;
      };
      let curve: ZpfCurve | null = null;
      for (const f of ranked) {
        const sd = seedOf(f);
        if (!sd) continue;
        if (traced.some((cv) => covers(cv, sd))) return; // 该簇已被已追踪的连结线族覆盖
        curve = trace ? traceTwoPhase(th, p, q, T, sd[0], sd[1], targets) : null;
        if (curve) break;
      }
      if (!curve) {
        faces.forEach(emitApprox);
        return;
      }
      traced.push(curve);
      const cont = th.isContinuous(q);
      regions.push({ key: keyOf([p, q]), kind: 'two', poly: cont ? [...curve.P, ...curve.Q.slice().reverse()] : [...curve.P, th.solids[q].n] });
      arcs.push({ si: p, pts: curve.P, startNb: -1, endNb: -1 });
      if (cont) arcs.push({ si: q, pts: curve.Q, startNb: -1, endNb: -1 });
      const nT = Math.min(18, curve.P.length);
      for (let k = 0; k < nT; k++) {
        const i = Math.round(((k + 0.5) / nT) * (curve.P.length - 1));
        ties.push([curve.P[i], curve.Q[i]]);
      }
    });
  });
  // 回退面的连结线：同一端点只保留一条，按端点位置排序后均匀抽取约 40 条
  const groups = new Map<string, [Comp, Comp][]>();
  for (const t of tieCand) {
    const [u, v] = toXY(t[0]);
    const g = `${Math.round(u * 1e6)},${Math.round(v * 1e6)}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const uniqTies = Array.from(groups.values()).map((l) => l[0]);
  const stride = Math.max(1, Math.floor(uniqTies.length / 40));
  uniqTies.sort((p, q) => toXY(p[0])[0] - toXY(q[0])[0] || toXY(p[0])[1] - toXY(q[0])[1]);
  for (let i = 0; i < uniqTies.length; i += stride) ties.push(uniqTies[i]);
  const sec: IsoSection = { T, regions, arcs, ties, invariantPts, stripW: 2.4 * h };
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  cache.set(key, sec);
  return sec;

  function cdist(f: { ids: [number, number, number] }, cx: number, cy: number) {
    let sx = 0;
    let sy = 0;
    for (const v of f.ids) {
      sx += pts[v].x / 3;
      sy += pts[v].y / 3;
    }
    return Math.hypot(sx - cx, sy - cy);
  }
  /** 种子连结线的中点是否已落在某条已追踪的连结线族附近 */
  function covers(cv: ZpfCurve, sd: [Comp, Comp]): boolean {
    const mid = [0, 1, 2].map((i) => (sd[0][i] + sd[1][i]) / 2);
    for (let k = 0; k < cv.P.length; k += 2) {
      const m = [0, 1, 2].map((i) => (cv.P[k][i] + cv.Q[k][i]) / 2);
      if (Math.hypot(m[0] - mid[0], m[1] - mid[1], m[2] - mid[2]) < 0.02) return true;
    }
    return false;
  }
}

function dxy(a: HP, b: HP) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 三维点集的下凸包（增量法）。为减少上半部分的工作量，加入一个位于中心正上方很高处的"盖点"，
 * 返回外法向朝下的三角面（顶点下标）。
 */
export function lowerHull(P: { x: number; y: number; z: number }[]): [number, number, number][] {
  const n = P.length;
  let zmin = Infinity;
  let zmax = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const p of P) {
    zmin = Math.min(zmin, p.z);
    zmax = Math.max(zmax, p.z);
    cx += p.x / n;
    cy += p.y / n;
  }
  const span = Math.max(1, zmax - zmin);
  const X = P.map((p) => p.x);
  const Y = P.map((p) => p.y);
  // z 归一化，避免与 x、y 量级相差过大
  const Z = P.map((p) => (p.z - zmin) / span);
  X.push(cx);
  Y.push(cy);
  Z.push(50);
  const top = n;
  // 初始四面体：取 x 最小、x 最大、y 最大的点 + 盖点
  let i0 = 0;
  let i1 = 0;
  let i2 = 0;
  for (let i = 0; i < n; i++) {
    if (X[i] < X[i0] || (X[i] === X[i0] && Y[i] < Y[i0])) i0 = i;
    if (X[i] > X[i1] || (X[i] === X[i1] && Y[i] < Y[i1])) i1 = i;
    if (Y[i] > Y[i2]) i2 = i;
  }
  const fa: number[] = [];
  const fb: number[] = [];
  const fc: number[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  const nz: number[] = [];
  const nd: number[] = [];
  const alive: boolean[] = [];
  const edge = new Map<number, number>();
  const M = n + 1;
  const ek = (a: number, b: number) => a * M + b;
  const icx = (X[i0] + X[i1] + X[i2] + X[top]) / 4;
  const icy = (Y[i0] + Y[i1] + Y[i2] + Y[top]) / 4;
  const icz = (Z[i0] + Z[i1] + Z[i2] + Z[top]) / 4;
  const addFace = (a: number, b: number, c: number, orient: boolean) => {
    const ux = X[b] - X[a];
    const uy = Y[b] - Y[a];
    const uz = Z[b] - Z[a];
    const vx = X[c] - X[a];
    const vy = Y[c] - Y[a];
    const vz = Z[c] - Z[a];
    let px = uy * vz - uz * vy;
    let py = uz * vx - ux * vz;
    let pz = ux * vy - uy * vx;
    if (orient && px * (icx - X[a]) + py * (icy - Y[a]) + pz * (icz - Z[a]) > 0) {
      [b, c] = [c, b];
      px = -px;
      py = -py;
      pz = -pz;
    }
    const L = Math.hypot(px, py, pz) || 1;
    px /= L;
    py /= L;
    pz /= L;
    const f = fa.length;
    fa.push(a);
    fb.push(b);
    fc.push(c);
    nx.push(px);
    ny.push(py);
    nz.push(pz);
    nd.push(px * X[a] + py * Y[a] + pz * Z[a]);
    alive.push(true);
    edge.set(ek(a, b), f);
    edge.set(ek(b, c), f);
    edge.set(ek(c, a), f);
    return f;
  };
  addFace(i0, i1, i2, true);
  addFace(i0, i1, top, true);
  addFace(i1, i2, top, true);
  addFace(i2, i0, top, true);
  const EPS = 1e-11;
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (i !== i0 && i !== i1 && i !== i2) order.push(i);
  // 确定性打乱（避免网格顺序导致的退化与最坏复杂度）
  let seed = 12345;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const vis = (f: number, p: number) => nx[f] * X[p] + ny[f] * Y[p] + nz[f] * Z[p] - nd[f] > EPS;
  let lastVisible = 0;
  for (const p of order) {
    let start = -1;
    if (alive[lastVisible] && vis(lastVisible, p)) start = lastVisible;
    else
      for (let f = fa.length - 1; f >= 0; f--)
        if (alive[f] && vis(f, p)) {
          start = f;
          break;
        }
    if (start < 0) continue;
    // 广度优先找出可见面集合
    const visible: number[] = [start];
    const seen = new Set<number>([start]);
    for (let q = 0; q < visible.length; q++) {
      const f = visible[q];
      for (const [u, v] of [
        [fa[f], fb[f]],
        [fb[f], fc[f]],
        [fc[f], fa[f]],
      ]) {
        const g = edge.get(ek(v, u));
        if (g === undefined || seen.has(g)) continue;
        seen.add(g);
        if (alive[g] && vis(g, p)) visible.push(g);
      }
    }
    const vset = new Set(visible);
    const horizon: [number, number][] = [];
    for (const f of visible) {
      for (const [u, v] of [
        [fa[f], fb[f]],
        [fb[f], fc[f]],
        [fc[f], fa[f]],
      ]) {
        const g = edge.get(ek(v, u));
        if (g === undefined || !vset.has(g)) horizon.push([u, v]);
      }
    }
    for (const f of visible) {
      alive[f] = false;
      edge.delete(ek(fa[f], fb[f]));
      edge.delete(ek(fb[f], fc[f]));
      edge.delete(ek(fc[f], fa[f]));
    }
    for (const [u, v] of horizon) lastVisible = addFace(u, v, p, false);
  }
  const out: [number, number, number][] = [];
  for (let f = 0; f < fa.length; f++) {
    if (!alive[f] || nz[f] > -1e-9) continue;
    if (fa[f] === top || fb[f] === top || fc[f] === top) continue;
    out.push([fa[f], fb[f], fc[f]]);
  }
  return out;
}
