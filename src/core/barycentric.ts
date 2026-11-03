import type { Comp, CompIndex } from './types';

/**
 * 重心坐标（三元成分）与笛卡尔坐标之间的严格变换。
 *
 * 等边三角形顶点：A = (0, 0)，B = (1, 0)，C = (1/2, √3/2)。
 * 任意成分点 P = x_A·A + x_B·B + x_C·C，变换为仿射映射，逆变换唯一。
 */

export const SQRT3_2 = Math.sqrt(3) / 2;
export const CENTROID_V = SQRT3_2 / 3;

export function toXY(x: Comp): [number, number] {
  return [x[1] + 0.5 * x[2], SQRT3_2 * x[2]];
}

export function fromXY(u: number, v: number): Comp {
  const c = v / SQRT3_2;
  const b = u - 0.5 * c;
  return [1 - b - c, b, c];
}

export function vertex(i: CompIndex): Comp {
  const x: Comp = [0, 0, 0];
  x[i] = 1;
  return x;
}

export const VERTICES: [Comp, Comp, Comp] = [vertex(0), vertex(1), vertex(2)];

export function others(i: CompIndex): [CompIndex, CompIndex] {
  return [((i + 1) % 3) as CompIndex, ((i + 2) % 3) as CompIndex];
}

export function lerpComp(a: Comp, b: Comp, t: number): Comp {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function inTriangle(x: Comp, eps = 1e-9): boolean {
  return x[0] >= -eps && x[1] >= -eps && x[2] >= -eps;
}

/** 投影回成分三角形并归一化（保证三组元之和严格为 1）。 */
export function clampComp(x: Comp): Comp {
  const a = Math.max(0, x[0]);
  const b = Math.max(0, x[1]);
  const c = Math.max(0, x[2]);
  const s = a + b + c;
  if (s <= 0) return [1 / 3, 1 / 3, 1 / 3];
  return [a / s, b / s, c / s];
}

/**
 * 求点 p 关于三角形 (a, b, c) 的重心坐标 (λa, λb, λc)。
 * 成分空间是仿射平面，因此只需前两个坐标即可求解 2×2 线性方程组。
 */
export function triBary(p: Comp, a: Comp, b: Comp, c: Comp): [number, number, number] {
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const v2x = p[0] - a[0];
  const v2y = p[1] - a[1];
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-14) return [NaN, NaN, NaN];
  const lb = (v2x * v1y - v1x * v2y) / den;
  const lc = (v0x * v2y - v2x * v0y) / den;
  return [1 - lb - lc, lb, lc];
}

/** 二维线段求交：返回两线段参数 (s, t)，s 属于 p→q，t 属于 r→w；平行时返回 null。 */
export function segIntersect(
  p: [number, number],
  q: [number, number],
  r: [number, number],
  w: [number, number],
): [number, number] | null {
  const dx1 = q[0] - p[0];
  const dy1 = q[1] - p[1];
  const dx2 = w[0] - r[0];
  const dy2 = w[1] - r[1];
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-14) return null;
  const ex = r[0] - p[0];
  const ey = r[1] - p[1];
  const s = (ex * dy2 - ey * dx2) / den;
  const t = (ex * dy1 - ey * dx1) / den;
  return [s, t];
}

/** 多边形面积（带符号）与形心，坐标为笛卡尔 (u, v)。 */
export function polygonCentroid(pts: [number, number][]): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let n = 0; n < pts.length; n++) {
    const [x0, y0] = pts[n];
    const [x1, y1] = pts[(n + 1) % pts.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const m = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return { area: 0, cx: m[0] / pts.length, cy: m[1] / pts.length };
  }
  return { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
}
