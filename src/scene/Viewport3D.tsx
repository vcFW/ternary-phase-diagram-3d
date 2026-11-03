import { useEffect, useRef, useState } from 'react';
import { colormapGradient } from '../core/colormap';
import { cel, phaseColor, regionName, toC } from '../core/colors';
import { useStore } from '../state/store';
import { PhaseScene, type HoverInfo } from './PhaseScene';

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
  const dockOpen = useStore((s) => s.dockOpen);
  const surfaceColor = useStore((s) => s.layers.surfaceColor);
  const range = d.tRange();
  const setDockOpen = useStore((s) => s.setDockOpen);
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
        <button className={dockOpen ? 'on' : ''} onClick={() => setDockOpen(!dockOpen)} title="显示/隐藏底部冷却过程栏">冷却栏</button>
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
        <div className="lg-sep" />
        <div className="lg-row"><i className="ln" style={{ background: '#1d2229' }} /><span>共晶线 ▸</span></div>
        <div className="lg-row"><i className="ln" style={{ background: '#c00000' }} /><span>转熔线 ▸▸</span></div>
        <div className="lg-row"><i className="dot" style={{ background: '#0072BD' }} /><span>共晶点 E</span></div>
        <div className="lg-row"><i className="dot" style={{ background: '#D95319' }} /><span>过渡点 U</span></div>
        <div className="lg-row"><i className="ln" style={{ background: '#7E2F8E' }} /><span>结晶路径</span></div>
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
