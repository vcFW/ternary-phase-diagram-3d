import * as THREE from 'three';
import { lerpComp, others, toXY, vertex, VERTICES } from '../core/barycentric';
import { colormap, type ColormapName } from '../core/colormap';
import { PAIRS, pairId, parseRegion, type TernaryEutecticDiagram } from '../core/diagram';
import type { Comp, CompIndex, RegionKey } from '../core/types';
import { toWorld, yOfT } from './world';
import { CENTROID_V, fromXY } from '../core/barycentric';

/**
 * 三维网格构建。所有顶点均由相图函数精确求值得到：
 *   - 初晶面：以初晶顶点为极点的射线参数化 (φ, t)，φ 方向显式包含三元共晶点，
 *     t=1 时精确落在单变线上，因此网格边界与单变线重合，折线处无锯齿；
 *   - 直纹面：每个温度一条母线 e_i — m_ij(T)，两点即可精确表示；
 *   - 法向量由液相面函数的解析梯度（中心差分）计算，光照连续平滑。
 */

const PHI_SEG = 72;
const R_SEG = 56;

export interface FieldMesh {
  geometry: THREE.BufferGeometry;
  /** 用于按温度着色的每顶点温度 */
  temps: Float32Array;
}

export function buildFieldGeometry(d: TernaryEutecticDiagram, i: CompIndex): FieldMesh {
  const tr = d.tRange;
  const phiE = d.phiOfEutectic(i);
  const nA = Math.max(8, Math.round(PHI_SEG * phiE));
  const nB = Math.max(8, PHI_SEG - nA);
  const phis: number[] = [];
  for (let n = 0; n <= nA; n++) phis.push(phiE * (n / nA));
  for (let n = 1; n <= nB; n++) phis.push(phiE + (1 - phiE) * (n / nB));

  const [j, k] = others(i);
  const Eij = d.binary[pairId(i, j)].comp;
  const Eik = d.binary[pairId(i, k)].comp;
  const rbOf = (phi: number, n: number): number => {
    if (n === 0) return 1 - Eij[i];
    if (n === phis.length - 1) return 1 - Eik[i];
    if (n === nA) return 1 - d.eutectic.comp[i];
    return d.fieldBoundaryR(i, phi);
  };

  const cols = phis.length;
  const rows = R_SEG + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const temps = new Float32Array(cols * rows);
  const span = tr[1] - tr[0];
  const h = 1e-5;
  const f = (u: number, v: number) => yOfT(d.Ti(i, fromXY(u, v)), tr);
  for (let c = 0; c < cols; c++) {
    const rb = rbOf(phis[c], c);
    for (let r = 0; r < rows; r++) {
      // 径向采样向边界略加密，以精确表现谷线附近的曲率
      const t = r / R_SEG;
      const tt = 1 - (1 - t) * (1 - t) * 0.35 - (1 - t) * 0.65;
      const x = d.rayPoint(i, phis[c], rb * tt);
      const T = d.Ti(i, x);
      const p = toWorld(x, T, tr);
      const idx = c * rows + r;
      pos.set(p, idx * 3);
      temps[idx] = (T - tr[0]) / span;
      const [u, v] = toXY(x);
      const fu = (f(u + h, v) - f(u - h, v)) / (2 * h);
      const fv = (f(u, v + h) - f(u, v - h)) / (2 * h);
      const n = new THREE.Vector3(-fu, 1, fv).normalize();
      nor.set([n.x, n.y, n.z], idx * 3);
    }
  }
  const index: number[] = [];
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < rows - 1; r++) {
      const a = c * rows + r;
      const b = (c + 1) * rows + r;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return { geometry: g, temps };
}

export function applyColors(
  g: THREE.BufferGeometry,
  temps: Float32Array,
  mode: 'temperature' | 'phase',
  cmap: ColormapName,
  phaseHex: string,
) {
  const col = new Float32Array(temps.length * 3);
  const pc = new THREE.Color(phaseHex);
  const light = new THREE.Color('#ffffff');
  const tmp = new THREE.Color();
  for (let n = 0; n < temps.length; n++) {
    if (mode === 'temperature') {
      // 色图节点为 sRGB 值，需转换到线性工作空间
      const [r, g, b] = colormap(cmap, temps[n]);
      tmp.setRGB(r, g, b, THREE.SRGBColorSpace);
      col.set([tmp.r, tmp.g, tmp.b], n * 3);
    } else {
      const c = pc.clone().lerp(light, 0.25 + 0.35 * (1 - temps[n]));
      col.set([c.r, c.g, c.b], n * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** 带状曲面：由若干行"母线"组成，每行顶点数相同 */
function stripGeometry(rowsPts: [number, number, number][][]): THREE.BufferGeometry {
  const rows = rowsPts.length;
  const cols = rowsPts[0].length;
  const pos = new Float32Array(rows * cols * 3);
  rowsPts.forEach((row, r) => row.forEach((p, c) => pos.set(p, (r * cols + c) * 3)));
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = (r + 1) * cols + c;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** 直纹面：母线 e_end — m_ij(T)，T 自 T_ij 至 T_E */
export function buildRuledGeometry(d: TernaryEutecticDiagram, i: CompIndex, j: CompIndex, end: CompIndex): THREE.BufferGeometry {
  const tr = d.tRange;
  const Tb = d.binaryT(i, j);
  const TE = d.eutectic.T;
  const rows: [number, number, number][][] = [];
  const N = 96;
  for (let n = 0; n <= N; n++) {
    // 温度均匀分布的母线，避免近端点处出现细长三角形
    const T = Tb + (TE - Tb) * (n / N);
    const m = n === N ? d.eutectic.comp : d.monoAt(i, j, T)!;
    // 每条母线细分，使相邻母线间的四边形近似平面，透明渲染时明暗连续
    const row: [number, number, number][] = [];
    for (let q = 0; q <= 16; q++) row.push(toWorld(lerpComp(VERTICES[end], m, q / 16), T, tr));
    rows.push(row);
  }
  return stripGeometry(rows);
}

/** 水平多边形（等温截面区域、共晶平面等），earcut 三角化 */
export function horizontalPolygon(poly: Comp[], T: number, tr: [number, number]): THREE.BufferGeometry {
  const pts2 = poly.map((p) => {
    const [u, v] = toXY(p);
    return new THREE.Vector2(u - 0.5, -(v - CENTROID_V));
  });
  const tris = THREE.ShapeUtils.triangulateShape(pts2, []);
  const y = yOfT(T, tr);
  const pos = new Float32Array(pts2.length * 3);
  pts2.forEach((p, n) => pos.set([p.x, y, p.y], n * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  g.computeVertexNormals();
  return g;
}

/** 侧壁（二元截面）上的竖直带：沿边 a→b，温度在 lo(s) 与 hi(s) 之间 */
function wallStrip(
  a: Comp,
  b: Comp,
  lo: (x: Comp) => number,
  hi: (x: Comp) => number,
  tr: [number, number],
  n = 80,
): THREE.BufferGeometry {
  const rows: [number, number, number][][] = [];
  for (let m = 0; m <= n; m++) {
    const x = lerpComp(a, b, m / n);
    rows.push([toWorld(x, lo(x), tr), toWorld(x, hi(x), tr)]);
  }
  return stripGeometry(rows);
}

/**
 * 空间相区的包络面（用于高亮选中相区）。
 * 由初晶面、直纹面、共晶面、棱柱侧壁与上下底面组合而成。
 */
export function buildRegionShell(d: TernaryEutecticDiagram, key: RegionKey): THREE.BufferGeometry[] {
  const tr = d.tRange;
  const TE = d.eutectic.T;
  const out: THREE.BufferGeometry[] = [];
  const liqT = (x: Comp) => d.liquidus(x).T;
  if (key === 'L') {
    for (const i of [0, 1, 2] as CompIndex[]) out.push(buildFieldGeometry(d, i).geometry);
    out.push(horizontalPolygon([...VERTICES], tr[1], tr));
    for (const [i, j] of PAIRS) out.push(wallStrip(VERTICES[i], VERTICES[j], liqT, () => tr[1], tr));
    return out;
  }
  if (key === 'S') {
    out.push(horizontalPolygon([...VERTICES], TE, tr));
    out.push(horizontalPolygon([...VERTICES], tr[0], tr));
    for (const [i, j] of PAIRS) out.push(wallStrip(VERTICES[i], VERTICES[j], () => tr[0], () => TE, tr, 2));
    return out;
  }
  const { solids } = parseRegion(key);
  if (solids.length === 1) {
    const i = solids[0];
    out.push(buildFieldGeometry(d, i).geometry);
    for (const j of others(i)) {
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      out.push(buildRuledGeometry(d, lo, hi, i));
      const b = d.binary[pairId(i, j)];
      out.push(wallStrip(vertex(i), b.comp, () => b.T, liqT, tr, 60));
    }
    return out;
  }
  const [i, j] = solids;
  out.push(buildRuledGeometry(d, i, j, i));
  out.push(buildRuledGeometry(d, i, j, j));
  const Tb = d.binary[pairId(i, j)].T;
  out.push(wallStrip(VERTICES[i], VERTICES[j], () => TE, () => Tb, tr, 2));
  out.push(horizontalPolygon([VERTICES[i], VERTICES[j], d.eutectic.comp], TE, tr));
  return out;
}

/** 等温线（液相面上）：返回线段端点数组 */
export function isothermSegments(d: TernaryEutecticDiagram, levels: number[], lift = 0.0012): number[] {
  const tr = d.tRange;
  const seg: number[] = [];
  for (const T of levels) {
    for (const i of [0, 1, 2] as CompIndex[]) {
      const c = d.isotherm(i, T, 60);
      if (!c) continue;
      for (let n = 1; n < c.points.length; n++) {
        const a = toWorld(c.points[n - 1], T, tr);
        const b = toWorld(c.points[n], T, tr);
        seg.push(a[0], a[1] + lift, a[2], b[0], b[1] + lift, b[2]);
      }
    }
  }
  return seg;
}

export function isothermLevels(d: TernaryEutecticDiagram, stepC = 50): number[] {
  const lo = d.eutectic.T - 273.15;
  const hi = Math.max(...d.params.components.map((c) => c.Tm)) - 273.15;
  const out: number[] = [];
  for (let t = Math.ceil((lo + 1) / stepC) * stepC; t < hi; t += stepC) out.push(t + 273.15);
  return out;
}
