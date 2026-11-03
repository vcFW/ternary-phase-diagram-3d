import { create } from 'zustand';
import { clampComp } from '../core/barycentric';
import type { ColormapName } from '../core/colormap';
import { sampleAt, simulateCooling, timeAtT, type CoolingResult } from '../core/cooling';
import type { TernaryEutecticDiagram } from '../core/diagram';
import { buildDiagram, SYSTEMS } from '../core/registry';
import type { Comp, CompIndex, EquilibriumState, ModelParams } from '../core/types';
import { moveCompToSpec, specThrough, type VerticalSpec } from '../core/verticalSection';

/**
 * 全局共享状态：所有视图只读取这里的状态点 (x, T) 与截面参数，
 * 任何一个视图的修改都会同步传播到其余视图。
 */

export type LayerId =
  | 'liquidus'
  | 'isotherms'
  | 'mono'
  | 'points'
  | 'ruled'
  | 'eplane'
  | 'frame'
  | 'isoSlice'
  | 'vertSlice'
  | 'path';

export interface Layer {
  visible: boolean;
  opacity: number;
}

export interface HoverInfo {
  id: string;
  title: string;
  comp?: Comp;
  T?: number;
  extra?: string;
  /** 相对于三维视口的像素坐标 */
  sx: number;
  sy: number;
}

export interface SimState {
  result: CoolingResult;
  t: number;
  playing: boolean;
  speed: number;
}

export type ViewPreset = 'iso' | 'top' | 'front' | 'side';

interface Store {
  systemId: string;
  params: ModelParams;
  diagram: TernaryEutecticDiagram;
  warnings: string[];
  comp: Comp;
  T: number;
  vert: VerticalSpec & { lock: boolean };
  layers: Record<LayerId, Layer>;
  surfaceColor: 'temperature' | 'phase';
  cmap: ColormapName;
  selection: string | null;
  hover: HoverInfo | null;
  /** 二维视图悬停的对象（用于三维联动高亮） */
  linkedHover: string | null;
  sim: SimState;
  camera: { preset: ViewPreset; token: number };

  setComp: (x: Comp) => void;
  setComponent: (i: CompIndex, v: number) => void;
  setT: (T: number) => void;
  setVert: (p: Partial<VerticalSpec & { lock: boolean }>) => void;
  setLayer: (id: LayerId, p: Partial<Layer>) => void;
  setSurfaceColor: (m: 'temperature' | 'phase') => void;
  setCmap: (c: ColormapName) => void;
  select: (id: string | null) => void;
  setHover: (h: HoverInfo | null) => void;
  setLinkedHover: (id: string | null) => void;
  setSystem: (id: string) => void;
  setParams: (p: ModelParams) => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setView: (p: ViewPreset) => void;
}

const DEFAULT_LAYERS: Record<LayerId, Layer> = {
  liquidus: { visible: true, opacity: 1 },
  isotherms: { visible: true, opacity: 0.55 },
  mono: { visible: true, opacity: 1 },
  points: { visible: true, opacity: 1 },
  ruled: { visible: true, opacity: 0.28 },
  eplane: { visible: true, opacity: 0.35 },
  frame: { visible: true, opacity: 1 },
  isoSlice: { visible: true, opacity: 0.55 },
  vertSlice: { visible: false, opacity: 0.6 },
  path: { visible: true, opacity: 1 },
};

const initialSystem = SYSTEMS[0];
const initialDiagram = buildDiagram(initialSystem.meta, initialSystem.params!);
const initialComp: Comp = [0.6, 0.25, 0.15];
const initialT = 800 + 273.15;
const initialSim = simulateCooling(initialDiagram, initialComp);
const initialVert: VerticalSpec & { lock: boolean } = { ...specThrough({ mode: 'const', k: 2, value: 0.15 }, initialComp), lock: true };

function freshSim(d: TernaryEutecticDiagram, x: Comp, T: number, speed: number): SimState {
  const result = simulateCooling(d, x);
  return { result, t: timeAtT(result, T), playing: false, speed };
}

export const useStore = create<Store>((set, get) => ({
  systemId: initialSystem.meta.id,
  params: initialSystem.params!,
  diagram: initialDiagram,
  warnings: [],
  comp: initialComp,
  T: initialT,
  vert: initialVert,
  layers: DEFAULT_LAYERS,
  surfaceColor: 'temperature',
  cmap: 'parula',
  selection: null,
  hover: null,
  linkedHover: null,
  sim: { result: initialSim, t: timeAtT(initialSim, initialT), playing: false, speed: 1 },
  camera: { preset: 'iso', token: 0 },

  setComp: (x0) => {
    const x = clampComp(x0);
    const s = get();
    const vert = s.vert.lock ? { ...s.vert, ...specThrough(s.vert, x) } : s.vert;
    set({ comp: x, vert, sim: freshSim(s.diagram, x, s.T, s.sim.speed) });
  },

  setComponent: (i, v) => {
    const s = get();
    const val = Math.min(1, Math.max(0, v));
    const x = [...s.comp] as Comp;
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    const rest = x[j] + x[k];
    const target = 1 - val;
    // 其余两组元按原比例分配剩余份额，保证总和恒为 100%
    if (rest > 1e-12) {
      x[j] = (x[j] / rest) * target;
      x[k] = (x[k] / rest) * target;
    } else {
      x[j] = target / 2;
      x[k] = target / 2;
    }
    x[i] = val;
    s.setComp(x);
  },

  setT: (T) => {
    const s = get();
    const [a, b] = s.diagram.tRange;
    const Tc = Math.min(b, Math.max(a, T));
    set({ T: Tc, sim: { ...s.sim, t: timeAtT(s.sim.result, Tc), playing: false } });
  },

  setVert: (p) => {
    const s = get();
    const vert = { ...s.vert, ...p };
    if (p.mode !== undefined || p.k !== undefined) {
      // 切换截面类型时重新通过当前成分点
      Object.assign(vert, specThrough(vert, s.comp));
    }
    if (p.lock === true) Object.assign(vert, specThrough(vert, s.comp));
    if (vert.lock && p.value !== undefined) {
      const x = clampComp(moveCompToSpec(vert, s.comp));
      set({ vert, comp: x, sim: freshSim(s.diagram, x, s.T, s.sim.speed) });
      return;
    }
    set({ vert });
  },

  setLayer: (id, p) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...p } } })),
  setSurfaceColor: (m) => set({ surfaceColor: m }),
  setCmap: (c) => set({ cmap: c }),
  select: (id) => set({ selection: id }),
  setHover: (h) => set({ hover: h }),
  setLinkedHover: (id) => set({ linkedHover: id }),

  setSystem: (id) => {
    const entry = SYSTEMS.find((e) => e.meta.id === id);
    if (!entry || !entry.meta.available || !entry.params) return;
    get().setParams(entry.params);
    set({ systemId: id });
  },

  setParams: (p) => {
    const s = get();
    const meta = SYSTEMS.find((e) => e.meta.id === s.systemId)!.meta;
    let d: TernaryEutecticDiagram;
    try {
      d = buildDiagram(meta, p);
    } catch {
      set({ warnings: ['参数无法构成有效相图'] });
      return;
    }
    const warnings = d.validate();
    if (warnings.length) {
      set({ warnings });
      return;
    }
    const T = Math.min(d.tRange[1], Math.max(d.tRange[0], s.T));
    set({ params: p, diagram: d, warnings: [], T, sim: freshSim(d, s.comp, T, s.sim.speed), selection: null });
  },

  play: () => {
    const s = get();
    const t = s.sim.t >= 0.999 ? 0 : s.sim.t;
    set({ sim: { ...s.sim, t, playing: true }, T: sampleAt(s.sim.result, t).T });
  },
  pause: () => set((s) => ({ sim: { ...s.sim, playing: false } })),
  seek: (t) => {
    const s = get();
    const tc = Math.min(1, Math.max(0, t));
    set({ sim: { ...s.sim, t: tc }, T: sampleAt(s.sim.result, tc).T });
  },
  setSpeed: (speed) => set((s) => ({ sim: { ...s.sim, speed } })),
  setView: (preset) => set((s) => ({ camera: { preset, token: s.camera.token + 1 } })),
}));

/** 当前状态点的平衡态：不变反应平台内取冷却模拟的反应进度，其余取精确平衡计算 */
export function currentState(d: TernaryEutecticDiagram, x: Comp, T: number, sim: SimState): EquilibriumState & { xi?: number } {
  const p = sim.result.plateau;
  if (Math.abs(T - p.T) < 1e-6 && sim.t > p.t0 + 1e-9 && sim.t < p.t1 + 1e-9) {
    const s = sampleAt(sim.result, sim.t);
    const phases: EquilibriumState['phases'] = [];
    if (s.fL > 1e-9) phases.push({ phase: 'L', fraction: s.fL, comp: p.liquid });
    ([0, 1, 2] as CompIndex[]).forEach((i) => {
      if (s.fs[i] > 1e-9) {
        const c: Comp = [0, 0, 0];
        c[i] = 1;
        phases.push({ phase: i, fraction: s.fs[i], comp: c });
      }
    });
    return { region: s.fL > 1e-9 ? 'INV' : 'S', phases, liquid: s.fL > 1e-9 ? p.liquid : null, dof: 0, xi: s.xi };
  }
  return d.equilibrium(x, T);
}

// 开发调试：在控制台中访问全局状态
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
