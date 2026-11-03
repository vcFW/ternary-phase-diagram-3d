import { inTriangle, lerpComp, others, triBary, vertex, VERTICES } from './barycentric';
import { createRegularSolutionLiquidus, type LiquidusModel } from './liquidusModel';
import type { PhaseDataProvider } from './provider';
import type {
  Comp,
  CompIndex,
  EquilibriumState,
  ModelParams,
  MonovariantLine,
  MonovariantSample,
  RegionKey,
  SpecialPoint,
  SystemMeta,
} from './types';

/**
 * 简单三元共晶体系（固相互不溶、液相完全互溶）的完整几何与平衡计算。
 *
 * 拓扑结构：
 *   - 三个初晶面（液相面分片）T_i(x)，交线为三条单变线（共晶谷线）；
 *   - 单变线起于二元共晶点 E_ij，止于三元共晶点 E（四相平衡 L ⇌ A + B + C）；
 *   - 液相面以下：L+i 两相区、L+i+j 三相区（由直纹面界定）、A+B+C 三固相区；
 *   - 三相区在温度 T 的截面是连结三角形 (e_i, e_j, m_ij(T))，其中 m_ij(T) 为单变线上温度为 T 的点。
 *
 * 全部视图（三维曲面、截面、投影、冷却模拟）都从本类的同一组函数派生，保证数学一致性。
 */

export const PAIRS: [CompIndex, CompIndex][] = [
  [0, 1],
  [1, 2],
  [0, 2],
];

export function pairId(i: CompIndex, j: CompIndex): string {
  return i < j ? `${i}${j}` : `${j}${i}`;
}

export function thirdOf(i: CompIndex, j: CompIndex): CompIndex {
  return (3 - i - j) as CompIndex;
}

export function regionKeyL(): RegionKey {
  return 'L';
}
export function regionKey1(i: CompIndex): RegionKey {
  return `L+${i}`;
}
export function regionKey2(i: CompIndex, j: CompIndex): RegionKey {
  return i < j ? `L+${i}+${j}` : `L+${j}+${i}`;
}
export const REGION_SOLID: RegionKey = 'S';

export const ALL_REGIONS: RegionKey[] = ['L', 'L+0', 'L+1', 'L+2', 'L+0+1', 'L+1+2', 'L+0+2', 'S'];

export function parseRegion(key: RegionKey): { liquid: boolean; solids: CompIndex[] } {
  if (key === 'S') return { liquid: false, solids: [0, 1, 2] };
  const parts = key.split('+');
  return { liquid: true, solids: parts.slice(1).map((s) => Number(s) as CompIndex) };
}

function bisect(f: (t: number) => number, a: number, b: number, iters = 64): number {
  let fa = f(a);
  for (let n = 0; n < iters; n++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

const EPS = 1e-12;
const MONO_SAMPLES = 480;

export interface IsothermCurve {
  /** 初晶相 */
  i: CompIndex;
  /** 自 k 侧（φ=1）到 j 侧（φ=0）的有序点 */
  points: Comp[];
  /** 端点是否落在单变线上 */
  endJ: 'edge' | 'mono';
  endK: 'edge' | 'mono';
}

export interface IsothermalSection {
  T: number;
  regions: { key: RegionKey; polygon: Comp[] }[];
  isotherms: IsothermCurve[];
  /** 三相区连结三角形 */
  triangles: { i: CompIndex; j: CompIndex; m: Comp }[];
  /** 是否恰处于四相平衡温度 */
  invariant: boolean;
}

export class TernaryEutecticDiagram implements PhaseDataProvider {
  readonly meta: SystemMeta;
  readonly params: ModelParams;
  readonly model: LiquidusModel;
  readonly binary: Record<string, { comp: Comp; T: number; i: CompIndex; j: CompIndex }>;
  readonly eutectic: { comp: Comp; T: number };
  readonly mono: Record<string, MonovariantLine>;
  readonly specialPoints: SpecialPoint[];
  /** 显示温度范围 / K */
  readonly tRange: [number, number];

  constructor(meta: SystemMeta, params: ModelParams) {
    this.meta = meta;
    this.params = params;
    this.model = createRegularSolutionLiquidus(params);

    // ---- 二元共晶点（单变线在边上的端点，c = 0） ----
    this.binary = {};
    for (const [i, j] of PAIRS) {
      const y = this.solveMonoPoint(i, j, 0);
      this.binary[pairId(i, j)] = { comp: y, T: this.model.Ti(i, y), i, j };
    }

    // ---- 三元共晶点：沿单变线 AB 搜索使 T_C = T_A 的 c ----
    {
      const [i, j] = PAIRS[0];
      const k = thirdOf(i, j);
      const cE = bisect(
        (c) => {
          const y = this.solveMonoPoint(i, j, c);
          return this.model.Ti(k, y) - this.model.Ti(i, y);
        },
        EPS,
        1 - 1e-9,
        80,
      );
      const y = this.solveMonoPoint(i, j, cE);
      this.eutectic = { comp: y, T: this.model.Ti(i, y) };
    }

    // ---- 三条单变线，按 c ∈ [0, c_E] 采样（c 为第三组元含量） ----
    this.mono = {};
    for (const [i, j] of PAIRS) {
      const k = thirdOf(i, j);
      const cE = this.eutectic.comp[k];
      const samples: MonovariantSample[] = [];
      for (let n = 0; n <= MONO_SAMPLES; n++) {
        // 余弦分布：靠近两端点加密
        const s = n / MONO_SAMPLES;
        const c = n === MONO_SAMPLES ? cE : cE * (0.5 - 0.5 * Math.cos(Math.PI * s));
        const y = n === MONO_SAMPLES ? ([...this.eutectic.comp] as Comp) : this.solveMonoPoint(i, j, c);
        const T = n === MONO_SAMPLES ? this.eutectic.T : this.model.Ti(i, y);
        samples.push({ c, y, T });
      }
      const id = pairId(i, j);
      this.mono[id] = { id, i, j, k, samples };
    }

    const sym = params.components.map((c) => c.symbol);
    this.specialPoints = [
      ...([0, 1, 2] as CompIndex[]).map<SpecialPoint>((i) => ({
        id: `pt:M${i}`,
        kind: 'melting',
        label: `T_m(${sym[i]})`,
        comp: vertex(i),
        T: params.components[i].Tm,
        members: [i],
      })),
      ...PAIRS.map<SpecialPoint>(([i, j]) => {
        const b = this.binary[pairId(i, j)];
        return {
          id: `pt:E${pairId(i, j)}`,
          kind: 'binaryEutectic',
          label: `E_${sym[i]}${sym[j]}`,
          comp: b.comp,
          T: b.T,
          members: [i, j],
        };
      }),
      {
        id: 'pt:E',
        kind: 'ternaryEutectic',
        label: 'E',
        comp: this.eutectic.comp,
        T: this.eutectic.T,
        members: [0, 1, 2],
      },
    ];

    const tMaxC = Math.max(...params.components.map((c) => c.Tm)) - 273.15;
    const tMinC = this.eutectic.T - 273.15;
    this.tRange = [Math.floor((tMinC - 120) / 100) * 100 + 273.15, Math.ceil((tMaxC + 60) / 100) * 100 + 273.15];
  }

  // ------------------------------------------------------------------
  // 基础函数
  // ------------------------------------------------------------------

  Ti(i: CompIndex, x: Comp): number {
    return this.model.Ti(i, x);
  }

  /** 液相面温度与初晶相 */
  liquidus(x: Comp): { T: number; primary: CompIndex } {
    let best: CompIndex = 0;
    let bestT = -1;
    for (let i = 0 as CompIndex; i < 3; i = (i + 1) as CompIndex) {
      const t = this.model.Ti(i, x);
      if (t > bestT) {
        bestT = t;
        best = i;
      }
    }
    return { T: bestT, primary: best };
  }

  /** 单变线 i–j 上第三组元含量为 c 的点：求 y_i 使 T_i(y) = T_j(y)。 */
  solveMonoPoint(i: CompIndex, j: CompIndex, c: number): Comp {
    const k = thirdOf(i, j);
    const rest = 1 - c;
    const mk = (yi: number): Comp => {
      const y: Comp = [0, 0, 0];
      y[i] = yi;
      y[j] = rest - yi;
      y[k] = c;
      return y;
    };
    const yi = bisect((t) => {
      const y = mk(t);
      return this.model.Ti(i, y) - this.model.Ti(j, y);
    }, rest * 1e-12, rest * (1 - 1e-12));
    return mk(yi);
  }

  binaryT(i: CompIndex, j: CompIndex): number {
    return this.binary[pairId(i, j)].T;
  }

  /** 单变线 i–j 上温度为 T 的液相成分（T_E ≤ T ≤ T_ij），否则返回 null。 */
  monoAt(i: CompIndex, j: CompIndex, T: number): Comp | null {
    const line = this.mono[pairId(i, j)];
    const s = line.samples;
    if (T > s[0].T + 1e-9 || T < s[s.length - 1].T - 1e-9) return null;
    // T 沿采样单调递减 → 二分查找
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].T >= T) lo = mid;
      else hi = mid;
    }
    const a = s[lo];
    const b = s[hi];
    const t = a.T === b.T ? 0 : (a.T - T) / (a.T - b.T);
    return lerpComp(a.y, b.y, Math.min(1, Math.max(0, t)));
  }

  /** 由初晶顶点 i 出发、指向对边点 Q(φ) = (1−φ)e_j + φe_k 的射线上的点 */
  rayPoint(i: CompIndex, phi: number, r: number): Comp {
    const [j, k] = others(i);
    const x: Comp = [0, 0, 0];
    x[i] = 1 - r;
    x[j] = r * (1 - phi);
    x[k] = r * phi;
    return x;
  }

  /** 成分 x 相对于顶点 i 的射线参数 (φ, r) */
  rayParams(i: CompIndex, x: Comp): { phi: number; r: number } {
    const [j, k] = others(i);
    const r = 1 - x[i];
    const s = x[j] + x[k];
    return { phi: s > 0 ? x[k] / s : 0.5, r };
  }

  /** 初晶区 i 沿射线 φ 的边界半径（与单变线的交点） */
  fieldBoundaryR(i: CompIndex, phi: number): number {
    const [j, k] = others(i);
    return bisect(
      (r) => {
        const x = this.rayPoint(i, phi, r);
        return this.model.Ti(i, x) - Math.max(this.model.Ti(j, x), this.model.Ti(k, x));
      },
      0,
      1,
      60,
    );
  }

  /** 沿射线 φ 求 T_i = T 的半径（T_i 沿射线单调递减） */
  isothermR(i: CompIndex, phi: number, T: number): number {
    return bisect((r) => this.model.Ti(i, this.rayPoint(i, phi, r)) - T, 0, 1, 60);
  }

  /** 三元共晶点在初晶区 i 射线参数中的 φ */
  phiOfEutectic(i: CompIndex): number {
    return this.rayParams(i, this.eutectic.comp).phi;
  }

  // ------------------------------------------------------------------
  // 相区判定与平衡计算
  // ------------------------------------------------------------------

  classify(x: Comp, T: number, L: { T: number; primary: CompIndex } = this.liquidus(x)): RegionKey {
    if (T >= L.T) return 'L';
    if (T < this.eutectic.T) return REGION_SOLID;
    for (const [i, j] of PAIRS) {
      if (T >= this.binaryT(i, j)) continue;
      const m = this.monoAt(i, j, T);
      if (!m) continue;
      const b = triBary(x, VERTICES[i], VERTICES[j], m);
      if (b[0] >= -1e-10 && b[1] >= -1e-10 && b[2] >= -1e-10) return regionKey2(i, j);
    }
    return regionKey1(L.primary);
  }

  equilibrium(x: Comp, T: number): EquilibriumState {
    const region = this.classify(x, T);
    if (region === 'L') {
      return { region, phases: [{ phase: 'L', fraction: 1, comp: [...x] as Comp }], liquid: [...x] as Comp, dof: 3 };
    }
    if (region === REGION_SOLID) {
      return {
        region,
        phases: ([0, 1, 2] as CompIndex[]).map((i) => ({ phase: i, fraction: x[i], comp: vertex(i) })),
        liquid: null,
        dof: 1,
      };
    }
    const { solids } = parseRegion(region);
    if (solids.length === 1) {
      const i = solids[0];
      const y = this.liquidOnRay(i, x, T);
      // 杠杆规则：x = f_L·y + (1 − f_L)·e_i
      const fL = (1 - x[i]) / Math.max(EPS, 1 - y[i]);
      return {
        region,
        phases: [
          { phase: 'L', fraction: fL, comp: y },
          { phase: i, fraction: 1 - fL, comp: vertex(i) },
        ],
        liquid: y,
        dof: 2,
      };
    }
    const [i, j] = solids;
    const m = this.monoAt(i, j, T)!;
    const b = triBary(x, VERTICES[i], VERTICES[j], m);
    return {
      region,
      phases: [
        { phase: 'L', fraction: Math.max(0, b[2]), comp: m },
        { phase: i, fraction: Math.max(0, b[0]), comp: vertex(i) },
        { phase: j, fraction: Math.max(0, b[1]), comp: vertex(j) },
      ],
      liquid: m,
      dof: 1,
    };
  }

  /** 两相区 L + i 中的液相成分：沿 e_i → x 的延长线求 T_i(y) = T */
  liquidOnRay(i: CompIndex, x: Comp, T: number): Comp {
    const ei = VERTICES[i];
    const lo = Math.max(EPS, 1 - x[i]);
    const mk = (s: number): Comp => [
      ei[0] + (x[0] - ei[0]) / s,
      ei[1] + (x[1] - ei[1]) / s,
      ei[2] + (x[2] - ei[2]) / s,
    ];
    const s = bisect((t) => this.model.Ti(i, mk(t)) - T, lo * (1 + 1e-12), 1, 64);
    return mk(s);
  }

  /** 冷却时液相成分到达单变线的位置（初晶析出阶段终点） */
  primaryPathEnd(x: Comp): { y: Comp; T: number; primary: CompIndex; partner: CompIndex } {
    const { primary: i } = this.liquidus(x);
    const { phi } = this.rayParams(i, x);
    const rb = this.fieldBoundaryR(i, phi);
    const y = this.rayPoint(i, phi, rb);
    const [j, k] = others(i);
    const partner = this.model.Ti(j, y) >= this.model.Ti(k, y) ? j : k;
    return { y, T: this.model.Ti(i, y), primary: i, partner };
  }

  // ------------------------------------------------------------------
  // 等温截面（精确多边形）
  // ------------------------------------------------------------------

  isotherm(i: CompIndex, T: number, n = 72): IsothermCurve | null {
    const Tm = this.params.components[i].Tm;
    if (T >= Tm || T <= this.eutectic.T) return null;
    const [j, k] = others(i);
    const mj = T < this.binaryT(i, j) ? this.monoAt(i, j, T) : null;
    const mk = T < this.binaryT(i, k) ? this.monoAt(i, k, T) : null;
    const phiJ = mj ? this.rayParams(i, mj).phi : 0;
    const phiK = mk ? this.rayParams(i, mk).phi : 1;
    const points: Comp[] = [];
    for (let s = 0; s <= n; s++) {
      const phi = phiK + (phiJ - phiK) * (s / n);
      if (s === 0 && mk) points.push(mk);
      else if (s === n && mj) points.push(mj);
      else points.push(this.rayPoint(i, phi, this.isothermR(i, phi, T)));
    }
    return { i, points, endJ: mj ? 'mono' : 'edge', endK: mk ? 'mono' : 'edge' };
  }

  isothermalSection(T: number): IsothermalSection {
    const TE = this.eutectic.T;
    if (T < TE - 1e-6) {
      return { T, regions: [{ key: 'S', polygon: [...VERTICES] }], isotherms: [], triangles: [], invariant: false };
    }
    if (Math.abs(T - TE) <= 1e-6) {
      const triangles = PAIRS.map(([i, j]) => ({ i, j, m: this.eutectic.comp }));
      return {
        T,
        regions: PAIRS.map(([i, j]) => ({ key: regionKey2(i, j), polygon: [VERTICES[i], VERTICES[j], this.eutectic.comp] })),
        isotherms: [],
        triangles,
        invariant: true,
      };
    }
    const isotherms: IsothermCurve[] = [];
    const regions: { key: RegionKey; polygon: Comp[] }[] = [];
    const Lpoly: Comp[] = [];
    for (const i of [0, 1, 2] as CompIndex[]) {
      const c = this.isotherm(i, T);
      if (c) {
        isotherms.push(c);
        regions.push({ key: regionKey1(i), polygon: [VERTICES[i], ...c.points] });
        for (const p of c.points) Lpoly.push(p);
      } else {
        Lpoly.push(VERTICES[i]);
      }
    }
    // 液相区多边形：按 A→B→C 逆时针拼接各等温线（k 侧 → j 侧）
    regions.unshift({ key: 'L', polygon: dedupe(Lpoly) });
    const triangles: { i: CompIndex; j: CompIndex; m: Comp }[] = [];
    for (const [i, j] of PAIRS) {
      if (T < this.binaryT(i, j)) {
        const m = this.monoAt(i, j, T)!;
        triangles.push({ i, j, m });
        regions.push({ key: regionKey2(i, j), polygon: [VERTICES[i], VERTICES[j], m] });
      }
    }
    return { T, regions, isotherms, triangles, invariant: false };
  }

  /** 初晶区 i 的投影多边形：e_i → E_ij → (单变线) → E → (单变线) → E_ik */
  primaryFieldPolygon(i: CompIndex): Comp[] {
    const [j, k] = others(i);
    const lj = this.mono[pairId(i, j)].samples.map((s) => s.y);
    const lk = this.mono[pairId(i, k)].samples.map((s) => s.y);
    return [VERTICES[i], ...lj, ...lk.slice(0, -1).reverse()];
  }

  /** 校验模型拓扑（用于参数编辑） */
  validate(): string[] {
    const w: string[] = [];
    const TE = this.eutectic.T;
    for (const [i, j] of PAIRS) {
      if (this.binaryT(i, j) <= TE + 1) w.push(`二元共晶温度 E_${i}${j} 不高于三元共晶温度`);
      const s = this.mono[pairId(i, j)].samples;
      for (let n = 1; n < s.length; n++) {
        if (s[n].T > s[n - 1].T + 1e-6) {
          w.push(`单变线 ${i}${j} 温度不单调，模型参数不满足简单共晶拓扑`);
          break;
        }
      }
    }
    if (!inTriangle(this.eutectic.comp, 1e-6)) w.push('三元共晶点不在成分三角形内');
    const Tk = ([0, 1, 2] as CompIndex[]).map((i) => this.model.Ti(i, this.eutectic.comp));
    if (Math.max(...Tk) - Math.min(...Tk) > 0.5) w.push('三元共晶点求解未收敛');
    if (TE < 200) w.push('三元共晶温度过低，参数可能不合理');
    // 相区判定依赖"初晶区相对其顶点为星形"：沿每条射线 T_i − max(T_j, T_k) 只变号一次
    outer: for (const i of [0, 1, 2] as CompIndex[]) {
      const [j, k] = others(i);
      for (let n = 0; n <= 16; n++) {
        let changes = 0;
        let prev = 1;
        for (let m = 0; m <= 160; m++) {
          const x = this.rayPoint(i, n / 16, m / 160);
          const sg = Math.sign(this.model.Ti(i, x) - Math.max(this.model.Ti(j, x), this.model.Ti(k, x)));
          if (sg !== 0 && sg !== prev) {
            changes++;
            prev = sg;
          }
        }
        if (changes !== 1) {
          w.push(`初晶区 ${this.params.components[i].symbol} 形状不满足简单共晶拓扑（可能存在液相分层倾向），请减小 Ω`);
          break outer;
        }
      }
    }
    return w;
  }
}

function dedupe(pts: Comp[]): Comp[] {
  const out: Comp[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-12 && Math.abs(q[1] - p[1]) < 1e-12) continue;
    out.push(p);
  }
  return out;
}
