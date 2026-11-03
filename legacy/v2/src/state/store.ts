import { create } from 'zustand';
import { computeTrace, sampleIndexAtT, type Trace } from '../core/cooling';
import { PhaseDiagram } from '../core/diagram';
import { defaultSection, resolveSection, type SectionConfig } from '../core/sections';
import { getPreset, PRESETS, type Preset } from '../core/presets';
import type { Comp, Equilibrium, SystemParams } from '../core/types';

export type Tab = 'iso' | 'vert' | 'proj' | 'info';

export interface Layers {
  liquidus: boolean;
  opacity: number;
  isotherms: boolean;
  boundaries: boolean;
  arrows: boolean;
  invariants: boolean;
  planes: boolean;
  compounds: boolean;
  binaryFaces: boolean;
  fieldLabels: boolean;
  grid: boolean;
  tieTriangle: boolean;
  path: boolean;
  cutaway: boolean;
  /** 液相面着色：温度（parula）或初晶相 */
  surfaceColor: 'temperature' | 'field';
  /** 温度轴纵向拉伸 */
  tScale: number;
}

export type Selection =
  | { kind: 'invariant'; id: string }
  | { kind: 'curve'; id: string }
  | { kind: 'field'; si: number }
  | { kind: 'compound'; si: number }
  | { kind: 'region'; key: string };

export interface ParamOverride {
  /** 化合物稳定度：−ΔHf / (J·mol⁻¹)，null 表示使用预设 */
  stab: number | null;
  /** 液相相互作用参数（三个二元项统一） / (J·mol⁻¹) */
  omega: number;
  /** 组元熔点偏移 / K（A、B、C） */
  dTm: [number, number, number];
}

export const defaultOverride = (): ParamOverride => ({ stab: null, omega: 0, dTm: [0, 0, 0] });

export const defaultLayers = (): Layers => ({
  liquidus: true,
  opacity: 1,
  isotherms: true,
  boundaries: true,
  arrows: true,
  invariants: true,
  planes: true,
  compounds: true,
  binaryFaces: true,
  fieldLabels: true,
  grid: true,
  tieTriangle: true,
  path: true,
  cutaway: true,
  tScale: 1,
  surfaceColor: 'temperature',
});

export function buildParams(preset: Preset, ov: ParamOverride): SystemParams {
  const p = structuredClone(preset.params);
  if (ov.stab !== null && preset.tunable >= 0) p.compounds[preset.tunable].dHf = -ov.stab;
  p.omega = { AB: ov.omega, AC: ov.omega, BC: ov.omega };
  for (let i = 0; i < 3; i++) p.components[i].Tm += ov.dTm[i];
  return p;
}

function normalize(x: Comp): Comp {
  const a = Math.max(0, x[0]);
  const b = Math.max(0, x[1]);
  const c = Math.max(0, x[2]);
  const s = a + b + c || 1;
  return [a / s, b / s, c / s];
}

function defaultT(d: PhaseDiagram, x: Comp): number {
  const Tl = d.liquidus(x).T;
  let lo = Infinity;
  for (const iv of d.topo.invariants) if (iv.rank === 'ternary') lo = Math.min(lo, iv.T);
  if (!isFinite(lo)) lo = Tl - 150;
  return Math.max(lo + 8, Tl - Math.min(110, (Tl - lo) * 0.45));
}

export interface AppState {
  presetId: string;
  override: ParamOverride;
  diagram: PhaseDiagram;
  x0: Comp;
  T: number;
  /** 不变反应平台内的进度（-1 表示不在平台内） */
  xi: number;
  eq: Equilibrium;
  trace: Trace;
  idx: number;
  playing: boolean;
  speed: number;
  isoOn: boolean;
  vertOn: boolean;
  section: SectionConfig;
  layers: Layers;
  selection: Selection | null;
  tab: Tab;
  focus3d: boolean;
  dockOpen: boolean;
  tourNote: string;

  loadPreset: (id: string) => void;
  setOverride: (p: Partial<ParamOverride>) => void;
  setX0: (x: Comp, keepT?: boolean) => void;
  setComp: (i: 0 | 1 | 2, v: number) => void;
  setT: (T: number) => void;
  setIdx: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setSection: (p: Partial<SectionConfig>) => void;
  setLayers: (p: Partial<Layers>) => void;
  setSel: (s: Selection | null) => void;
  setTab: (t: Tab) => void;
  setFocus: (b: boolean) => void;
  setDockOpen: (b: boolean) => void;
  setIsoOn: (b: boolean) => void;
  setVertOn: (b: boolean) => void;
  setTour: (s: string) => void;
}

function init(presetId: string, ov: ParamOverride) {
  const preset = getPreset(presetId);
  const diagram = new PhaseDiagram(buildParams(preset, ov));
  const x0 = preset.x0;
  const T = defaultT(diagram, x0);
  const trace = computeTrace(diagram, x0);
  const idx = sampleIndexAtT(trace, T);
  return { diagram, x0, T, trace, idx, eq: diagram.equilibrium(x0, T) };
}

const first = init(PRESETS[0].id, defaultOverride());

function initialSection(presetId: string, d: PhaseDiagram): SectionConfig {
  const sec = defaultSection();
  if (d.ns > 3) {
    sec.mode = 'join';
    sec.join = presetId.startsWith('ternary') ? [3, 0] : [3, 2];
  }
  return sec;
}

function stateEq(s: { diagram: PhaseDiagram; x0: Comp; T: number; xi: number; trace: Trace; idx: number }): Equilibrium {
  if (s.xi >= 0) {
    const sm = s.trace.samples[Math.min(s.trace.samples.length - 1, Math.max(0, Math.round(s.idx)))];
    if (sm && sm.xi >= 0) return sm.eq;
  }
  return s.diagram.equilibrium(s.x0, s.T);
}

export const useStore = create<AppState>((set, get) => ({
  presetId: PRESETS[0].id,
  override: defaultOverride(),
  ...first,
  xi: -1,
  playing: false,
  speed: 1,
  isoOn: true,
  vertOn: true,
  section: initialSection(PRESETS[0].id, first.diagram),
  layers: defaultLayers(),
  selection: null,
  tab: 'iso',
  focus3d: false,
  dockOpen: true,
  tourNote: '',

  loadPreset: (id) => {
    const ov = defaultOverride();
    const st = init(id, ov);
    const preset = getPreset(id);
    const sec = initialSection(preset.id, st.diagram);
    set({ presetId: id, override: ov, ...st, xi: -1, playing: false, section: sec, selection: null, tourNote: '' });
  },

  setOverride: (p) => {
    const s = get();
    const ov = { ...s.override, ...p };
    const preset = getPreset(s.presetId);
    const diagram = new PhaseDiagram(buildParams(preset, ov));
    const trace = computeTrace(diagram, s.x0);
    const range = diagram.tRange();
    const T = Math.min(range.Tmax, Math.max(range.Tmin, s.T));
    const idx = sampleIndexAtT(trace, T);
    const sec = { ...s.section };
    if (sec.mode === 'join' && (sec.join[0] >= diagram.ns || sec.join[1] >= diagram.ns)) sec.mode = 'parallel';
    set({ override: ov, diagram, trace, T, idx, xi: -1, section: sec, eq: diagram.equilibrium(s.x0, T), selection: null });
  },

  setX0: (x, keepT) => {
    const s = get();
    const x0 = normalize(x);
    const trace = computeTrace(s.diagram, x0);
    const T = keepT === false ? defaultT(s.diagram, x0) : s.T;
    const idx = sampleIndexAtT(trace, T);
    set({ x0, trace, T, idx, xi: -1, eq: s.diagram.equilibrium(x0, T) });
  },

  setComp: (i, v) => {
    const s = get();
    const x = [...s.x0] as Comp;
    const val = Math.min(1, Math.max(0, v));
    const rest = 1 - x[i];
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    if (rest < 1e-9) {
      x[j] = (1 - val) / 2;
      x[k] = (1 - val) / 2;
    } else {
      const f = (1 - val) / rest;
      x[j] *= f;
      x[k] *= f;
    }
    x[i] = val;
    get().setX0(x);
  },

  setT: (T) => {
    const s = get();
    const range = s.diagram.tRange();
    const t = Math.min(range.Tmax, Math.max(range.Tmin, T));
    const idx = sampleIndexAtT(s.trace, t);
    set({ T: t, idx, xi: -1, eq: s.diagram.equilibrium(s.x0, t) });
  },

  setIdx: (i) => {
    const s = get();
    const n = s.trace.samples.length;
    const idx = Math.min(n - 1, Math.max(0, i));
    const sm = s.trace.samples[Math.round(idx)];
    const next = { idx, T: sm.T, xi: sm.xi };
    set({ ...next, eq: stateEq({ ...s, ...next }) });
  },

  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setSection: (p) => set({ section: { ...get().section, ...p } }),
  setLayers: (p) => set({ layers: { ...get().layers, ...p } }),
  setSel: (selection) => set({ selection }),
  setTab: (tab) => set({ tab }),
  setFocus: (focus3d) => set({ focus3d }),
  setDockOpen: (dockOpen) => set({ dockOpen }),
  setIsoOn: (isoOn) => set({ isoOn }),
  setVertOn: (vertOn) => set({ vertOn }),
  setTour: (tourNote) => set({ tourNote }),
}));

/** 当前截面规格（解析后） */
export function currentSpec(s: AppState) {
  return resolveSection(s.section, s.diagram, s.x0);
}
