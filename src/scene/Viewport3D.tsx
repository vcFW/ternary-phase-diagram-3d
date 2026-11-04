import { useEffect, useRef, useState } from 'react';
import { colormapGradient } from '../core/colormap';
import { cel, phaseColor, regionName, toC } from '../core/colors';
import type { PhaseDiagram } from '../core/diagram';
import { LayersCard } from '../panels/Sidebar';
import { useStore } from '../state/store';
import { Drop } from '../ui/controls';
import { TERMS } from '../core/terms';
import { COLOR } from '../ui/tokens';
import { PhaseScene, type HoverInfo } from './PhaseScene';

/** 由拓扑生成线 / 点图例：无转熔线、无过渡点的体系不显示相应条目 */
function legendMarks(d: PhaseDiagram): { text: string; color: string; dot?: boolean }[] {
  const kinds = new Set(d.topo.curves.flatMap((c) => c.pieces.map((p) => p.kind)));
  const pts = new Set(d.topo.invariants.filter((iv) => iv.rank === 'ternary').map((iv) => iv.reaction.type));
  const out: { text: string; color: string; dot?: boolean }[] = [];
  if (kinds.has('eutectic')) out.push({ text: `${TERMS.eutecticLine.short} ▸`, color: COLOR.line.eutectic });
  if (kinds.has('transition')) out.push({ text: `过渡型${TERMS.peritecticLine.short} ▸▸`, color: COLOR.line.transition });
  if (kinds.has('peritectic')) out.push({ text: `${TERMS.peritecticLine.short} ▸▸`, color: COLOR.line.peritectic });
  if (pts.has('eutectic')) out.push({ text: `${TERMS.eutectic.short} ${TERMS.eutectic.symbol}`, color: COLOR.point.eutectic, dot: true });
  if (pts.has('transition')) out.push({ text: `${TERMS.transition.short} ${TERMS.transition.symbol}`, color: COLOR.point.transition, dot: true });
  if (pts.has('peritectic')) out.push({ text: `${TERMS.peritectic.short} ${TERMS.peritectic.symbol}`, color: COLOR.point.peritectic, dot: true });
  out.push({ text: '结晶路径', color: COLOR.path });
  return out;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function IconBtn({ title, d, on, disabled, onClick }: { title: string; d: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`vp-ib ${on ? 'on' : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <Icon d={d} />
    </button>
  );
}

export function Viewport3D() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PhaseScene | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const d = useStore((s) => s.diagram);
  const sel = useStore((s) => s.selection);
  const setSel = useStore((s) => s.setSel);
  const setTab = useStore((s) => s.setTab);
  const T = useStore((s) => s.T);
  const isoOn = useStore((s) => s.isoOn);
  const vertOn = useStore((s) => s.vertOn);
  const setIsoOn = useStore((s) => s.setIsoOn);
  const setVertOn = useStore((s) => s.setVertOn);
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
      <div className="vp-host" ref={host} />
      <div className="vp-toolbar" role="toolbar" aria-label="三维视图工具">
        <IconBtn title="默认视角（等轴测）" onClick={() => scene.current?.setView('iso')} d="M8 2 14 5.5v5L8 14 2 10.5v-5z M8 2v6 M2 5.5 8 8l6-2.5" />
        <IconBtn title="俯视（即液相面投影）" onClick={() => scene.current?.setView('top')} d="M2 3h12v10H2z M2 8h12 M8 3v10" />
        <IconBtn title="正视" onClick={() => scene.current?.setView('front')} d="M3 4h10v8H3z" />
        <IconBtn title="侧视" onClick={() => scene.current?.setView('side')} d="M5 3h6v10H5z" />
        <IconBtn title="正对截面（视线垂直于垂直截面）" disabled={!vertOn} onClick={() => scene.current?.setView('section')} d="M3 13 6 3h7l-3 10z" />
        <span className="sep" />
        <IconBtn title="等温面（可拖动升降温度）" on={isoOn} onClick={() => setIsoOn(!isoOn)} d="M2 10 8 13l6-3-6-3z M2 7l6 3 6-3" />
        <IconBtn title="垂直截面平面" on={vertOn} onClick={() => setVertOn(!vertOn)} d="M5 2h6v12H5z M8 2v12" />
        <IconBtn title="剖切：隐藏等温面以上的液相面，直接看到等温截面与其下的相图" on={cutaway} onClick={() => setLayers({ cutaway: !cutaway })} d="M2 13 14 3 M3 3l4 4 M3 13l4-4" />
        <span className="sep" />
        <Drop className="vp-ib" panelClass="vp-drop-panel" title="三维图层" label={<Icon d="M8 2 14 5 8 8 2 5z M2 8l6 3 6-3 M2 11l6 3 6-3" />}>
          <LayersCard />
        </Drop>
        <IconBtn title="导出当前三维视图为 PNG" onClick={snap} d="M2 5h3l1-2h4l1 2h3v8H2z M8 6.5a2.2 2.2 0 1 0 .01 0" />
      </div>
      <div className="vp-tbadge mono" title="当前等温面温度（在顶栏修改；可拖动三维中的蓝色球 / 水平面）">T = {cel(T)}</div>
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
      {hover && (
        <div className="vp-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>{hover.text}</b>
          {hover.sub && <span>{hover.sub}</span>}
        </div>
      )}
    </div>
  );
}
