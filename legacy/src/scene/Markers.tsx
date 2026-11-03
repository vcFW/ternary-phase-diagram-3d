import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import { VERTICES } from '../core/barycentric';
import type { Comp } from '../core/types';
import { currentState, useStore } from '../state/store';
import { toWorld } from './world';

const STATE_COLOR = '#C00000';
const LIQ_COLOR = '#1f4e79';

/** 成分点竖线、状态点、液相成分点、连结线 / 连结三角形，以及结晶路径 */
export function Markers() {
  const d = useStore((s) => s.diagram);
  const x = useStore((s) => s.comp);
  const T = useStore((s) => s.T);
  const sim = useStore((s) => s.sim);
  const showPath = useStore((s) => s.layers.path.visible);
  const tr = d.tRange;

  const st = currentState(d, x, T, sim);
  const p = toWorld(x, T, tr);
  const base = toWorld(x, tr[0], tr);
  const topP = toWorld(x, tr[1], tr);
  const liq = d.liquidus(x);
  const pL = toWorld(x, liq.T, tr);

  const path = useMemo(() => sim.result.path.map((q) => toWorld(q.comp, q.T, tr)), [sim.result]);
  const pathBase = useMemo(() => sim.result.path.map((q) => toWorld(q.comp, tr[0], tr)), [sim.result]);
  const doneIdx = sim.result.path.findIndex((q) => q.T < T);
  const done = doneIdx < 0 ? path : path.slice(0, Math.max(1, doneIdx));

  // 连结线
  const ties: [number, number, number][][] = [];
  const solids = st.phases.filter((ph) => ph.phase !== 'L').map((ph) => ph.phase as number);
  if (st.liquid && solids.length >= 1 && st.region !== 'L') {
    const y = toWorld(st.liquid, T, tr);
    if (solids.length === 1) ties.push([toWorld(VERTICES[solids[0]], T, tr), y]);
    else if (solids.length >= 2) {
      for (const s of solids) ties.push([toWorld(VERTICES[s], T, tr), y]);
      if (solids.length === 2) ties.push([toWorld(VERTICES[solids[0]], T, tr), toWorld(VERTICES[solids[1]], T, tr)]);
    }
  }

  return (
    <group>
      <Line points={[base, topP]} color={STATE_COLOR} lineWidth={1.2} dashed dashSize={0.012} gapSize={0.008} />
      <mesh position={base}>
        <cylinderGeometry args={[0.012, 0.012, 0.002, 24]} />
        <meshBasicMaterial color={STATE_COLOR} />
      </mesh>
      {/* 液相线穿透点 */}
      <mesh position={pL}>
        <torusGeometry args={[0.014, 0.0025, 8, 32]} />
        <meshBasicMaterial color={STATE_COLOR} />
      </mesh>
      {ties.map((t, n) => (
        <Line key={n} points={t} color={LIQ_COLOR} lineWidth={1.8} />
      ))}
      {st.liquid && st.region !== 'L' && (
        <mesh position={toWorld(st.liquid as Comp, T, tr)}>
          <sphereGeometry args={[0.0105, 20, 14]} />
          <meshPhongMaterial color="#ffffff" emissive={LIQ_COLOR} emissiveIntensity={0.25} />
        </mesh>
      )}
      <mesh position={p}>
        <sphereGeometry args={[0.013, 24, 16]} />
        <meshPhongMaterial color={STATE_COLOR} shininess={60} />
      </mesh>
      <Html position={[p[0] + 0.035, p[1] + 0.02, p[2]]} zIndexRange={[25, 0]} className="lbl lbl-state">
        P
      </Html>

      {showPath && path.length > 1 && (
        <>
          <Line points={path} color={STATE_COLOR} lineWidth={1} transparent opacity={0.45} />
          {done.length > 1 && <Line points={done} color={STATE_COLOR} lineWidth={2.6} />}
          <Line points={pathBase} color={STATE_COLOR} lineWidth={1} dashed dashSize={0.01} gapSize={0.007} transparent opacity={0.7} />
        </>
      )}
    </group>
  );
}
