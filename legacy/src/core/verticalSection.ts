import { lerpComp, segIntersect, toXY, VERTICES } from './barycentric';
import { ALL_REGIONS, PAIRS, pairId, type TernaryEutecticDiagram } from './diagram';
import type { Comp, CompIndex, VerticalLine } from './types';

/**
 * 垂直截面（变温截面）：成分三角形内一条直线 x(s) = p1 + s(p2 − p1) 与温度轴张成的平面。
 *
 * 截面上的相界由真实几何求交得到：
 *   - 液相线：T_liq(x(s))，并精确插入与单变线投影的交点（折点）；
 *   - 直纹面（L+i / L+i+j 界面）：在每个温度 T，连结线 e_i — m_ij(T) 与截线求交；
 *   - 三元共晶水平线 T = T_E。
 */

export type VerticalMode = 'const' | 'ratio';

export interface VerticalSpec {
  mode: VerticalMode;
  /** const: 固定组元 k 的含量；ratio: 过顶点 k 的定比截面 */
  k: CompIndex;
  /** const: x_k；ratio: x_j/(x_i+x_j)，j=(k+1)%3 */
  value: number;
}

export function axisComponent(spec: VerticalSpec): CompIndex {
  return spec.mode === 'const' ? (((spec.k + 1) % 3) as CompIndex) : spec.k;
}

export function verticalLine(spec: VerticalSpec): VerticalLine {
  const k = spec.k;
  const j = ((k + 1) % 3) as CompIndex;
  const i = ((k + 2) % 3) as CompIndex;
  if (spec.mode === 'const') {
    const v = Math.min(0.999, Math.max(0, spec.value));
    const p1: Comp = [0, 0, 0];
    const p2: Comp = [0, 0, 0];
    p1[k] = v;
    p1[i] = 1 - v;
    p2[k] = v;
    p2[j] = 1 - v;
    return { p1, p2 };
  }
  const r = Math.min(1, Math.max(0, spec.value));
  const p1: Comp = [0, 0, 0];
  p1[j] = r;
  p1[i] = 1 - r;
  return { p1, p2: [...VERTICES[k]] as Comp };
}

/** 截面横轴取值（显示用组元含量） */
export function axisValue(spec: VerticalSpec, s: number): number {
  if (spec.mode === 'const') return s * (1 - Math.min(0.999, spec.value));
  return s;
}

export function axisRange(spec: VerticalSpec): [number, number] {
  return [0, axisValue(spec, 1)];
}

/** 成分点在截线上的参数 s 及偏离距离 */
export function projectOnLine(line: VerticalLine, x: Comp): { s: number; dist: number } {
  const a = toXY(line.p1);
  const b = toXY(line.p2);
  const p = toXY(x);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  const cx = a[0] + s * dx;
  const cy = a[1] + s * dy;
  return { s, dist: Math.hypot(p[0] - cx, p[1] - cy) };
}

/** 使截面通过给定成分点的参数值 */
export function specThrough(spec: VerticalSpec, x: Comp): VerticalSpec {
  const k = spec.k;
  const j = (k + 1) % 3;
  const i = (k + 2) % 3;
  if (spec.mode === 'const') return { ...spec, value: Math.min(0.99, x[k]) };
  const s = x[i] + x[j];
  return { ...spec, value: s > 1e-9 ? x[j] / s : spec.value };
}

/** 截面参数改变时，将成分点沿截面法向移动以保持在截面上 */
export function moveCompToSpec(spec: VerticalSpec, x: Comp): Comp {
  const k = spec.k;
  const j = (k + 1) % 3;
  const i = (k + 2) % 3;
  const out: Comp = [...x] as Comp;
  if (spec.mode === 'const') {
    const v = Math.min(0.99, Math.max(0, spec.value));
    const rest = x[i] + x[j];
    const ri = rest > 1e-9 ? x[i] / rest : 0.5;
    out[k] = v;
    out[i] = (1 - v) * ri;
    out[j] = (1 - v) * (1 - ri);
  } else {
    const rest = 1 - x[k];
    out[j] = rest * spec.value;
    out[i] = rest * (1 - spec.value);
  }
  return out;
}

export interface SectionCurve {
  kind: 'liquidus' | 'ruled' | 'eutectic';
  /** 'ruled' 时：直纹面所属单变线与端点相 */
  pair?: string;
  end?: CompIndex;
  points: { s: number; T: number }[];
}

export interface VerticalSectionGeometry {
  line: VerticalLine;
  curves: SectionCurve[];
}

export function verticalSectionCurves(d: TernaryEutecticDiagram, line: VerticalLine, n = 480): VerticalSectionGeometry {
  const curves: SectionCurve[] = [];
  const pa = toXY(line.p1);
  const pb = toXY(line.p2);

  // ---- 液相线：均匀采样 + 与单变线投影交点 ----
  const sList: number[] = [];
  for (let m = 0; m <= n; m++) sList.push(m / n);
  for (const [i, j] of PAIRS) {
    const smp = d.mono[pairId(i, j)].samples;
    for (let m = 1; m < smp.length; m++) {
      const hit = segIntersect(pa, pb, toXY(smp[m - 1].y), toXY(smp[m].y));
      if (hit && hit[0] >= 0 && hit[0] <= 1 && hit[1] >= 0 && hit[1] <= 1) sList.push(hit[0]);
    }
  }
  sList.sort((a, b) => a - b);
  curves.push({
    kind: 'liquidus',
    points: sList.map((s) => ({ s, T: d.liquidus(lerpComp(line.p1, line.p2, s)).T })),
  });

  // ---- 直纹面交线 ----
  for (const [i, j] of PAIRS) {
    const smp = d.mono[pairId(i, j)].samples;
    for (const end of [i, j] as CompIndex[]) {
      const ev = toXY(VERTICES[end]);
      let run: { s: number; T: number }[] = [];
      for (const sm of smp) {
        const hit = segIntersect(pa, pb, ev, toXY(sm.y));
        const ok = hit && hit[0] >= -1e-9 && hit[0] <= 1 + 1e-9 && hit[1] >= 1e-9 && hit[1] <= 1 + 1e-9;
        if (ok) {
          run.push({ s: Math.min(1, Math.max(0, hit![0])), T: sm.T });
        } else if (run.length) {
          if (run.length > 1) curves.push({ kind: 'ruled', pair: pairId(i, j), end, points: run });
          run = [];
        }
      }
      if (run.length > 1) curves.push({ kind: 'ruled', pair: pairId(i, j), end, points: run });
    }
  }

  // ---- 三元共晶面 ----
  curves.push({
    kind: 'eutectic',
    points: [
      { s: 0, T: d.eutectic.T },
      { s: 1, T: d.eutectic.T },
    ],
  });
  return { line, curves };
}

/** 截面相区栅格化：返回每个像素的相区下标（ALL_REGIONS 序号），供填色与区域标注 */
export function rasterizeVertical(
  d: TernaryEutecticDiagram,
  line: VerticalLine,
  w: number,
  h: number,
  tRange: [number, number],
): Uint8Array {
  const out = new Uint8Array(w * h);
  const idx = new Map(ALL_REGIONS.map((k, n) => [k, n]));
  for (let px = 0; px < w; px++) {
    const s = (px + 0.5) / w;
    const x = lerpComp(line.p1, line.p2, s);
    const L = d.liquidus(x);
    for (let py = 0; py < h; py++) {
      const T = tRange[1] - ((py + 0.5) / h) * (tRange[1] - tRange[0]);
      out[py * w + px] = idx.get(d.classify(x, T, L)) ?? 0;
    }
  }
  return out;
}
