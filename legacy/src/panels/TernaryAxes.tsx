import { lerpComp, toXY, VERTICES, fromXY } from '../core/barycentric';
import type { Comp, CompIndex } from '../core/types';

/** 二维成分三角形的像素映射（等边三角形，A 左下、B 右下、C 顶部） */
export interface TriMap {
  w: number;
  h: number;
  side: number;
  ox: number;
  oy: number;
  px: (x: Comp) => [number, number];
  inv: (sx: number, sy: number) => Comp;
}

export function makeTriMap(w: number, h: number, pad = { l: 34, r: 34, t: 26, b: 44 }): TriMap {
  const side = Math.min(w - pad.l - pad.r, ((h - pad.t - pad.b) * 2) / Math.sqrt(3));
  const triH = (side * Math.sqrt(3)) / 2;
  const ox = pad.l + (w - pad.l - pad.r - side) / 2;
  const oy = pad.t + (h - pad.t - pad.b - triH) / 2 + triH;
  return {
    w,
    h,
    side,
    ox,
    oy,
    px: (x) => {
      const [u, v] = toXY(x);
      return [ox + u * side, oy - v * side];
    },
    inv: (sx, sy) => fromXY((sx - ox) / side, (oy - sy) / side),
  };
}

export function pathOf(m: TriMap, pts: Comp[], close = false): string {
  if (!pts.length) return '';
  const s = pts.map((p, n) => {
    const [x, y] = m.px(p);
    return `${n ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return s.join('') + (close ? 'Z' : '');
}

/** 坐标网格、刻度与顶点标注 */
export function TernaryAxes({ m, sym, grid = true }: { m: TriMap; sym: string[]; grid?: boolean }) {
  const lines: JSX.Element[] = [];
  const ticks: JSX.Element[] = [];
  const edges: [CompIndex, CompIndex, CompIndex][] = [
    [0, 1, 1],
    [1, 2, 2],
    [2, 0, 0],
  ];
  const [cx, cy] = m.px([1 / 3, 1 / 3, 1 / 3]);
  for (const k of [0, 1, 2] as CompIndex[]) {
    for (let n = 1; n < 10; n++) {
      const v = n / 10;
      const a: Comp = [0, 0, 0];
      const b: Comp = [0, 0, 0];
      a[k] = v;
      a[(k + 1) % 3] = 1 - v;
      b[k] = v;
      b[(k + 2) % 3] = 1 - v;
      const [x1, y1] = m.px(a);
      const [x2, y2] = m.px(b);
      if (grid) lines.push(<line key={`g${k}${n}`} x1={x1} y1={y1} x2={x2} y2={y2} className="tri-grid" />);
    }
  }
  edges.forEach(([a, b, comp]) => {
    for (let n = 1; n < 10; n++) {
      const x = lerpComp(VERTICES[a], VERTICES[b], n / 10);
      const [px, py] = m.px(x);
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.hypot(dx, dy);
      const ex = (dx / len) * 5;
      const ey = (dy / len) * 5;
      ticks.push(<line key={`t${a}${n}`} x1={px} y1={py} x2={px + ex} y2={py + ey} className="tri-tick" />);
      ticks.push(
        <text key={`l${a}${n}`} x={px + ex * 2.6} y={py + ey * 2.6 + 3} className="tick-label" textAnchor="middle">
          {x[comp].toFixed(1)}
        </text>,
      );
    }
    const mid = m.px(lerpComp(VERTICES[a], VERTICES[b], 0.5));
    const dx = mid[0] - cx;
    const dy = mid[1] - cy;
    const len = Math.hypot(dx, dy);
    ticks.push(
      <text key={`ax${comp}`} x={mid[0] + (dx / len) * 30} y={mid[1] + (dy / len) * 30 + 4} className="axis-label" textAnchor="middle">
        x({sym[comp]})
      </text>,
    );
  });
  const vOff: [number, number][] = [
    [-12, 14],
    [12, 14],
    [0, -9],
  ];
  return (
    <g>
      {lines}
      <path d={pathOf(m, [...VERTICES], true)} className="tri-border" />
      {ticks}
      {VERTICES.map((v, n) => {
        const [x, y] = m.px(v);
        return (
          <text key={n} x={x + vOff[n][0]} y={y + vOff[n][1]} className="vertex-label" textAnchor="middle">
            {sym[n]}
          </text>
        );
      })}
    </g>
  );
}
