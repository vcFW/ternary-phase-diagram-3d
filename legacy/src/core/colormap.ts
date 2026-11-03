/**
 * 科学色图（分段线性插值）。parula 节点近似 MATLAB 默认色图，viridis 节点取自 matplotlib。
 */

export type ColormapName = 'parula' | 'viridis' | 'gray';

const MAPS: Record<ColormapName, [number, number, number][]> = {
  parula: [
    [0.2422, 0.1504, 0.6603],
    [0.2803, 0.2782, 0.9221],
    [0.2440, 0.4358, 0.9988],
    [0.1540, 0.5902, 0.9218],
    [0.0297, 0.7082, 0.8163],
    [0.1938, 0.7758, 0.6251],
    [0.5044, 0.7993, 0.3480],
    [0.8634, 0.7406, 0.1596],
    [0.9892, 0.8136, 0.1885],
    [0.9763, 0.9831, 0.0538],
  ],
  viridis: [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15],
    [0.993, 0.906, 0.144],
  ],
  gray: [
    [0.25, 0.25, 0.25],
    [0.92, 0.92, 0.92],
  ],
};

export function colormap(name: ColormapName, t: number): [number, number, number] {
  const m = MAPS[name];
  const u = Math.min(1, Math.max(0, t)) * (m.length - 1);
  const n = Math.min(m.length - 2, Math.floor(u));
  const f = u - n;
  const a = m[n];
  const b = m[n + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function colormapCss(name: ColormapName, t: number): string {
  const c = colormap(name, t);
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

export function colormapGradient(name: ColormapName, dir = 'to top'): string {
  const stops: string[] = [];
  for (let n = 0; n <= 10; n++) stops.push(`${colormapCss(name, n / 10)} ${n * 10}%`);
  return `linear-gradient(${dir}, ${stops.join(',')})`;
}
