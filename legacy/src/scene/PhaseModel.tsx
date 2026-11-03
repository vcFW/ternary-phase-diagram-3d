import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { lerpComp, VERTICES } from '../core/barycentric';
import { PAIRS, pairId, regionKey1, regionKey2 } from '../core/diagram';
import { formatC, REGION_COLORS } from '../core/phases';
import type { Comp, CompIndex } from '../core/types';
import { useStore } from '../state/store';
import {
  applyColors,
  buildFieldGeometry,
  buildRegionShell,
  buildRuledGeometry,
  horizontalPolygon,
  isothermLevels,
  isothermSegments,
} from './geometry';
import { toWorld } from './world';

const HILITE = '#E8002A';

function isActive(id: string, sel: string | null, hov: string | null) {
  return id === sel || id === hov;
}

export function PhaseModel() {
  const d = useStore((s) => s.diagram);
  const layers = useStore((s) => s.layers);
  const surfaceColor = useStore((s) => s.surfaceColor);
  const cmap = useStore((s) => s.cmap);
  const sel = useStore((s) => s.selection);
  const hov = useStore((s) => s.linkedHover ?? s.hover?.id ?? null);
  const tr = d.tRange;
  const sym = d.params.components.map((c) => c.symbol);

  const fields = useMemo(() => ([0, 1, 2] as CompIndex[]).map((i) => buildFieldGeometry(d, i)), [d]);
  useMemo(() => {
    fields.forEach((f, i) => {
      applyColors(f.geometry, f.temps, surfaceColor, cmap, REGION_COLORS[regionKey1(i as CompIndex)]);
    });
  }, [fields, surfaceColor, cmap]);

  const ruled = useMemo(
    () =>
      PAIRS.flatMap(([i, j]) =>
        ([i, j] as CompIndex[]).map((end) => ({
          id: `ruled:${pairId(i, j)}:${end}`,
          geometry: buildRuledGeometry(d, i, j, end),
          color: REGION_COLORS[regionKey2(i, j)],
        })),
      ),
    [d],
  );
  const eplane = useMemo(() => horizontalPolygon([...VERTICES], d.eutectic.T, tr), [d]);
  const isoSeg = useMemo(() => {
    const lv = isothermLevels(d, 50);
    const major = lv.filter((T) => Math.round(T - 273.15) % 100 === 0);
    const minor = lv.filter((T) => Math.round(T - 273.15) % 100 !== 0);
    return { major: chunk(isothermSegments(d, major)), minor: chunk(isothermSegments(d, minor)) };
  }, [d]);
  const monoLines = useMemo(
    () =>
      Object.values(d.mono).map((m) => {
        const pts = m.samples.filter((_, n) => n % 2 === 0 || n === m.samples.length - 1).map((s) => toWorld(s.y, s.T, tr));
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
        return { id: `mono:${m.id}`, pts, tube: new THREE.TubeGeometry(curve, 160, 0.009, 6, false) };
      }),
    [d],
  );
  // 二元侧壁：液相线与二元共晶水平线
  const binaryLines = useMemo(
    () =>
      PAIRS.map(([i, j]) => {
        const liq = [];
        for (let n = 0; n <= 160; n++) {
          const x = lerpComp(VERTICES[i], VERTICES[j], n / 160);
          liq.push(toWorld(x, d.liquidus(x).T, tr));
        }
        const Tb = d.binary[pairId(i, j)].T;
        return { key: pairId(i, j), liq, eut: [toWorld(VERTICES[i], Tb, tr), toWorld(VERTICES[j], Tb, tr)] };
      }),
    [d],
  );
  const eTie = useMemo(() => VERTICES.map((v) => [toWorld(v, d.eutectic.T, tr), toWorld(d.eutectic.comp, d.eutectic.T, tr)]), [d]);

  // 初晶面边界（位于液相面上），用于选中/悬停高亮
  const fieldOutlines = useMemo(
    () =>
      ([0, 1, 2] as CompIndex[]).map((i) =>
        densifyEdges([...d.primaryFieldPolygon(i), VERTICES[i]]).map((c) => {
          const p = toWorld(c, d.liquidus(c).T, tr);
          return [p[0], p[1] + 0.002, p[2]] as [number, number, number];
        }),
      ),
    [d],
  );

  const selRegion = sel?.startsWith('region:') ? sel.slice(7) : hov?.startsWith('region:') ? hov.slice(7) : null;
  const shell = useMemo(() => (selRegion ? buildRegionShell(d, selRegion) : []), [d, selRegion]);

  const L = layers;
  return (
    <group>
      {L.liquidus.visible &&
        fields.map((f, i) => {
          const id = `field:${i}`;
          const act = isActive(id, sel, hov);
          return (
            <mesh key={id} geometry={f.geometry} userData={{ pick: id }} renderOrder={1}>
              <meshPhongMaterial
                vertexColors
                side={THREE.DoubleSide}
                forceSinglePass
                transparent={L.liquidus.opacity < 0.999 && !act}
                opacity={act ? 1 : L.liquidus.opacity}
                depthWrite={L.liquidus.opacity > 0.6 || act}
                shininess={18}
                specular={new THREE.Color('#222222')}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
                emissive={act ? new THREE.Color('#3a2a00') : new THREE.Color('#000000')}
              />
            </mesh>
          );
        })}

      {L.liquidus.visible &&
        fieldOutlines.map((pts, i) =>
          isActive(`field:${i}`, sel, hov) ? (
            <Line key={`fo${i}`} points={pts} color={HILITE} lineWidth={sel === `field:${i}` ? 3.2 : 2} />
          ) : null,
        )}

      {L.liquidus.visible &&
        binaryLines.map((b) => (
          <group key={b.key}>
            <Line points={b.liq} color="#303030" lineWidth={1.3} />
            <Line points={b.eut} color="#606060" lineWidth={1} dashed dashSize={0.01} gapSize={0.007} />
          </group>
        ))}

      {L.isotherms.visible && L.liquidus.visible && (
        <>
          {isoSeg.major.length > 0 && (
            <Line points={isoSeg.major} segments color="#1e1e1e" lineWidth={1} transparent opacity={L.isotherms.opacity} />
          )}
          {isoSeg.minor.length > 0 && (
            <Line points={isoSeg.minor} segments color="#1e1e1e" lineWidth={0.7} transparent opacity={L.isotherms.opacity * 0.6} />
          )}
        </>
      )}

      {L.ruled.visible &&
        ruled.map((r) => {
          const act = isActive(r.id, sel, hov);
          return (
            <mesh key={r.id} geometry={r.geometry} userData={{ pick: r.id }} renderOrder={3}>
              <meshLambertMaterial
                color={r.color}
                side={THREE.DoubleSide}
                forceSinglePass
                transparent
                opacity={act ? Math.min(0.85, L.ruled.opacity + 0.4) : L.ruled.opacity}
                depthWrite={false}
              />
            </mesh>
          );
        })}

      {L.eplane.visible && (
        <group>
          <mesh geometry={eplane} userData={{ pick: 'eplane' }} renderOrder={2}>
            <meshLambertMaterial
              color={isActive('eplane', sel, hov) ? '#d0a000' : '#8c8c8c'}
              side={THREE.DoubleSide}
                forceSinglePass
              transparent
              opacity={isActive('eplane', sel, hov) ? 0.6 : L.eplane.opacity}
              depthWrite={false}
            />
          </mesh>
          {eTie.map((p, n) => (
            <Line key={n} points={p} color="#555" lineWidth={1} transparent opacity={0.8} />
          ))}
          <Line points={[...VERTICES, VERTICES[0]].map((v) => toWorld(v, d.eutectic.T, tr))} color="#555" lineWidth={1} />
        </group>
      )}

      {L.mono.visible &&
        monoLines.map((m) => {
          const act = isActive(m.id, sel, hov);
          return (
            <group key={m.id}>
              <Line points={m.pts} color={act ? HILITE : '#111111'} lineWidth={act ? 4 : 2.4} />
              <mesh geometry={m.tube} userData={{ pick: m.id }}>
                <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
              </mesh>
            </group>
          );
        })}

      {L.points.visible &&
        d.specialPoints.map((p) => {
          const act = isActive(p.id, sel, hov);
          const pos = toWorld(p.comp, p.T, tr);
          const big = p.kind === 'ternaryEutectic';
          return (
            <group key={p.id} position={pos}>
              <mesh userData={{ pick: p.id }}>
                <sphereGeometry args={[act ? 0.016 : big ? 0.012 : 0.009, 20, 14]} />
                <meshPhongMaterial color={act ? HILITE : p.kind === 'melting' ? '#333' : '#111'} shininess={40} />
              </mesh>
              <Html position={[0, 0.03, 0]} center zIndexRange={[20, 0]} className={`lbl lbl-point${act ? ' lbl-active' : ''}`}>
                {p.kind === 'melting' ? `${sym[p.members[0]]} ${Math.round(p.T - 273.15)}` : `${p.label} ${formatC(p.T, 0)}`}
              </Html>
            </group>
          );
        })}

      {shell.map((g, n) => (
        <mesh key={`sh${n}`} geometry={g} renderOrder={5}>
          <meshLambertMaterial
            color={REGION_COLORS[selRegion!]}
            side={THREE.DoubleSide}
                forceSinglePass
            transparent
            opacity={0.5}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}
    </group>
  );
}

/** 两端点位于同一二元边上的线段加密，使其贴合二元液相线 */
function densifyEdges(pts: Comp[]): Comp[] {
  const out: Comp[] = [];
  for (let n = 0; n < pts.length; n++) {
    const a = pts[n];
    const b = pts[n + 1];
    out.push(a);
    if (!b) continue;
    const sameEdge = [0, 1, 2].some((k) => a[k] < 1e-9 && b[k] < 1e-9);
    if (sameEdge) for (let q = 1; q < 40; q++) out.push(lerpComp(a, b, q / 40));
  }
  return out;
}

function chunk(flat: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let n = 0; n < flat.length; n += 3) out.push([flat[n], flat[n + 1], flat[n + 2]]);
  return out;
}
