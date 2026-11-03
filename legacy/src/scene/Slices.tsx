import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { lerpComp, VERTICES } from '../core/barycentric';
import { ALL_REGIONS } from '../core/diagram';
import { formatC, REGION_COLORS, regionTint } from '../core/phases';
import { rasterizeVertical, verticalLine, verticalSectionCurves } from '../core/verticalSection';
import { useStore } from '../state/store';
import { horizontalPolygon } from './geometry';
import { compOfWorld, tOfY, toWorld } from './world';
import { dragState } from './dragState';
import type { Comp } from '../core/types';

type Controls = { enabled: boolean } | null;

function useDrag(onMove: (e: ThreeEvent<PointerEvent>, start: THREE.Vector3) => void) {
  const controls = useThree((s) => s.controls) as unknown as Controls;
  const st = useRef<{ start: THREE.Vector3; id: number; x: number; y: number; moved: boolean } | null>(null);
  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      st.current = { start: e.point.clone(), id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, moved: false };
      dragState.active = true;
      useStore.getState().setHover(null);
      if (controls) controls.enabled = false;
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const d = st.current;
      if (!d) return;
      e.stopPropagation();
      // 超过 3 像素才视为拖动，单击仍可选中切片后方的对象
      if (!d.moved && Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) < 3) return;
      d.moved = true;
      document.body.style.cursor = 'grabbing';
      onMove(e, d.start);
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      const d = st.current;
      if (!d) return;
      (e.target as Element).releasePointerCapture(d.id);
      st.current = null;
      dragState.active = false;
      if (d.moved) dragState.endedAt = performance.now();
      if (controls) controls.enabled = true;
      document.body.style.cursor = '';
    },
  };
}

/** 等温截面：按精确多边形着色的水平切片，可沿温度轴拖动 */
export function IsothermalSlice() {
  const d = useStore((s) => s.diagram);
  const T = useStore((s) => s.T);
  const layer = useStore((s) => s.layers.isoSlice);
  const setT = useStore((s) => s.setT);
  const camera = useThree((s) => s.camera);
  const tr = d.tRange;

  const sec = useMemo(() => d.isothermalSection(T), [d, T]);
  const meshes = useMemo(
    () => sec.regions.map((r) => ({ key: r.key, geometry: horizontalPolygon(r.polygon, T, tr) })),
    [sec],
  );
  const full = useMemo(() => horizontalPolygon([...VERTICES], T, tr), [d, T]);
  const lines = useMemo(() => {
    const out: [number, number, number][][] = [];
    for (const c of sec.isotherms) out.push(c.points.map((p) => toWorld(p, T, tr)));
    for (const t of sec.triangles) out.push([VERTICES[t.i], t.m, VERTICES[t.j]].map((p) => toWorld(p, T, tr)));
    return out;
  }, [sec]);

  const drag = useDrag((e, start) => {
    // 过抓取点、法向为相机水平视线方向的竖直平面
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, start);
    const hit = new THREE.Vector3();
    if (e.ray.intersectPlane(plane, hit)) setT(tOfY(hit.y, tr));
  });

  if (!layer.visible) return null;
  const corner = toWorld(VERTICES[1], T, tr);
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key + m.geometry.uuid} geometry={m.geometry} renderOrder={6}>
          <meshBasicMaterial
            color={REGION_COLORS[m.key]}
            transparent
            opacity={layer.opacity * (m.key === 'L' ? 0.45 : 0.75)}
            side={THREE.DoubleSide}
                forceSinglePass
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh geometry={full} userData={{ pick: 'slice:iso' }} {...drag}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide}
                forceSinglePass />
      </mesh>
      <Line points={[...VERTICES, VERTICES[0]].map((v) => toWorld(v, T, tr))} color="#1f4e79" lineWidth={1.6} />
      {lines.map((p, n) => (
        <Line key={n} points={p} color="#0b0b0b" lineWidth={2} />
      ))}
      <Html position={[corner[0] + 0.12, corner[1], corner[2]]} center zIndexRange={[20, 0]} className="lbl lbl-slice">
        T = {formatC(T)}
      </Html>
    </group>
  );
}

/** 垂直截面：纹理为截面相区栅格（与二维截面同源），边界为精确求交曲线 */
export function VerticalSlice() {
  const d = useStore((s) => s.diagram);
  const vert = useStore((s) => s.vert);
  const layer = useStore((s) => s.layers.vertSlice);
  const setVert = useStore((s) => s.setVert);
  const tr = d.tRange;
  const line = useMemo(() => verticalLine(vert), [vert.mode, vert.k, vert.value]);

  const texture = useMemo(() => {
    const w = 256;
    const h = 256;
    const raster = rasterizeVertical(d, line, w, h, tr);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const pal = ALL_REGIONS.map((k) => new THREE.Color(regionTint(k, 0.55)));
    for (let n = 0; n < raster.length; n++) {
      const c = pal[raster[n]];
      img.data[n * 4] = c.r * 255;
      img.data[n * 4 + 1] = c.g * 255;
      img.data[n * 4 + 2] = c.b * 255;
      // 液相区降低不透明度，减少对后方曲面的遮挡
      img.data[n * 4 + 3] = raster[n] === 0 ? 90 : 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [d, line]);

  const quad = useMemo(() => {
    const a0 = toWorld(line.p1, tr[0], tr);
    const b0 = toWorld(line.p2, tr[0], tr);
    const a1 = toWorld(line.p1, tr[1], tr);
    const b1 = toWorld(line.p2, tr[1], tr);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a0, ...b0, ...b1, ...a1]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return { g, outline: [a0, b0, b1, a1, a0] };
  }, [line]);

  const curves = useMemo(() => {
    const geo = verticalSectionCurves(d, line, 240);
    return geo.curves.map((c) => ({
      kind: c.kind,
      pts: c.points.map((p) => toWorld(lerpComp(line.p1, line.p2, p.s), p.T, tr)),
    }));
  }, [d, line]);

  const drag = useDrag((e, start) => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -start.y);
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    const x = compOfWorld(hit.x, hit.z);
    const k = vert.k;
    const j = (k + 1) % 3;
    const i = (k + 2) % 3;
    if (vert.mode === 'const') setVert({ value: Math.min(0.95, Math.max(0, x[k])) });
    else {
      const xi = Math.max(0, x[i]);
      const xj = Math.max(0, x[j]);
      if (xi + xj > 1e-6) setVert({ value: Math.min(1, Math.max(0, xj / (xi + xj))) });
    }
  });

  if (!layer.visible) return null;
  const top = toWorld(lerpComp(line.p1, line.p2, 0.5) as Comp, tr[1], tr);
  return (
    <group>
      <mesh geometry={quad.g} userData={{ pick: 'slice:vert' }} renderOrder={7} {...drag}>
        <meshBasicMaterial map={texture} transparent opacity={layer.opacity} side={THREE.DoubleSide}
                forceSinglePass depthWrite={false} />
      </mesh>
      <Line points={quad.outline} color="#1f4e79" lineWidth={1.6} />
      {curves.map((c, n) => (
        <Line key={n} points={c.pts} color={c.kind === 'liquidus' ? '#000000' : '#202020'} lineWidth={c.kind === 'liquidus' ? 2.2 : 1.6} />
      ))}
      <Html position={[top[0], top[1] + 0.03, top[2]]} center zIndexRange={[20, 0]} className="lbl lbl-slice">
        垂直截面（可拖动）
      </Html>
    </group>
  );
}
