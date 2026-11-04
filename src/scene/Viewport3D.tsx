import { useEffect, useRef, useState } from 'react';
import { colormapGradient } from '../core/colormap';
import { cel, phaseColor, regionName, toC } from '../core/colors';
import type { PhaseDiagram } from '../core/diagram';
import { useStore } from '../state/store';
import { COLOR } from '../ui/tokens';
import { PhaseScene, type HoverInfo } from './PhaseScene';

/** 由拓扑生成线 / 点图例：无转熔线、无过渡点的体系不显示相应条目 */
function legendMarks(d: PhaseDiagram): { text: string; color: string; dot?: boolean }[] {
  const kinds = new Set(d.topo.curves.flatMap((c) => c.pieces.map((p) => p.kind)));
  const pts = new Set(d.topo.invariants.filter((iv) => iv.rank === 'ternary').map((iv) => iv.reaction.type));
  const out: { text: string; color: string; dot?: boolean }[] = [];
  if (kinds.has('eutectic')) out.push({ text: '共晶线 ▸', color: COLOR.line.eutectic });
  if (kinds.has('transition')) out.push({ text: '过渡型转熔线 ▸▸', color: COLOR.line.transition });
  if (kinds.has('peritectic')) out.push({ text: '转熔线 ▸▸', color: COLOR.line.peritectic });
  if (pts.has('eutectic')) out.push({ text: '共晶点 E', color: COLOR.point.eutectic, dot: true });
  if (pts.has('transition')) out.push({ text: '过渡点 U', color: COLOR.point.transition, dot: true });
  if (pts.has('peritectic')) out.push({ text: '包晶点 P', color: COLOR.point.peritectic, dot: true });
  out.push({ text: '结晶路径', color: COLOR.path });
  return out;
}

export function Viewport3D() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PhaseScene | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const d = useStore((s) => s.diagram);
  const sel = useStore((s) => s.selection);
  const setSel = useStore((s) => s.setSel);
  const setTab = useStore((s) => s.setTab);
  const isoOn = useStore((s) => s.isoOn);
  const vertOn = useStore((s) => s.vertOn);
  const setIsoOn = useStore((s) => s.setIsoOn);
  const setVertOn = useStore((s) => s.setVertOn);
  const [hint, setHint] = useState(true);
  const cutaway = useStore((s) => s.layers.cutaway);
  const surfaceColor = useStore((s) => s.layers.surfaceColor);
  const range = d.tRange();
  const setLayers = useStore((s) => s.setLayers);

  useEffect(() => {
    const el = host.current!;
    const sc = new PhaseScene(el, {
      onSetT: (T) => useStore.getState().setT(T),
      onSetX0: (x) => useStore.getState().setX0(x),
      onSection: (p) => useStore.getState().setSection(p),
      onSelect: (s) => {
        useStore.getState().setSel(s);
        if (s && s.kind !== 'field') useStore.getState().setTab('info');
      },
      onHover: setHover,
    });
    scene.current = sc;
    (window as unknown as { __scene: PhaseScene }).__scene = sc;
    const apply = () => {
      const s = useStore.getState();
      sc.setState({ diagram: s.diagram, x0: s.x0, T: s.T, eq: s.eq, trace: s.trace, idx: s.idx, isoOn: s.isoOn, vertOn: s.vertOn, section: s.section, layers: s.layers, selection: s.selection });
    };
    apply();
    const cam = useStore.getState().camera;
    if (cam) sc.setCamera(cam);
    const unsub = useStore.subscribe(apply);
    return () => {
      unsub();
      const c = sc.getCamera();
      if (c) useStore.getState().setCamera(c);
      sc.dispose();
      scene.current = null;
    };
  }, []);

  const snap = () => {
    const url = scene.current?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `三元相图_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
  };

  // 图例条目只列当前体系实际存在的界线 / 不变点类型
  const markLegend = legendMarks(d);

  const selText = (() => {
    if (!sel) return null;
    if (sel.kind === 'invariant') {
      const iv = d.topo.invariants.find((v) => v.id === sel.id);
      return iv ? { title: `${iv.label} · ${iv.name}`, body: `${iv.reaction.text}　${cel(iv.T, 1)}` } : null;
    }
    if (sel.kind === 'field') return { title: `${d.solids[sel.si].label} 初晶面`, body: '液相首先对该固相饱和' };
    if (sel.kind === 'region') return { title: regionName(sel.key), body: '空间包络（层析叠合）已显示' };
    if (sel.kind === 'compound') return { title: `化合物 ${d.solids[sel.si].label}`, body: d.topo.compounds.find((c) => c.si === sel.si)?.text ?? '' };
    return null;
  })();

  return (
    <div className="viewport">
      <div className="vp-host" ref={host} onPointerDown={() => setHint(false)} />
      <div className="vp-toolbar">
        <button onClick={() => scene.current?.setView('iso')}>默认视角</button>
        <button onClick={() => scene.current?.setView('top')} title="俯视即液相面投影">俯视</button>
        <button onClick={() => scene.current?.setView('front')}>正视</button>
        <button onClick={() => scene.current?.setView('side')}>侧视</button>
        <button onClick={() => scene.current?.setView('section')} disabled={!vertOn} title="视线垂直于垂直截面">正对截面</button>
        <span className="sep" />
        <button className={isoOn ? 'on' : ''} onClick={() => setIsoOn(!isoOn)}>等温面</button>
        <button className={vertOn ? 'on' : ''} onClick={() => setVertOn(!vertOn)}>垂直面</button>
        <button className={cutaway ? 'on' : ''} onClick={() => setLayers({ cutaway: !cutaway })} title="隐藏等温面以上的液相面，直接看到等温截面与其下的相图">剖切</button>
        <span className="sep" />
        <button onClick={snap} title="导出当前三维视图为 PNG">截图</button>
      </div>
      <div className="vp-legend">
        {surfaceColor === 'temperature' ? (
          <>
            <div className="lg-title">液相面温度 T / °C</div>
            <div className="cb-bar" style={{ background: colormapGradient('parula', 'to right') }} />
            <div className="cb-ticks mono">
              <span>{toC(range.Tmin).toFixed(0)}</span>
              <span>{toC(range.Tmax).toFixed(0)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="lg-title">初晶面</div>
            {d.solids.map((s) => (
              <div key={s.id} className="lg-row">
                <i style={{ background: phaseColor(d, s.id) }} />
                <span>{s.label}{s.kind !== 'element' ? `（${s.formula}）` : ''}</span>
              </div>
            ))}
          </>
        )}
        {markLegend.length > 0 && <div className="lg-sep" />}
        {markLegend.map((m) => (
          <div key={m.text} className="lg-row"><i className={m.dot ? 'dot' : 'ln'} style={{ background: m.color }} /><span>{m.text}</span></div>
        ))}
      </div>
      {selText && (
        <div className="vp-sel">
          <b>{selText.title}</b>
          <span>{selText.body}</span>
          <div className="row">
            <button className="btn sm" onClick={() => setTab('info')}>详细讲解</button>
            <button className="btn sm ghost" onClick={() => setSel(null)}>清除</button>
          </div>
        </div>
      )}
      {hint && (
        <div className="vp-hint">
          左键旋转 · 滚轮缩放 · 右键平移　|　拖动<b>蓝色球/水平面</b>升降温度 · 拖动<b>红色状态点</b>改变成分 · 拖动<b>深蓝色截面或其端点</b>平移/旋转垂直截面 · 单击截面取点
        </div>
      )}
      {hover && (
        <div className="vp-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>{hover.text}</b>
          {hover.sub && <span>{hover.sub}</span>}
        </div>
      )}
    </div>
  );
}
