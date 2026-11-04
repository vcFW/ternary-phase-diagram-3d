import { isothermal, type IsoSection } from './isothermal';
import type { PhaseDiagram } from './diagram';
import type { Comp } from './types';
import { verticalRaster, type VerticalRaster, type VerticalSpec } from './vertical';
import { SQRT3_2, toXY } from './barycentric';

/**
 * 截面定位（垂直截面线 p1→p2 均位于成分三角形内，端点落在三角形边界上）。
 * 模式：
 *  free     自由两点（拖动端点沿三角形周界滑动，拖动平面整体平移）
 *  parallel 平行于某一边（某组元含量恒定）
 *  vertex   过某顶点（另两组元比值恒定）
 *  point    过状态点（绕状态点旋转）
 *  join     过两个固相成分点的连线（如 D–C、A–S），并延长至边界
 */
export type SectionMode = 'free' | 'parallel' | 'vertex' | 'point' | 'join';

export interface SectionConfig {
  mode: SectionMode;
  p1: Comp;
  p2: Comp;
  /** parallel：固定哪个组元（0/1/2）及其含量 */
  fixedComp: 0 | 1 | 2;
  fixedValue: number;
  /** vertex：顶点及比值 r（对边上点 = (1-r)·另一端 + r·...） */
  vertex: 0 | 1 | 2;
  ratio: number;
  /** point：方向角（弧度，笛卡尔） */
  angle: number;
  /** join：两个固相下标 */
  join: [number, number];
}

export const defaultSection = (): SectionConfig => ({
  mode: 'parallel',
  p1: [0.3, 0.7, 0],
  p2: [0.3, 0, 0.7],
  fixedComp: 0,
  fixedValue: 0.3,
  vertex: 2,
  ratio: 0.5,
  angle: Math.PI / 2,
  join: [3, 2],
});

const EPS = 1e-12;

function fromXY(u: number, v: number): Comp {
  const c = v / SQRT3_2;
  const b = u - 0.5 * c;
  return [1 - b - c, b, c];
}

/** 过点 x、方向 (dx,dy) 的直线与三角形周界的两个交点 */
export function perimeterLine(x: Comp, dx: number, dy: number): [Comp, Comp] {
  const P = toXY(x);
  // 在成分空间求 t 的范围：x + t·dirComp ≥ 0
  const dc = dy / SQRT3_2;
  const db = dx - 0.5 * dc;
  const d: Comp = [-db - dc, db, dc];
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < EPS) continue;
    const t = -x[i] / d[i];
    if (d[i] > 0) tmin = Math.max(tmin, t);
    else tmax = Math.min(tmax, t);
  }
  const at = (t: number): Comp => {
    const q = fromXY(P[0] + t * dx, P[1] + t * dy);
    return [Math.max(0, q[0]), Math.max(0, q[1]), Math.max(0, q[2])];
  };
  const a = at(tmin);
  const b = at(tmax);
  const norm = (q: Comp): Comp => {
    const s = q[0] + q[1] + q[2];
    return [q[0] / s, q[1] / s, q[2] / s];
  };
  return [norm(a), norm(b)];
}

export function resolveSection(cfg: SectionConfig, d: PhaseDiagram, x0: Comp): VerticalSpec {
  switch (cfg.mode) {
    case 'free':
      return { p1: cfg.p1, p2: cfg.p2 };
    case 'parallel': {
      const i = cfg.fixedComp;
      const c = Math.min(0.995, Math.max(0.005, cfg.fixedValue));
      const j = (i + 1) % 3;
      const k = (i + 2) % 3;
      const p1: Comp = [0, 0, 0];
      const p2: Comp = [0, 0, 0];
      p1[i] = c;
      p1[j] = 1 - c;
      p2[i] = c;
      p2[k] = 1 - c;
      return { p1, p2 };
    }
    case 'vertex': {
      const v = cfg.vertex;
      const j = (v + 1) % 3;
      const k = (v + 2) % 3;
      const p1: Comp = [0, 0, 0];
      p1[v] = 1;
      const p2: Comp = [0, 0, 0];
      p2[j] = 1 - cfg.ratio;
      p2[k] = cfg.ratio;
      return { p1, p2 };
    }
    case 'point': {
      const [a, b] = perimeterLine(x0, Math.cos(cfg.angle), Math.sin(cfg.angle));
      return { p1: a, p2: b };
    }
    case 'join': {
      const a = toXY(d.solids[cfg.join[0]].n);
      const b = toXY(d.solids[cfg.join[1]].n);
      const [p1, p2] = perimeterLine(d.solids[cfg.join[0]].n, b[0] - a[0], b[1] - a[1]);
      // 沿 a→b 方向统一为 a 在前
      const ta = toXY(p1);
      const dot = (b[0] - a[0]) * (toXY(p2)[0] - ta[0]) + (b[1] - a[1]) * (toXY(p2)[1] - ta[1]);
      return dot >= 0 ? { p1, p2 } : { p1: p2, p2: p1 };
    }
  }
}

/** 点 x 到截面线段 p1–p2 的距离（笛卡尔，三角形边长为 1） */
export function distToSection(spec: VerticalSpec, x: Comp): number {
  const a = toXY(spec.p1);
  const b = toXY(spec.p2);
  const p = toXY(x);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 < EPS ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * 冷却模式要求截面经过状态点 x₀。若当前截面不经过，返回"过状态点"模式（沿用原截面方向）的新配置；
 * 已经经过则返回 null。
 */
export function sectionThroughState(cfg: SectionConfig, d: PhaseDiagram, x0: Comp): SectionConfig | null {
  if (cfg.mode === 'point') return null;
  const spec = resolveSection(cfg, d, x0);
  if (distToSection(spec, x0) < 1e-3) return null;
  const a = toXY(spec.p1);
  const b = toXY(spec.p2);
  return { ...cfg, mode: 'point', angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** 把任意点投影到三角形周界上最近的点 */
export function nearestOnPerimeter(x: Comp): Comp {
  const cands: Comp[] = [];
  for (let e = 0; e < 3; e++) {
    const j = (e + 1) % 3;
    const k = (e + 2) % 3;
    // 边：x[k] = 0
    const q: Comp = [0, 0, 0];
    const s = Math.max(1e-12, x[e] + x[j]);
    q[e] = Math.max(0, x[e]) / s;
    q[j] = 1 - q[e];
    q[k] = 0;
    cands.push(q);
  }
  const P = toXY(x);
  let best = cands[0];
  let bd = Infinity;
  for (const q of cands) {
    const Q = toXY(q);
    const dd = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (dd < bd) {
      bd = dd;
      best = q;
    }
  }
  return best;
}

/** 截面端点的简短成分标签 */
export function endLabel(p: Comp, d: PhaseDiagram): string {
  const sym = d.params.components.map((c) => c.symbol);
  for (let i = 0; i < 3; i++) if (p[i] > 0.9995) return sym[i];
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) if (p[i] > 0.0005) parts.push(`${sym[i]}${Math.round(p[i] * 100)}`);
  return parts.join(' ');
}

// 简易缓存
let isoKey = '';
let isoVal: IsoSection | null = null;
export function computeIso(d: PhaseDiagram, T: number): IsoSection {
  const k = `${d.uid}|${T.toFixed(3)}`;
  if (k === isoKey && isoVal) return isoVal;
  isoVal = isothermal(d, T);
  isoKey = k;
  return isoVal;
}

export function computeVertical(d: PhaseDiagram, spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number): VerticalRaster {
  return verticalRaster(d, spec, W, H, Tmin, Tmax);
}
