import { triBary } from './barycentric';
import { Thermo } from './thermo';
import { SolutionEngine } from './solution';
import { extractTopology, type Topology } from './topology';
import type { BoundaryCurve, Comp, Equilibrium, PhaseAmount, Solid, SystemParams } from './types';

type Tri = [number, number, number];

/**
 * 相图：由热力学模型 (Thermo) + 自动提取的拓扑 (Topology) + 平衡求解器构成。
 *
 * 平衡求解采用"可构造状态中吉布斯能最小者"：候选状态包括
 *   · 单液相；  · 液相 + 1 固相（沿 固相→总成分 射线求饱和液相）；
 *   · 液相 + 2 固相（液相取单变线上温度为 T 的点）；  · 三固相连结三角形。
 * 每个候选都是真实可构造的混合状态，因此其中的最小者即为平衡态（凸包性质）。
 */
let uidCounter = 0;

/** 可在 Worker 中预先算好、传给主线程的数据 */
export interface Precomputed {
  topo?: Topology;
  liqGrid?: Float32Array;
}

/** 三维液相面网格的分辨率（每边剖分数） */
export const LIQ_GRID_N = 120;

export class PhaseDiagram {
  readonly uid = ++uidCounter;
  readonly th: Thermo;
  readonly params: SystemParams;
  readonly solids: Solid[];
  readonly topo: Topology;
  /** 含固溶体时的通用平衡求解器（化学计量体系为 null，走精确构造式求解） */
  readonly sol: SolutionEngine | null;
  private triples: Tri[] = [];
  private pairCurves = new Map<string, BoundaryCurve[]>();
  private uniCache = new Map<string, Comp[]>();
  private uniCacheT = NaN;

  /** pre：已在别处（计算 Worker）算好的拓扑与液相面网格；给出则跳过相应计算 */
  constructor(params: SystemParams, gridN = 150, pre?: Precomputed) {
    this.params = params;
    this.th = new Thermo(params);
    this.solids = this.th.solids;
    this.sol = this.th.hasSolution ? new SolutionEngine(this.th) : null;
    this.liqGridPre = pre?.liqGrid ?? null;
    this.topo = pre?.topo ?? extractTopology(this.th, this.sol ? Math.min(gridN, 120) : gridN);
    const ns = this.solids.length;
    for (let a = 0; a < ns; a++)
      for (let b = a + 1; b < ns; b++)
        for (let c = b + 1; c < ns; c++) {
          const [p, q, r] = [this.solids[a].n, this.solids[b].n, this.solids[c].n];
          const det = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
          if (Math.abs(det) > 1e-9 && !this.sol) this.triples.push([a, b, c]);
        }
    for (const cv of this.topo.curves) {
      const k = `${cv.a}-${cv.b}`;
      if (!this.pairCurves.has(k)) this.pairCurves.set(k, []);
      this.pairCurves.get(k)!.push(cv);
    }
    // 化合物说明文字
    for (const ci of this.topo.compounds) {
      const s = this.solids[ci.si];
      const cel = (K: number) => `${(K - 273.15).toFixed(0)} °C`;
      if (ci.congruent) ci.text = `${s.label}（${s.formula}）为一致熔融（稳定）化合物，熔点 ${cel(ci.Tdecomp ?? ci.Thyp)}。`;
      else {
        const dec = this.topo.invariants.find(
          (iv) => ci.Tdecomp !== null && Math.abs(iv.T - ci.Tdecomp) < 1e-6 && iv.solids.includes(ci.si),
        );
        ci.text =
          `${s.label}（${s.formula}）为不一致熔融（不稳定）化合物：成分点落在 ${this.solids[ci.liqSi].label} 的初晶区内，` +
          `其假想熔点 ${cel(ci.Thyp)} 低于该处实际液相线 ${cel(ci.Tliq)}。` +
          (dec ? `加热至 ${cel(dec.T)} 时按 ${dec.reaction.text.split('⇌').reverse().map((t) => t.trim()).join(' ⇌ ')} 分解。` : '');
      }
    }
  }

  private liqGridPre: Float32Array | null = null;

  /**
   * 液相面网格：顶点按 i 行（含 N−i+1 个）排列，每顶点 8 个槽 = 各固相饱和温度 Tsat（不足 8 个补 0）。
   * 固溶体体系的 Tsat 代价很高（argmax 迭代），故在 Worker 中预先算好；否则惰性计算。
   */
  liquidusGrid(): Float32Array {
    if (this.liqGridPre) return this.liqGridPre;
    const N = LIQ_GRID_N;
    const nv = ((N + 1) * (N + 2)) / 2;
    const out = new Float32Array(nv * 8);
    let v = 0;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N - i; j++, v++) {
        const x: Comp = [i / N, j / N, (N - i - j) / N];
        for (let s = 0; s < Math.min(8, this.ns); s++) out[v * 8 + s] = this.th.Tsat(s, x);
      }
    return (this.liqGridPre = out);
  }

  /**
   * 液相线温度与初晶相的网格插值近似（仅用于绘图：逐像素取样的底图、标注定位等）。
   * 在液相面网格上对各固相的 Tsat 做三角形线性插值再取最大，保留相区交界处的折角。
   */
  liquidusFast(x: Comp): { T: number; si: number } {
    const N = LIQ_GRID_N;
    const g = this.liquidusGrid();
    const ns = Math.min(8, this.ns);
    const fx = x[0] * N;
    const fy = x[1] * N;
    const i = Math.max(0, Math.min(N - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(N - 1 - i, Math.floor(fy)));
    const u = fx - i;
    const v = fy - j;
    const row = (a: number) => a * (N + 1) - (a * (a - 1)) / 2;
    const at = (a: number, b: number) => (row(a) + b) * 8;
    let v0: number, v1: number, v2: number, w0: number, w1: number, w2: number;
    if (u + v <= 1) {
      v0 = at(i, j); v1 = at(i + 1, j); v2 = at(i, j + 1);
      w0 = 1 - u - v; w1 = u; w2 = v;
    } else {
      v0 = at(i + 1, j); v1 = at(i, j + 1); v2 = at(i + 1, j + 1);
      w0 = 1 - v; w1 = 1 - u; w2 = u + v - 1;
    }
    let best = -1;
    let T = -Infinity;
    for (let s = 0; s < ns; s++) {
      const t = w0 * g[v0 + s] + w1 * g[v1 + s] + w2 * g[v2 + s];
      if (t > T) {
        T = t;
        best = s;
      }
    }
    return { T, si: best };
  }

  get ns(): number {
    return this.solids.length;
  }

  /** 全局温度范围 / K，用于三维温度轴 */
  tRange(): { Tmin: number; Tmax: number } {
    let hi = 0;
    for (const f of this.topo.fields) hi = Math.max(hi, f.Tmax);
    for (const c of this.params.components) hi = Math.max(hi, c.Tm);
    let lo = Infinity;
    for (const iv of this.topo.invariants) lo = Math.min(lo, iv.T);
    if (!isFinite(lo)) lo = hi * 0.5;
    const top = Math.ceil((hi + 40) / 100) * 100;
    const bot = Math.max(273.15, Math.floor((lo - 160) / 100) * 100);
    return { Tmin: Math.min(bot, lo - 100), Tmax: top };
  }

  liquidus(x: Comp) {
    return this.th.liquidus(x);
  }

  /** 单变线上温度为 T 的液相成分（可能多个分支） */
  univariantAt(a: number, b: number, T: number): Comp[] {
    if (T !== this.uniCacheT) {
      this.uniCache.clear();
      this.uniCacheT = T;
    }
    const key = `${a}-${b}`;
    const hit = this.uniCache.get(key);
    if (hit) return hit;
    const out: Comp[] = [];
    const curves = this.pairCurves.get(key) ?? [];
    for (const cv of curves) {
      for (let k = 0; k < cv.pts.length - 1; k++) {
        const t0 = cv.T[k] - T;
        const t1 = cv.T[k + 1] - T;
        if (t0 * t1 > 0 || (t0 === 0 && t1 === 0)) continue;
        const f = t0 === t1 ? 0 : t0 / (t0 - t1);
        const p = cv.pts[k];
        const q = cv.pts[k + 1];
        const x0: Comp = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
        const x = this.refineUni(a, b, x0, T);
        if (!out.some((y) => Math.hypot(y[0] - x[0], y[1] - x[1], y[2] - x[2]) < 1e-7)) out.push(x);
      }
    }
    this.uniCache.set(key, out);
    return out;
  }

  /** refineUni 的统计：调用次数、总迭代数、回退到初值的次数（测试用） */
  readonly refineStats = { calls: 0, iters: 0, fallbacks: 0 };

  /** 单变线点：解 T_a(x) = T_b(x) = T（解析 Jacobian 的牛顿法，二次收敛） */
  private refineUni(a: number, b: number, x0: Comp, T: number): Comp {
    const st = this.refineStats;
    st.calls++;
    let y1 = x0[1];
    let y2 = x0[2];
    const th = this.th;
    for (let it = 0; it < 20; it++) {
      const x: Comp = [1 - y1 - y2, y1, y2];
      const ga = th.gradTsat(a, x);
      const gb = th.gradTsat(b, x);
      if (!ga || !gb) break;
      const f0 = th.Tsat(a, x) - T;
      const f1 = th.Tsat(b, x) - T;
      if (Math.abs(f0) + Math.abs(f1) < 1e-9) {
        st.iters += it;
        return x;
      }
      // x = [1−u−v, u, v]：∂/∂u = g₁ − g₀，∂/∂v = g₂ − g₀
      const j11 = ga[1] - ga[0];
      const j12 = ga[2] - ga[0];
      const j21 = gb[1] - gb[0];
      const j22 = gb[2] - gb[0];
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) break;
      const d1 = (f0 * j22 - f1 * j12) / det;
      const d2 = (j11 * f1 - j21 * f0) / det;
      const ny1 = y1 - d1;
      const ny2 = y2 - d2;
      if (ny1 < 0 || ny2 < 0 || ny1 + ny2 > 1 || Math.abs(d1) + Math.abs(d2) > 0.1) break;
      y1 = ny1;
      y2 = ny2;
    }
    st.fallbacks++;
    return x0;
  }

  /** 液相 + 单固相：沿固相→x0 的射线求饱和液相，返回液相成分，失败返回 null */
  private rayLiquid(si: number, x0: Comp, T: number): Comp | null {
    const xs = this.solids[si].n;
    const dx: Comp = [x0[0] - xs[0], x0[1] - xs[1], x0[2] - xs[2]];
    if (Math.abs(dx[0]) + Math.abs(dx[1]) + Math.abs(dx[2]) < 1e-12) return null;
    if (this.th.Tsat(si, x0) <= T) return null;
    let lmax = Infinity;
    for (let i = 0; i < 3; i++) if (dx[i] < 0) lmax = Math.min(lmax, -xs[i] / dx[i]);
    if (!isFinite(lmax)) return null;
    let lo = 1;
    let hi = lmax * (1 - 1e-13);
    const at = (l: number): Comp => [xs[0] + l * dx[0], xs[1] + l * dx[1], xs[2] + l * dx[2]];
    if (this.th.Tsat(si, at(hi)) > T) return null;
    for (let it = 0; it < 52; it++) {
      const mid = 0.5 * (lo + hi);
      if (this.th.Tsat(si, at(mid)) > T) lo = mid;
      else hi = mid;
    }
    return at(0.5 * (lo + hi));
  }

  /** 平衡态。hint：相邻状态的平衡（仅固溶体求解器使用，用于热启动） */
  equilibrium(x0: Comp, T: number, hint?: Equilibrium | null): Equilibrium {
    if (this.sol) return this.sol.equilibrium(x0, T, hint);
    const th = this.th;
    const liq = th.liquidus(x0).T;
    const mk = (phases: PhaseAmount[], G: number): Equilibrium => {
      phases = phases.filter((p) => p.frac > 1e-12);
      const sum = phases.reduce((s, p) => s + p.frac, 0);
      phases.forEach((p) => (p.frac /= sum));
      phases.sort((p, q) => p.si - q.si);
      return { phases, key: phases.map((p) => p.id).join('+'), G };
    };
    if (T >= liq) return mk([{ si: -1, id: 'L', frac: 1, x: x0 }], th.Gliq(x0, T));

    let best: Equilibrium | null = null;
    const consider = (phases: PhaseAmount[], G: number) => {
      if (!best || G < best.G - 1e-9) best = mk(phases, G);
    };
    const ns = this.ns;
    const solidPhase = (si: number, frac: number): PhaseAmount => ({
      si,
      id: this.solids[si].id,
      frac,
      x: this.solids[si].n,
    });
    // 液相 + 1 固相
    for (let s = 0; s < ns; s++) {
      const xl = this.rayLiquid(s, x0, T);
      if (!xl) continue;
      const xs = this.solids[s].n;
      let lam = 1;
      for (let i = 0; i < 3; i++) {
        const d = x0[i] - xs[i];
        if (Math.abs(d) > 1e-12) {
          lam = (xl[i] - xs[i]) / d;
          break;
        }
      }
      const fl = 1 / lam;
      const G = fl * th.Gliq(xl, T) + (1 - fl) * th.Gsol(s, T);
      consider([{ si: -1, id: 'L', frac: fl, x: xl }, solidPhase(s, 1 - fl)], G);
    }
    // 液相 + 2 固相
    for (let a = 0; a < ns; a++) {
      for (let b = a + 1; b < ns; b++) {
        const xls = this.univariantAt(a, b, T);
        for (const xl of xls) {
          const w = triBary(x0, xl, this.solids[a].n, this.solids[b].n);
          if (!(w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9)) continue;
          const G = w[0] * th.Gliq(xl, T) + w[1] * th.Gsol(a, T) + w[2] * th.Gsol(b, T);
          consider([{ si: -1, id: 'L', frac: Math.max(0, w[0]), x: xl }, solidPhase(a, Math.max(0, w[1])), solidPhase(b, Math.max(0, w[2]))], G);
        }
      }
    }
    // 三固相
    for (const [a, b, c] of this.triples) {
      const w = triBary(x0, this.solids[a].n, this.solids[b].n, this.solids[c].n);
      if (!(w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9)) continue;
      const G = w[0] * th.Gsol(a, T) + w[1] * th.Gsol(b, T) + w[2] * th.Gsol(c, T);
      consider([solidPhase(a, Math.max(0, w[0])), solidPhase(b, Math.max(0, w[1])), solidPhase(c, Math.max(0, w[2]))], G);
    }
    if (!best) return mk([{ si: -1, id: 'L', frac: 1, x: x0 }], th.Gliq(x0, T));
    return best;
  }

  /** 固相相容三角形（下凸包刻面）。T 缺省取最低不变点以下。 */
  facets(T?: number): Tri[] {
    if (this.sol) return [];
    const Tq = T ?? this.subsolidusT();
    const out: Tri[] = [];
    for (const t of this.triples) {
      const [a, b, c] = t;
      const pa = this.solids[a].n;
      const pb = this.solids[b].n;
      const pc = this.solids[c].n;
      const ga = this.th.Gsol(a, Tq);
      const gb = this.th.Gsol(b, Tq);
      const gc = this.th.Gsol(c, Tq);
      let ok = true;
      for (let s = 0; s < this.ns && ok; s++) {
        if (s === a || s === b || s === c) continue;
        const w = triBary(this.solids[s].n, pa, pb, pc);
        // 在三角形平面之下 => 该刻面不是下凸包
        if (w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9) {
          const gp = w[0] * ga + w[1] * gb + w[2] * gc;
          if (this.th.Gsol(s, Tq) < gp - 1e-7) ok = false;
        } else {
          // 不在三角形内：需检查其三角形外的点是否使平面不是支撑平面
          const gp = this.planeG(pa, pb, pc, ga, gb, gc, this.solids[s].n);
          if (this.th.Gsol(s, Tq) < gp - 1e-7) ok = false;
        }
      }
      if (ok) out.push(t);
    }
    return out;
  }

  private planeG(pa: Comp, pb: Comp, pc: Comp, ga: number, gb: number, gc: number, x: Comp): number {
    const w = triBary(x, pa, pb, pc);
    return w[0] * ga + w[1] * gb + w[2] * gc;
  }

  /** 低于所有液相不变点的参考温度，用于固相相容三角形 */
  subsolidusT(): number {
    let lo = Infinity;
    for (const iv of this.topo.invariants) lo = Math.min(lo, iv.T);
    return isFinite(lo) ? lo - 60 : 400;
  }

  /** 给定温度下是否为稳定的纯固相连结三角形 */
  solidFacetsAt(T: number): Tri[] {
    return this.facets(T).filter((t) => this.th.facetStable(t, T));
  }
}
