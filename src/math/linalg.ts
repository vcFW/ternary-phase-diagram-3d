/**
 * 小型稠密线性代数内核（纯 TypeScript，确定性）。矩阵按行存储：Mat = number[][]。
 *
 * 相图中出现的矩阵都很小（≤ 4×4，或 3×n 的成分矩阵），因此采用数值上最稳健的算法而不计较复杂度：
 *   · 奇异值分解：单边 Jacobi（Hestenes）—— 秩、零空间、条件数都由奇异值给出；
 *   · 线性方程组：列主元 LU；
 *   · 最小二乘：SVD 伪逆，并返回残差。
 */
export type Vec = number[];
export type Mat = number[][];

export const EPS = 2.220446049250313e-16;

export function zeros(m: number, n: number): Mat {
  return Array.from({ length: m }, () => new Array(n).fill(0));
}

export function eye(n: number): Mat {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

export function clone(A: Mat): Mat {
  return A.map((r) => r.slice());
}

export function transpose(A: Mat): Mat {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const T = zeros(n, m);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

export function matMul(A: Mat, B: Mat): Mat {
  const m = A.length;
  const k = B.length;
  const n = k ? B[0].length : 0;
  const C = zeros(m, n);
  for (let i = 0; i < m; i++)
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += a * B[p][j];
    }
  return C;
}

export function matVec(A: Mat, x: Vec): Vec {
  return A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
}

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

export function sub(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v - b[i]);
}

export function add(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v + b[i]);
}

export function scale(a: Vec, s: number): Vec {
  return a.map((v) => v * s);
}

/** 列向量组成矩阵：cols[j] 为第 j 列 */
export function fromCols(cols: Vec[]): Mat {
  const m = cols[0].length;
  return Array.from({ length: m }, (_, i) => cols.map((c) => c[i]));
}

export function col(A: Mat, j: number): Vec {
  return A.map((r) => r[j]);
}

export interface SVD {
  /** m×n（列为左奇异向量；对应零奇异值的列置零） */
  U: Mat;
  /** 长度 n，降序 */
  S: Vec;
  /** n×n 正交矩阵（列为右奇异向量） */
  V: Mat;
}

/** 单边 Jacobi SVD：A = U·diag(S)·Vᵀ。对任意 m×n 适用（n > m 时多出的奇异值为 0）。 */
export function svd(A: Mat): SVD {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const U = clone(A);
  const V = eye(n);
  const fro2 = A.reduce((s, r) => s + r.reduce((t, v) => t + v * v, 0), 0);
  const tiny = fro2 * 1e-30;
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += U[i][p] * U[i][p];
          beta += U[i][q] * U[i][q];
          gamma += U[i][p] * U[i][q];
        }
        if (gamma === 0 || alpha <= tiny || beta <= tiny || Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta)) continue;
        off = Math.max(off, Math.abs(gamma) / Math.sqrt(alpha * beta));
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const up = U[i][p];
          U[i][p] = c * up - s * U[i][q];
          U[i][q] = s * up + c * U[i][q];
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p];
          V[i][p] = c * vp - s * V[i][q];
          V[i][q] = s * vp + c * V[i][q];
        }
      }
    if (off < 1e-15) break;
  }
  const sv = Array.from({ length: n }, (_, j) => Math.sqrt(U.reduce((s, r) => s + r[j] * r[j], 0)));
  const order = sv.map((_, j) => j).sort((a, b) => sv[b] - sv[a]);
  const S = order.map((j) => sv[j]);
  const smax = S[0] || 0;
  const Uo = zeros(m, n);
  const Vo = zeros(n, n);
  order.forEach((j, k) => {
    const s = sv[j];
    for (let i = 0; i < m; i++) Uo[i][k] = s > smax * 1e-300 && s > 0 ? U[i][j] / s : 0;
    for (let i = 0; i < n; i++) Vo[i][k] = V[i][j];
  });
  // 实际只有 min(m,n) 个奇异值有意义；n > m 时其余必为 0（Jacobi 收敛后为舍入量级）
  for (let k = Math.min(m, n); k < n; k++) S[k] = 0;
  return { U: Uo, S, V: Vo };
}

/** 数值秩的默认容差：max(m,n)·ε·σ_max（与 MATLAB rank 相同的约定） */
export function rankTol(A: Mat, S?: Vec): number {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const s = S ?? svd(A).S;
  return Math.max(m, n) * EPS * (s[0] || 0) * 16;
}

export function rank(A: Mat, tol?: number): number {
  const { S } = svd(A);
  const t = tol ?? rankTol(A, S);
  return S.filter((v) => v > t).length;
}

/** 零空间的标准正交基（列向量组）。 */
export function nullSpace(A: Mat, tol?: number): Vec[] {
  const { S, V } = svd(A);
  const t = tol ?? rankTol(A, S);
  const out: Vec[] = [];
  for (let k = 0; k < S.length; k++) if (!(S[k] > t)) out.push(col(V, k));
  return out;
}

/** 2-范数条件数 κ = σ_max/σ_min（取 min(m,n) 个奇异值）；奇异时为 Infinity */
export function cond(A: Mat): number {
  const m = A.length;
  const n = m ? A[0].length : 0;
  const { S } = svd(A);
  const r = Math.min(m, n);
  const smin = S[r - 1];
  if (!(smin > 0) || smin < rankTol(A, S)) return Infinity;
  return S[0] / smin;
}

export interface LU {
  LU: Mat;
  piv: number[];
  sign: number;
  singular: boolean;
}

export function lu(A: Mat): LU {
  const n = A.length;
  const M = clone(A);
  const piv = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  let singular = false;
  const scaleRef = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) <= n * EPS * scaleRef) {
      singular = true;
      continue;
    }
    if (p !== k) {
      [M[p], M[k]] = [M[k], M[p]];
      [piv[p], piv[k]] = [piv[k], piv[p]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      M[i][k] /= M[k][k];
      for (let j = k + 1; j < n; j++) M[i][j] -= M[i][k] * M[k][j];
    }
  }
  return { LU: M, piv, sign, singular };
}

export function det(A: Mat): number {
  const n = A.length;
  if (n === 2) return A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (n === 3)
    return (
      A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    );
  const f = lu(A);
  let d = f.sign;
  for (let i = 0; i < n; i++) d *= f.LU[i][i];
  return d;
}

/** 方阵求解 A x = b（列主元 LU）；奇异时返回 null */
export function solve(A: Mat, b: Vec): Vec | null {
  const n = A.length;
  const f = lu(A);
  if (f.singular) return null;
  const y = f.piv.map((p) => b[p]);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) y[i] -= f.LU[i][j] * y[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) y[i] -= f.LU[i][j] * y[j];
    y[i] /= f.LU[i][i];
  }
  return y;
}

export function inverse(A: Mat): Mat | null {
  const n = A.length;
  const cols: Vec[] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return fromCols(cols);
}

export interface LstSq {
  x: Vec;
  /** ‖A x − b‖₂ */
  residual: number;
  rank: number;
}

/** 最小范数最小二乘解 x = A⁺ b */
export function lstsq(A: Mat, b: Vec): LstSq {
  const { U, S, V } = svd(A);
  const n = V.length;
  const t = rankTol(A, S);
  const x = new Array(n).fill(0);
  let r = 0;
  for (let k = 0; k < S.length; k++) {
    if (!(S[k] > t)) continue;
    r++;
    const c = dot(col(U, k), b) / S[k];
    for (let i = 0; i < n; i++) x[i] += c * V[i][k];
  }
  const res = norm(sub(matVec(A, x), b));
  return { x, residual: res, rank: r };
}

/** 高斯消元的逐步记录（用于"推导模式"展示行变换）。输入增广矩阵 [A | b]。 */
export interface ElimStep {
  op: string;
  M: Mat;
  pivot?: [number, number];
}

export function gaussSteps(Aug: Mat, rowNames?: string[]): { steps: ElimStep[]; x: Vec | null } {
  const M = clone(Aug);
  const m = M.length;
  const n = M[0].length - 1;
  const names = rowNames ? rowNames.slice() : M.map((_, i) => `r${i + 1}`);
  const steps: ElimStep[] = [{ op: '初始增广矩阵 [A | b]', M: clone(M) }];
  const scaleRef = Math.max(1e-300, ...Aug.flat().map(Math.abs));
  let row = 0;
  const pivCols: number[] = [];
  for (let c = 0; c < n && row < m; c++) {
    let p = row;
    for (let i = row + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) <= 1e-12 * scaleRef) {
      steps.push({ op: `第 ${c + 1} 列无可用主元（该列与前面各列线性相关）`, M: clone(M) });
      continue;
    }
    if (p !== row) {
      [M[p], M[row]] = [M[row], M[p]];
      [names[p], names[row]] = [names[row], names[p]];
      steps.push({ op: `交换 ${names[p]} ↔ ${names[row]}（列主元）`, M: clone(M), pivot: [row, c] });
    }
    for (let i = row + 1; i < m; i++) {
      const f = M[i][c] / M[row][c];
      if (Math.abs(f) < 1e-15) continue;
      for (let j = c; j <= n; j++) M[i][j] -= f * M[row][j];
      M[i][c] = 0;
      steps.push({ op: `${names[i]} ← ${names[i]} − (${fmtNum(f)})·${names[row]}`, M: clone(M), pivot: [row, c] });
    }
    pivCols.push(c);
    row++;
  }
  // 相容性：零行的右端
  for (let i = row; i < m; i++) {
    if (Math.abs(M[i][n]) > 1e-9 * scaleRef) {
      steps.push({ op: `第 ${i + 1} 行化为 0 = ${fmtNum(M[i][n])}：方程组不相容（无精确解）`, M: clone(M) });
      return { steps, x: null };
    }
  }
  if (pivCols.length < n) {
    steps.push({ op: `秩 ${pivCols.length} < 未知数 ${n}：解不唯一（存在 ${n - pivCols.length} 维零空间）`, M: clone(M) });
    return { steps, x: null };
  }
  const x = new Array(n).fill(0);
  for (let k = pivCols.length - 1; k >= 0; k--) {
    const c = pivCols[k];
    let s = M[k][n];
    for (let j = c + 1; j < n; j++) s -= M[k][j] * x[j];
    x[c] = s / M[k][c];
  }
  steps.push({ op: '回代得解', M: clone(M) });
  return { steps, x };
}

export function fmtNum(v: number, d = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : 'NaN';
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) return v.toExponential(2).replace('-', '−');
  const s = v.toFixed(d);
  return (Object.is(Number(s), -0) ? s.replace('-', '') : s).replace('-', '−');
}
