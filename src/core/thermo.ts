import type { Comp, Solid, SystemParams } from './types';

/**
 * 热力学模型：液相为三元正规溶液，固相为化学计量相（互不溶）。
 * 能量基准：纯固相组元的吉布斯能 / 焓为 0，所有量按"每摩尔原子（单元）"计。
 *
 *   G_L(x,T) = Σ xᵢ ΔHᵢ (1 − T/Tmᵢ) + R T Σ xᵢ ln xᵢ + G_ex,   G_ex = Σ_{i<j} Ωᵢⱼ xᵢ xⱼ
 *   G_s(T)   = ΔHf − T ΔSf                       （化合物，纯组元为 0）
 *
 * 液相与化学计量固相 s（组成 n）饱和的条件是 Σ nᵢ μᵢᴸ = G_s，整理得闭式解
 *
 *   T_s(x) = (Hs + Σ nᵢ μᵢᴱˣ) / (Ss − R Σ nᵢ ln xᵢ)
 *   Hs = Σ nᵢΔHᵢ − ΔHf,     Ss = Σ nᵢΔHᵢ/Tmᵢ − ΔSf
 *
 * 并且 T < T_s(x) ⇔ 液相对 s 过饱和（s 可析出）。整个相图拓扑均由此推出。
 */
export const R = 8.314462618;

export class Thermo {
  readonly p: SystemParams;
  readonly solids: Solid[];
  private om: [number, number, number]; // Ω_AB, Ω_AC, Ω_BC
  private hasOmega: boolean;

  constructor(p: SystemParams) {
    this.p = p;
    this.om = [p.omega.AB, p.omega.AC, p.omega.BC];
    this.hasOmega = this.om.some((v) => v !== 0);
    const c = p.components;
    const solids: Solid[] = [];
    if (p.solutions?.length) {
      // 固溶体取代纯组元固相
      p.solutions.forEach((sd, k) => {
        solids.push({
          index: k,
          id: sd.id,
          label: sd.label,
          formula: sd.formula,
          n: sd.n,
          kind: 'solution',
          sol: {
            a: [sd.g0[0][0], sd.g0[1][0], sd.g0[2][0]],
            b: [sd.g0[0][1], sd.g0[1][1], sd.g0[2][1]],
            om: [sd.omega.AB, sd.omega.AC, sd.omega.BC],
          },
          dHf: 0,
          dSf: 0,
          Hs: 0,
          Ss: 0,
        });
      });
    } else
      c.forEach((cc, i) => {
        const n: Comp = [0, 0, 0];
        n[i] = 1;
        solids.push({ index: i, id: cc.symbol, label: cc.symbol, formula: cc.symbol, n, kind: 'element', dHf: 0, dSf: 0, Hs: cc.dH, Ss: cc.dH / cc.Tm });
      });
    p.compounds.forEach((cd) => {
      const nz = cd.n.filter((v) => v > 1e-9).length;
      let H = -cd.dHf;
      let S = -cd.dSf;
      for (let i = 0; i < 3; i++) {
        H += cd.n[i] * c[i].dH;
        S += (cd.n[i] * c[i].dH) / c[i].Tm;
      }
      solids.push({
        index: solids.length,
        id: cd.id,
        label: cd.label,
        formula: cd.formula,
        n: cd.n,
        kind: nz === 2 ? 'binary' : 'ternary',
        dHf: cd.dHf,
        dSf: cd.dSf,
        Hs: H,
        Ss: S,
      });
    });
    this.solids = solids;
    this.hasSolution = solids.some((q) => q.sol);
  }

  /** 体系中是否含固溶体相（决定使用哪一套平衡求解器） */
  readonly hasSolution: boolean = false;

  /** 过剩吉布斯能 / 过剩焓（正规溶液，S_ex = 0） */
  gex(x: Comp): number {
    if (!this.hasOmega) return 0;
    return this.om[0] * x[0] * x[1] + this.om[1] * x[0] * x[2] + this.om[2] * x[1] * x[2];
  }

  /** 过剩化学势 μᵢᴱˣ = Σ_{j≠i} Ωᵢⱼ xⱼ − G_ex */
  muEx(x: Comp): Comp {
    if (!this.hasOmega) return [0, 0, 0];
    const g = this.gex(x);
    const [oab, oac, obc] = this.om;
    return [oab * x[1] + oac * x[2] - g, oab * x[0] + obc * x[2] - g, oac * x[0] + obc * x[1] - g];
  }

  /** 固相 si 的液相线（饱和）温度 / K，成分 x 处 */
  Tsat(si: number, x: Comp): number {
    const s = this.solids[si];
    if (s.sol) return this.solTsat(si, x);
    const n = s.n;
    let num = s.Hs;
    if (this.hasOmega) {
      const mu = this.muEx(x);
      num += n[0] * mu[0] + n[1] * mu[1] + n[2] * mu[2];
    }
    let lnx = 0;
    for (let i = 0; i < 3; i++) {
      if (n[i] > 0) {
        if (x[i] <= 1e-300) return 0;
        lnx += n[i] * Math.log(x[i]);
      }
    }
    const den = s.Ss - R * lnx;
    if (den <= 0 || num <= 0) return 0;
    return num / den;
  }

  /** 液相吉布斯能 / (J·mol⁻¹) */
  Gliq(x: Comp, T: number): number {
    const c = this.p.components;
    let g = 0;
    for (let i = 0; i < 3; i++) {
      const xi = x[i];
      g += xi * c[i].dH * (1 - T / c[i].Tm);
      if (xi > 1e-300) g += R * T * xi * Math.log(xi);
    }
    return g + this.gex(x);
  }

  Gsol(si: number, T: number): number {
    const s = this.solids[si];
    return s.dHf - T * s.dSf;
  }

  /** 液相摩尔焓（不含共同的 Cp·T 项） */
  Hliq(x: Comp): number {
    const c = this.p.components;
    return x[0] * c[0].dH + x[1] * c[1].dH + x[2] * c[2].dH + this.gex(x);
  }

  Hsol(si: number): number {
    return this.solids[si].dHf;
  }

  /** 液相化学势 μᵢ = G_i^L + RT ln xᵢ + μ_ex，相对纯固相基准 */
  muLiq(x: Comp, T: number): Comp {
    const c = this.p.components;
    const ex = this.muEx(x);
    const out: Comp = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      out[i] = c[i].dH * (1 - T / c[i].Tm) + R * T * Math.log(Math.max(x[i], 1e-300)) + ex[i];
    }
    return out;
  }

  /** 液相线：所有固相饱和温度的最大值与对应初晶相 */
  liquidus(x: Comp): { T: number; si: number } {
    let T = -1;
    let si = -1;
    for (let k = 0; k < this.solids.length; k++) {
      const t = this.Tsat(k, x);
      if (t > T) {
        T = t;
        si = k;
      }
    }
    return { T, si };
  }

  // ------------------------------------------------------------ 固溶体（正规溶液）相

  /** 液相正规溶液参数（与 Gliq 相同的模型，供通用代码使用） */
  private liqParams(): { a: Comp; b: Comp; om: Comp } {
    const c = this.p.components;
    return { a: [c[0].dH, c[1].dH, c[2].dH], b: [c[0].dH / c[0].Tm, c[1].dH / c[1].Tm, c[2].dH / c[2].Tm], om: this.om };
  }

  /** 任意相 si（-1 为液相）在成分 y 处的吉布斯能；化学计量相忽略 y */
  Gphase(si: number, y: Comp, T: number): number {
    if (si < 0) return this.Gliq(y, T);
    const s = this.solids[si];
    if (!s.sol) return this.Gsol(si, T);
    return regG(s.sol, y, T);
  }

  /** 焓（不含共同的 Cp·T 项） */
  Hphase(si: number, y: Comp): number {
    if (si < 0) return this.Hliq(y);
    const s = this.solids[si];
    if (!s.sol) return this.Hsol(si);
    return s.sol.a[0] * y[0] + s.sol.a[1] * y[1] + s.sol.a[2] * y[2] + regGex(s.sol.om, y);
  }

  /** 连续相（液相或固溶体）的化学势；化学计量相返回 null */
  muPhase(si: number, y: Comp, T: number): Comp | null {
    if (si < 0) return this.muLiq(y, T);
    const s = this.solids[si];
    if (!s.sol) return null;
    return regMu(s.sol, y, T);
  }

  isContinuous(si: number): boolean {
    return si < 0 || !!this.solids[si].sol;
  }

  /**
   * 与液相 x（温度 T）达到"最大驱动力"的固相成分：y* = argmax_y [μᴸ(x,T)·y − G_s(y,T)]。
   * 平衡（饱和）时这就是与液相共轭的固相成分；化学计量相返回其固定成分。
   */
  solidComp(si: number, x: Comp, T: number): Comp {
    const s = this.solids[si];
    if (!s.sol) return s.n;
    return argmaxY(s.sol, this.muLiq(x, T), T, s.n);
  }

  /** 析出驱动力 Δ_s(x,T) = max_y [μᴸ·y − G_s(y)]（> 0：液相对 s 过饱和） */
  drivingForce(si: number, x: Comp, T: number): number {
    const mu = this.muLiq(x, T);
    const y = this.solidComp(si, x, T);
    return mu[0] * y[0] + mu[1] * y[1] + mu[2] * y[2] - this.Gphase(si, y, T);
  }

  /**
   * 固溶体的饱和温度：F(y,T) = μᴸ(x,T)·y − G_s(y,T) 对固定 y 是 T 的一次函数 A(y) − T·B(y)。
   * 交替执行  T ← A(y)/B(y)（与化学计量相相同的闭式解）  与  y ← argmax_y F(y,T)，
   * 这正是对 Δ(T) = max_y F 的牛顿迭代（包络定理：dΔ/dT = −B(y*)），二次收敛。
   */
  private solTsat(si: number, x: Comp): number {
    const s = this.solids[si];
    const sol = s.sol!;
    const L = this.liqParams();
    const exL = this.muEx(x);
    for (let i = 0; i < 3; i++) if (s.n[i] > 0.5 && x[i] <= 1e-300) return 0;
    let y: Comp = s.n;
    let T = 1000;
    for (let it = 0; it < 60; it++) {
      let A = 0;
      let B = 0;
      for (let i = 0; i < 3; i++) {
        if (y[i] <= 0) continue;
        if (x[i] <= 1e-300) continue;
        A += y[i] * (L.a[i] + exL[i] - sol.a[i]) ;
        B += y[i] * (L.b[i] - R * Math.log(x[i]) - sol.b[i] + R * Math.log(y[i]));
      }
      A -= regGex(sol.om, y);
      if (B <= 0 || A <= 0) return 0;
      const Tn = A / B;
      const done = Math.abs(Tn - T) < 1e-9 * Tn;
      T = Tn;
      if (done) break;
      y = argmaxY(sol, this.muLiq(x, T), T, y);
    }
    return T;
  }

  /**
   * 给定固相化学势（三个固相确定的公切面）下，液相与该切面的最小间距。
   * 值 ≥ 0 表示这三个固相构成的连结三角形在该温度下稳定（液相位于切面之上）。
   */
  facetStable(s3: [number, number, number], T: number): boolean {
    const a = this.solids[s3[0]].n;
    const b = this.solids[s3[1]].n;
    const c = this.solids[s3[2]].n;
    const g = [this.Gsol(s3[0], T), this.Gsol(s3[1], T), this.Gsol(s3[2], T)];
    const mu = solve3(a, b, c, g);
    if (!mu) return false;
    const cc = this.p.components;
    // 液相化学势 = 切面化学势 ⇒ ln xᵢ = (μᵢ − Gᵢᴸ − μᵢᴱˣ)/RT + const；迭代求最低点
    let x: Comp = [1 / 3, 1 / 3, 1 / 3];
    for (let it = 0; it < 80; it++) {
      const ex = this.muEx(x);
      const w: Comp = [0, 0, 0];
      let m = -Infinity;
      for (let i = 0; i < 3; i++) {
        w[i] = (mu[i] - cc[i].dH * (1 - T / cc[i].Tm) - ex[i]) / (R * T);
        if (w[i] > m) m = w[i];
      }
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        w[i] = Math.exp(w[i] - m);
        sum += w[i];
      }
      const nx: Comp = [w[0] / sum, w[1] / sum, w[2] / sum];
      const d = Math.abs(nx[0] - x[0]) + Math.abs(nx[1] - x[1]) + Math.abs(nx[2] - x[2]);
      x = [0.5 * x[0] + 0.5 * nx[0], 0.5 * x[1] + 0.5 * nx[1], 0.5 * x[2] + 0.5 * nx[2]];
      if (d < 1e-12) break;
    }
    const tpd = this.Gliq(x, T) - (mu[0] * x[0] + mu[1] * x[1] + mu[2] * x[2]);
    return tpd >= -1e-6;
  }
}

/** 解 3×3：行向量 a,b,c 与右端 g，即 a·μ=g0, b·μ=g1, c·μ=g2 */
function solve3(a: Comp, b: Comp, c: Comp, g: number[]): Comp | null {
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  const x0 =
    (g[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (g[1] * c[2] - b[2] * g[2]) + a[2] * (g[1] * c[1] - b[1] * g[2])) * inv;
  const x1 =
    (a[0] * (g[1] * c[2] - b[2] * g[2]) - g[0] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * g[2] - g[1] * c[0])) * inv;
  const x2 =
    (a[0] * (b[1] * g[2] - g[1] * c[1]) - a[1] * (b[0] * g[2] - g[1] * c[0]) + g[0] * (b[0] * c[1] - b[1] * c[0])) * inv;
  return [x0, x1, x2];
}

// ------------------------------------------------------------------ 正规溶液工具

export interface RegSolParams {
  a: Comp;
  b: Comp;
  om: Comp;
}

export function regGex(om: Comp, y: Comp): number {
  return om[0] * y[0] * y[1] + om[1] * y[0] * y[2] + om[2] * y[1] * y[2];
}

export function regMuEx(om: Comp, y: Comp): Comp {
  const g = regGex(om, y);
  return [om[0] * y[1] + om[1] * y[2] - g, om[0] * y[0] + om[2] * y[2] - g, om[1] * y[0] + om[2] * y[1] - g];
}

export function regG(p: RegSolParams, y: Comp, T: number): number {
  let g = regGex(p.om, y);
  for (let i = 0; i < 3; i++) {
    g += y[i] * (p.a[i] - T * p.b[i]);
    if (y[i] > 1e-300) g += R * T * y[i] * Math.log(y[i]);
  }
  return g;
}

export function regMu(p: RegSolParams, y: Comp, T: number): Comp {
  const ex = regMuEx(p.om, y);
  return [0, 1, 2].map((i) => p.a[i] - T * p.b[i] + R * T * Math.log(Math.max(y[i], 1e-300)) + ex[i]) as Comp;
}

/**
 * max_y [μ·y − G(y,T)]：驻点条件 °Gᵢ + RT ln yᵢ + μᵢᴱˣ(y) = μᵢ + λ ⇒ yᵢ ∝ exp((μᵢ − °Gᵢ − μᵢᴱˣ(y))/RT)。
 * 阻尼不动点迭代；从给定初值与理想解两个起点出发，取目标值较大者（Ω 较大时可能有多个驻点）。
 */
export function argmaxY(p: RegSolParams, mu: Comp, T: number, y0: Comp): Comp {
  const RT = R * T;
  const run = (start: Comp, ideal: boolean): Comp => {
    let y: Comp = [...start] as Comp;
    for (let it = 0; it < 400; it++) {
      const ex = ideal && it === 0 ? ([0, 0, 0] as Comp) : regMuEx(p.om, y);
      const w: number[] = [0, 0, 0];
      let m = -Infinity;
      for (let i = 0; i < 3; i++) {
        w[i] = Number.isFinite(mu[i]) ? (mu[i] - (p.a[i] - T * p.b[i]) - ex[i]) / RT : -Infinity;
        if (w[i] > m) m = w[i];
      }
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        w[i] = Math.exp(w[i] - m);
        sum += w[i];
      }
      const ny: Comp = [w[0] / sum, w[1] / sum, w[2] / sum];
      const d = Math.abs(ny[0] - y[0]) + Math.abs(ny[1] - y[1]) + Math.abs(ny[2] - y[2]);
      const damp = it < 3 ? 1 : 0.6;
      y = [y[0] + damp * (ny[0] - y[0]), y[1] + damp * (ny[1] - y[1]), y[2] + damp * (ny[2] - y[2])];
      if (d < 1e-14) break;
    }
    return y;
  };
  const F = (y: Comp) => mu[0] * y[0] + mu[1] * y[1] + mu[2] * y[2] - regG(p, y, T);
  const a = run(y0, false);
  const b = run(y0, true);
  return F(a) >= F(b) ? a : b;
}
