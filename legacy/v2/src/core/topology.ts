import { toXY } from './barycentric';
import type { Thermo } from './thermo';
import type {
  BoundaryCurve,
  Comp,
  CompoundInfo,
  CurvePiece,
  InvariantPoint,
  PrimaryField,
  Reaction,
  ReactionType,
} from './types';

/**
 * 由热力学模型自动提取液相面拓扑：初晶区、单变线（含类型与降温方向）、不变点（含反应式）、
 * 二元特征点与化合物稳定性判据。不预设任何拓扑，一致/不一致熔融均由 Tsat 的最大值结构得出。
 */

export interface Topology {
  fields: PrimaryField[];
  curves: BoundaryCurve[];
  invariants: InvariantPoint[];
  compounds: CompoundInfo[];
}

/** 解 c0·a + c1·b + c2·c = r（列向量方程）。 */
function solveCols(a: Comp, b: Comp, c: Comp, r: Comp): Comp | null {
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  if (Math.abs(det) < 1e-12) return null;
  const d0 = r[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (r[1] * c[2] - r[2] * c[1]) + c[0] * (r[1] * b[2] - r[2] * b[1]);
  const d1 = a[0] * (r[1] * c[2] - r[2] * c[1]) - r[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * r[2] - a[2] * r[1]);
  const d2 = a[0] * (b[1] * r[2] - b[2] * r[1]) - b[0] * (a[1] * r[2] - a[2] * r[1]) + r[0] * (a[1] * b[2] - a[2] * b[1]);
  return [d0 / det, d1 / det, d2 / det];
}

function reactionText(th: Thermo, terms: { si: number; coef: number }[]): string {
  const left = ['L'];
  const right: string[] = [];
  for (const t of terms) {
    if (t.si < 0) continue;
    (t.coef < -1e-9 ? left : right).push(th.solids[t.si].label);
  }
  return `${left.join(' + ')} ⇌ ${right.join(' + ')}`;
}

/** 液相 xL 与 2 或 3 个固相共存时的反应（降温方向，液相系数 −1）。 */
export function reactionAt(th: Thermo, xL: Comp, solids: number[]): Reaction {
  let coefs: number[];
  if (solids.length === 3) {
    const r = solveCols(th.solids[solids[0]].n, th.solids[solids[1]].n, th.solids[solids[2]].n, xL);
    coefs = r ? [r[0], r[1], r[2]] : [1 / 3, 1 / 3, 1 / 3];
  } else {
    const a = th.solids[solids[0]].n;
    const b = th.solids[solids[1]].n;
    const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const c0 = ((xL[0] - b[0]) * d[0] + (xL[1] - b[1]) * d[1] + (xL[2] - b[2]) * d[2]) / dd;
    coefs = [c0, 1 - c0];
  }
  const terms = [{ si: -1, coef: -1 }, ...solids.map((si, k) => ({ si, coef: coefs[k] }))];
  const nNeg = coefs.filter((c) => c < -1e-7).length;
  let type: ReactionType;
  if (solids.length === 3) type = nNeg === 0 ? 'eutectic' : nNeg === 1 ? 'transition' : 'peritectic';
  else type = nNeg === 0 ? 'eutectic' : 'peritectic';
  return { terms, type, text: reactionText(th, terms) };
}

interface Seg {
  a: string;
  b: string;
}

export function extractTopology(th: Thermo, N = 150): Topology {
  const ns = th.solids.length;
  const rowStart: number[] = [];
  let nv = 0;
  for (let i = 0; i <= N; i++) {
    rowStart.push(nv);
    nv += N - i + 1;
  }
  const vid = (i: number, j: number) => rowStart[i] + j;
  const X: Comp[] = new Array(nv);
  const lab = new Int16Array(nv);
  const Tl = new Float64Array(nv);
  const vi = new Int16Array(nv);
  const vj = new Int16Array(nv);
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N - i; j++) {
      const v = vid(i, j);
      const x: Comp = [i / N, j / N, (N - i - j) / N];
      X[v] = x;
      vi[v] = i;
      vj[v] = j;
      const L = th.liquidus(x);
      lab[v] = L.si;
      Tl[v] = L.T;
    }
  }

  // 初晶区统计
  const area = new Float64Array(ns);
  const cen = Array.from({ length: ns }, () => [0, 0, 0]);
  const tmax = new Float64Array(ns);
  for (let v = 0; v < nv; v++) {
    const s = lab[v];
    area[s]++;
    for (let k = 0; k < 3; k++) cen[s][k] += X[v][k];
    if (Tl[v] > tmax[s]) tmax[s] = Tl[v];
  }
  const fields: PrimaryField[] = [];
  for (let s = 0; s < ns; s++) {
    if (area[s] === 0) continue;
    const c: Comp = [cen[s][0] / area[s], cen[s][1] / area[s], cen[s][2] / area[s]];
    fields.push({ si: s, area: area[s] / nv, centroid: c, Tmax: tmax[s] });
  }

  // 边上精确交点（Tp = Tq）
  const edgeCache = new Map<number, { x: Comp; T: number }>();
  const crossing = (u: number, v: number) => {
    const key = u < v ? u * nv + v : v * nv + u;
    let r = edgeCache.get(key);
    if (r) return r;
    const p = lab[u];
    const q = lab[v];
    const xu = X[u];
    const xv = X[v];
    let lo = 0;
    let hi = 1;
    const at = (t: number): Comp => [xu[0] + (xv[0] - xu[0]) * t, xu[1] + (xv[1] - xu[1]) * t, xu[2] + (xv[2] - xu[2]) * t];
    for (let it = 0; it < 48; it++) {
      const mid = 0.5 * (lo + hi);
      const x = at(mid);
      if (th.Tsat(p, x) - th.Tsat(q, x) >= 0) lo = mid;
      else hi = mid;
    }
    const x = at(0.5 * (lo + hi));
    r = { x, T: th.Tsat(p, x) };
    edgeCache.set(key, r);
    return r;
  };

  const nodes = new Map<string, { x: Comp; inv: boolean }>();
  const segs = new Map<string, Seg[]>();
  const addSeg = (p: number, q: number, a: string, b: string) => {
    const k = p < q ? `${p}-${q}` : `${q}-${p}`;
    let l = segs.get(k);
    if (!l) segs.set(k, (l = []));
    l.push({ a, b });
  };
  const edgeNode = (u: number, v: number) => {
    const key = u < v ? u * nv + v : v * nv + u;
    const id = `e${key}`;
    if (!nodes.has(id)) nodes.set(id, { x: crossing(u, v).x, inv: false });
    return id;
  };

  const found: { x: Comp; T: number; s: [number, number, number]; id: string }[] = [];
  const newton3 = (p: number, q: number, r: number, x0: Comp): { x: Comp; T: number } | null => {
    let y1 = x0[1];
    let y2 = x0[2];
    const F = (a: number, b: number) => {
      const x: Comp = [1 - a - b, a, b];
      const tp = th.Tsat(p, x);
      return [tp - th.Tsat(q, x), tp - th.Tsat(r, x)];
    };
    for (let it = 0; it < 40; it++) {
      const f = F(y1, y2);
      if (Math.abs(f[0]) + Math.abs(f[1]) < 1e-9) break;
      const h = 1e-7;
      const f1 = F(y1 + h, y2);
      const f2 = F(y1, y2 + h);
      const j11 = (f1[0] - f[0]) / h;
      const j21 = (f1[1] - f[1]) / h;
      const j12 = (f2[0] - f[0]) / h;
      const j22 = (f2[1] - f[1]) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) return null;
      let d1 = (f[0] * j22 - f[1] * j12) / det;
      let d2 = (j11 * f[1] - j21 * f[0]) / det;
      const m = Math.max(Math.abs(d1), Math.abs(d2));
      if (m > 0.05) {
        d1 *= 0.05 / m;
        d2 *= 0.05 / m;
      }
      y1 -= d1;
      y2 -= d2;
      if (y1 < 0 || y2 < 0 || y1 + y2 > 1) return null;
    }
    const x: Comp = [1 - y1 - y2, y1, y2];
    const f = F(y1, y2);
    if (Math.abs(f[0]) + Math.abs(f[1]) > 1e-6) return null;
    return { x, T: th.Tsat(p, x) };
  };

  const handleTri = (a: number, b: number, c: number) => {
    const la = lab[a];
    const lb = lab[b];
    const lc = lab[c];
    if (la === lb && lb === lc) return;
    if (la !== lb && lb !== lc && la !== lc) {
      const s3 = [la, lb, lc].sort((p, q) => p - q) as [number, number, number];
      const cx: Comp = [
        (X[a][0] + X[b][0] + X[c][0]) / 3,
        (X[a][1] + X[b][1] + X[c][1]) / 3,
        (X[a][2] + X[b][2] + X[c][2]) / 3,
      ];
      const sol = newton3(s3[0], s3[1], s3[2], cx);
      const x = sol ? sol.x : cx;
      let node = found.find((f) => f.s[0] === s3[0] && f.s[1] === s3[1] && f.s[2] === s3[2] && dist3(f.x, x) < 4 / N);
      if (!node) {
        node = { x, T: th.Tsat(s3[0], x), s: s3, id: `i${found.length}` };
        found.push(node);
        nodes.set(node.id, { x, inv: true });
      }
      addSeg(la, lb, node.id, edgeNode(a, b));
      addSeg(lb, lc, node.id, edgeNode(b, c));
      addSeg(lc, la, node.id, edgeNode(c, a));
      return;
    }
    // 两种标签
    const vs = [a, b, c];
    const ids: string[] = [];
    let p = -1;
    let q = -1;
    for (let k = 0; k < 3; k++) {
      const u = vs[k];
      const v = vs[(k + 1) % 3];
      if (lab[u] !== lab[v]) {
        ids.push(edgeNode(u, v));
        p = lab[u];
        q = lab[v];
      }
    }
    // 两条交点边的标签对（同为 {p,q}）
    const l0 = [la, lb, lc];
    const uniq = Array.from(new Set(l0));
    p = uniq[0];
    q = uniq[1];
    if (ids.length === 2) addSeg(p, q, ids[0], ids[1]);
  };

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      handleTri(vid(i, j), vid(i + 1, j), vid(i, j + 1));
      if (i + j <= N - 2) handleTri(vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1));
    }
  }

  // 连线成折线
  const curves: BoundaryCurve[] = [];
  segs.forEach((list, key) => {
    const [a, b] = key.split('-').map(Number);
    const adj = new Map<string, string[]>();
    for (const s of list) {
      if (!adj.has(s.a)) adj.set(s.a, []);
      if (!adj.has(s.b)) adj.set(s.b, []);
      adj.get(s.a)!.push(s.b);
      adj.get(s.b)!.push(s.a);
    }
    const used = new Set<string>();
    const ek = (u: string, v: string) => (u < v ? `${u}|${v}` : `${v}|${u}`);
    const walk = (start: string): string[] => {
      const path = [start];
      let cur = start;
      for (;;) {
        const nb = adj.get(cur)!.find((n) => !used.has(ek(cur, n)));
        if (nb === undefined) break;
        used.add(ek(cur, nb));
        path.push(nb);
        cur = nb;
      }
      return path;
    };
    const starts = Array.from(adj.keys()).filter((n) => adj.get(n)!.length === 1);
    const paths: string[][] = [];
    for (const s of starts) {
      if (adj.get(s)!.every((n) => used.has(ek(s, n)))) continue;
      paths.push(walk(s));
    }
    for (const s of adj.keys()) {
      if (adj.get(s)!.some((n) => !used.has(ek(s, n)))) paths.push(walk(s));
    }
    for (const path of paths) {
      if (path.length < 2) continue;
      let pts = path.map((id) => nodes.get(id)!.x);
      let T = pts.map((x) => th.Tsat(a, x));
      if (T[0] < T[T.length - 1]) {
        pts = pts.slice().reverse();
        T = T.slice().reverse();
      }
      curves.push({ id: `c${curves.length}`, a, b, pts, T, pieces: [], maxima: [] });
    }
  });

  // 不变点：分类
  const invariants: InvariantPoint[] = [];
  for (const f of found) {
    const rx = reactionAt(th, f.x, f.s);
    invariants.push({
      id: f.id,
      label: '',
      rank: 'ternary',
      x: f.x,
      T: f.T,
      solids: f.s,
      reaction: rx,
      name: rx.type === 'eutectic' ? '三元共晶点（低共熔点）' : rx.type === 'transition' ? '过渡点（单转熔点）' : '三元包晶点（双转熔点）',
    });
  }
  // 二元点：折线端点位于边界
  const seenBin: Comp[] = [];
  for (const cv of curves) {
    for (const end of [0, cv.pts.length - 1]) {
      const x = cv.pts[end];
      if (Math.min(x[0], x[1], x[2]) > 1e-7) continue;
      if (seenBin.some((y) => dist3(x, y) < 1e-6)) continue;
      // 若该点与某个三元不变点重合则跳过
      seenBin.push(x);
      const rx = reactionAt(th, x, [cv.a, cv.b]);
      invariants.push({
        id: `b${invariants.length}`,
        label: '',
        rank: 'binary',
        x,
        T: th.Tsat(cv.a, x),
        solids: [cv.a, cv.b],
        reaction: rx,
        name: rx.type === 'eutectic' ? '二元共晶点' : '二元包晶点（转熔点）',
      });
    }
  }
  // 命名：温度降序编号
  const nameSeq: Record<string, number> = {};
  const prefix = (iv: InvariantPoint) =>
    iv.rank === 'ternary'
      ? iv.reaction.type === 'eutectic'
        ? 'E'
        : iv.reaction.type === 'transition'
          ? 'U'
          : 'P'
      : iv.reaction.type === 'eutectic'
        ? 'e'
        : 'p';
  [...invariants]
    .sort((a, b) => b.T - a.T)
    .forEach((iv) => {
      const p = prefix(iv);
      nameSeq[p] = (nameSeq[p] ?? 0) + 1;
      iv.label = `${p}${nameSeq[p]}`;
    });
  const onlyOne = (p: string) => (nameSeq[p] ?? 0) === 1;
  invariants.forEach((iv) => {
    const p = iv.label.charAt(0);
    if (onlyOne(p)) iv.label = p;
  });

  // 单变线分段：降温方向、类型
  for (const cv of curves) classifyCurve(th, cv);

  // 化合物稳定性
  const compounds: CompoundInfo[] = [];
  for (let si = 3; si < ns; si++) {
    const s = th.solids[si];
    const Thyp = th.Tsat(si, s.n);
    const lq = th.liquidus(s.n);
    const congruent = lq.si === si || lq.T - Thyp < 1e-6;
    const hasField = fields.some((f) => f.si === si);
    let Tdecomp: number | null = null;
    if (congruent) Tdecomp = Thyp;
    else {
      for (const iv of invariants) {
        const k = iv.solids.indexOf(si);
        if (k < 0) continue;
        const term = iv.reaction.terms.find((t) => t.si === si);
        if (term && term.coef > 1e-7 && (Tdecomp === null || iv.T > Tdecomp)) Tdecomp = iv.T;
      }
    }
    compounds.push({ si, congruent, Thyp, Tliq: lq.T, liqSi: lq.si, hasField, Tdecomp, text: '' });
  }
  return { fields, curves, invariants, compounds };
}

function dist3(a: Comp, b: Comp): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function classifyCurve(th: Thermo, cv: BoundaryCurve) {
  const n = cv.pts.length;
  if (n < 2) return;
  const sa = th.solids[cv.a].n;
  const sb = th.solids[cv.b].n;
  const A = toXY(sa);
  const B = toXY(sb);
  // 逐段：降温方向 d 与反应类型
  const dir: number[] = [];
  const kind: ReactionType[] = [];
  const res: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const d = cv.T[k] >= cv.T[k + 1] ? 1 : -1;
    dir.push(d);
    const p0 = toXY(cv.pts[d === 1 ? k : k + 1]);
    const p1 = toXY(cv.pts[d === 1 ? k + 1 : k]);
    const mid: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const t = [p1[0] - p0[0], p1[1] - p0[1]];
    const ua = [A[0] - mid[0], A[1] - mid[1]];
    const ub = [B[0] - mid[0], B[1] - mid[1]];
    const det = ua[0] * ub[1] - ua[1] * ub[0];
    let kd: ReactionType = 'eutectic';
    let rs = -1;
    if (Math.abs(det) > 1e-9) {
      const al = (t[0] * ub[1] - t[1] * ub[0]) / det;
      const be = (ua[0] * t[1] - ua[1] * t[0]) / det;
      // L·dx_L = −Σ dn_s (x_s − x_L)：系数为正表示该固相被回溶
      // 回溶量相对另一相不足 5% 视为共晶型（退化/临界情形，避免噪声引起的类型抖动）
      if (al > 0 && be < 0 && al > 0.05 * -be) {
        kd = 'peritectic';
        rs = cv.a;
      } else if (be > 0 && al < 0 && be > 0.05 * -al) {
        kd = 'peritectic';
        rs = cv.b;
      }
    }
    kind.push(kd);
    res.push(rs);
  }
  // 成段并合并过短段
  type Run = { d: number; kd: ReactionType; rs: number; s: number; e: number };
  let runs: Run[] = [];
  for (let k = 0; k < dir.length; k++) {
    const last = runs[runs.length - 1];
    if (last && last.d === dir[k] && last.kd === kind[k] && last.rs === res[k]) last.e = k;
    else runs.push({ d: dir[k], kd: kind[k], rs: res[k], s: k, e: k });
  }
  for (let guard = 0; guard < 50 && runs.length > 1; guard++) {
    const idx = runs.findIndex((r) => r.e - r.s + 1 < 3);
    if (idx < 0) break;
    const tgt = idx > 0 ? idx - 1 : 1;
    const r = runs[idx];
    const t = runs[tgt];
    t.s = Math.min(t.s, r.s);
    t.e = Math.max(t.e, r.e);
    runs.splice(idx, 1);
    // 合并后相邻同类
    runs = runs.reduce<Run[]>((acc, cur) => {
      const l = acc[acc.length - 1];
      if (l && l.d === cur.d && l.kd === cur.kd && l.rs === cur.rs) l.e = cur.e;
      else acc.push(cur);
      return acc;
    }, []);
  }
  const pieces: CurvePiece[] = runs.map((r) =>
    r.d === 1 ? { i0: r.s, i1: r.e + 1, kind: r.kd, resorbed: r.rs } : { i0: r.e + 1, i1: r.s, kind: r.kd, resorbed: r.rs },
  );
  cv.pieces = pieces;
  for (let k = 0; k < runs.length - 1; k++) {
    if (runs[k].d === -1 && runs[k + 1].d === 1) cv.maxima.push(runs[k].e + 1);
  }
}
