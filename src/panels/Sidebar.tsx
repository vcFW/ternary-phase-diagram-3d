import { cel, phaseColor, solidColor, toC, toK } from '../core/colors';
import { getPreset } from '../core/presets';
import { currentSpec, useStore } from '../state/store';
import { Card, Chip, Segmented, SliderRow, Toggle } from '../ui/controls';
import type { Comp } from '../core/types';

export function Sidebar() {
  return (
    <div className="sidebar">
      <SystemCard />
      <StateCard />
      <ExamplesCard />
      <SectionCard />
      <LayersCard />
    </div>
  );
}

export function SystemCard() {
  const presetId = useStore((s) => s.presetId);
  const d = useStore((s) => s.diagram);
  const setSel = useStore((s) => s.setSel);
  const preset = getPreset(presetId);
  return (
    <Card title={preset.short} sub="体系在顶部全局条中切换">
      <p className="desc">{preset.description}</p>
      <div className="chips">
        {d.topo.compounds.map((c) => {
          const s = d.solids[c.si];
          return (
            <Chip key={s.id} color={solidColor(s.index)} onClick={() => { setSel({ kind: 'compound', si: s.index }); useStore.getState().setTab('info'); }} title={c.text}>
              {s.label}（{s.formula}）· {c.congruent ? '稳定·一致熔融' : '不稳定·不一致熔融'}
            </Chip>
          );
        })}
      </div>
      <p className="note">数据声明：参数为示意值，不代表真实材料；拓扑由热力学模型自动推出。</p>
    </Card>
  );
}

export function StateCard() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const setComp = useStore((s) => s.setComp);
  const setT = useStore((s) => s.setT);
  const range = d.tRange();
  const sym = d.params.components.map((c) => c.symbol);
  const Tl = d.liquidus(x0).T;
  return (
    <Card title="状态点：成分与温度" sub={`Σ = ${((x0[0] + x0[1] + x0[2]) * 100).toFixed(1)}%`}>
      {([0, 1, 2] as const).map((i) => (
        <SliderRow key={i} label={`x(${sym[i]})`} labelWidth={42} color={solidColor(i)} value={x0[i] * 100} min={0} max={100} step={0.5} unit="%" onChange={(v) => setComp(i, v / 100)} />
      ))}
      <div className="hr" />
      <SliderRow label="T" labelWidth={42} value={toC(T)} min={Math.floor(toC(range.Tmin))} max={Math.ceil(toC(range.Tmax))} step={1} unit="°C" onChange={(v) => setT(toK(v))} />
      <div className="chips">
        <Chip onClick={() => setT(Tl + 0.3)} title="将温度设为该成分的液相线温度">液相线 {cel(Tl)}</Chip>
        {d.topo.invariants
          .filter((v) => v.rank === 'ternary')
          .sort((a, b) => b.T - a.T)
          .map((v) => (
            <Chip key={v.id} onClick={() => setT(v.T + 0.3)} title={v.reaction.text}>
              {v.label} {cel(v.T)}
            </Chip>
          ))}
      </div>
      <p className="note">三维中：拖动半透明等温面升降温度；拖动红色状态点改变成分。</p>
    </Card>
  );
}

export function ExamplesCard() {
  const presetId = useStore((s) => s.presetId);
  const preset = getPreset(presetId);
  const setX0 = useStore((s) => s.setX0);
  const setIdx = useStore((s) => s.setIdx);
  const setPlaying = useStore((s) => s.setPlaying);
  const setTour = useStore((s) => s.setTour);
  const tour = useStore((s) => s.tourNote);
  const load = (x: Comp, note: string) => {
    setPlaying(false);
    // 载入示例是程序性地设定 x₀，随后进入冷却凝固模式播放
    setX0(x, false, true);
    setIdx(0);
    setTour(note);
    setPlaying(true);
  };
  return (
    <Card title="典型成分 · 一键演示" sub="载入并播放平衡冷却" collapsible>
      <div className="ex-list">
        {preset.examples.map((e) => (
          <button key={e.name} className="ex" onClick={() => load(e.x, e.note)}>
            <b>{e.name}</b>
            <span className="mono dim">{e.x.map((v) => Math.round(v * 100)).join(' / ')}</span>
          </button>
        ))}
      </div>
      {tour && <p className="tour">{tour}</p>}
      <p className="note">说明基于默认参数；修改热力学参数后结晶路径可能改变。</p>
    </Card>
  );
}

export function SectionCard() {
  const d = useStore((s) => s.diagram);
  const sec = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const isoOn = useStore((s) => s.isoOn);
  const vertOn = useStore((s) => s.vertOn);
  const setIsoOn = useStore((s) => s.setIsoOn);
  const setVertOn = useStore((s) => s.setVertOn);
  const sym = d.params.components.map((c) => c.symbol);
  const switchMode = (mode: typeof sec.mode) => {
    const spec = currentSpec(useStore.getState());
    setSection({ mode, p1: spec.p1, p2: spec.p2 });
    setVertOn(true);
  };
  const joins: [number, number][] = [];
  for (const s of d.solids) {
    if (s.kind !== 'binary' && s.kind !== 'ternary') continue;
    for (let v = 0; v < 3; v++) {
      if (s.kind === 'binary' && s.n[v] > 1e-9) continue;
      joins.push([s.index, v]);
    }
  }
  return (
    <Card title="截面" sub="三维中可直接拖动" collapsible>
      <Toggle checked={isoOn} onChange={setIsoOn} label="等温截面平面（水平，上下拖动改变温度）" />
      <Toggle checked={vertOn} onChange={setVertOn} label="垂直截面平面（拖动本体平移 / 拖动端点旋转）" />
      <div className="sublabel">垂直截面定位方式</div>
      <Segmented size="sm" value={sec.mode} onChange={switchMode} options={[
        { value: 'free', label: '自由' },
        { value: 'parallel', label: '平行边' },
        { value: 'vertex', label: '过顶点' },
        { value: 'point', label: '过状态点' },
        { value: 'join', label: '连线' },
      ]} />
      {sec.mode === 'free' && <p className="note">拖动三维中截面线两端的手柄（沿三角形周界滑动），或拖动截面平面整体平移。</p>}
      {sec.mode === 'parallel' && (
        <>
          <Segmented size="sm" value={sec.fixedComp} onChange={(v) => setSection({ fixedComp: v as 0 | 1 | 2 })} options={sym.map((s, i) => ({ value: i, label: `x(${s}) 恒定` }))} />
          <SliderRow label={`x(${sym[sec.fixedComp]})`} labelWidth={42} value={sec.fixedValue * 100} min={1} max={99} step={0.5} unit="%" onChange={(v) => setSection({ fixedComp: sec.fixedComp, fixedValue: v / 100 })} />
        </>
      )}
      {sec.mode === 'vertex' && (
        <>
          <Segmented size="sm" value={sec.vertex} onChange={(v) => setSection({ vertex: v as 0 | 1 | 2 })} options={sym.map((s, i) => ({ value: i, label: `过 ${s} 顶点` }))} />
          <SliderRow label="比值" labelWidth={42} value={sec.ratio * 100} min={0} max={100} step={0.5} unit="%" onChange={(v) => setSection({ ratio: v / 100 })} />
          <p className="note">对边上点的成分 = {sym[(sec.vertex + 1) % 3]} {((1 - sec.ratio) * 100).toFixed(0)}% : {sym[(sec.vertex + 2) % 3]} {(sec.ratio * 100).toFixed(0)}%（过顶点定比截面）。</p>
        </>
      )}
      {sec.mode === 'point' && <SliderRow label="方位" labelWidth={42} value={((sec.angle * 180) / Math.PI + 360) % 180} min={0} max={180} step={1} unit="°" onChange={(v) => setSection({ angle: (v * Math.PI) / 180 })} />}
      {sec.mode === 'join' && (
        <>
          <div className="chips">
            {joins.map(([si, v]) => (
              <Chip key={`${si}-${v}`} active={sec.join[0] === si && sec.join[1] === v} color={phaseColor(d, d.solids[si].id)} onClick={() => setSection({ join: [si, v] })}>
                {d.solids[si].label}–{sym[v]} 连线
              </Chip>
            ))}
          </div>
          <p className="note">化合物与顶点的连线即 Alkemade 线：稳定化合物的连线是真正的伪二元截面，不稳定化合物的不是。</p>
        </>
      )}
    </Card>
  );
}

export function LayersCard() {
  const L = useStore((s) => s.layers);
  const set = useStore((s) => s.setLayers);
  return (
    <Card title="三维图层" collapsible defaultOpen={false}>
      <div className="grid2">
        <Toggle checked={L.liquidus} onChange={(v) => set({ liquidus: v })} label="液相面" />
        <Toggle checked={L.surfaceColor === 'temperature'} onChange={(v) => set({ surfaceColor: v ? 'temperature' : 'field' })} label="按温度着色（parula）" />
        <Toggle checked={L.isotherms} onChange={(v) => set({ isotherms: v })} label="等温线" />
        <Toggle checked={L.boundaries} onChange={(v) => set({ boundaries: v })} label="界线（单变线）" />
        <Toggle checked={L.arrows} onChange={(v) => set({ arrows: v })} label="降温箭头" />
        <Toggle checked={L.invariants} onChange={(v) => set({ invariants: v })} label="不变点" />
        <Toggle checked={L.planes} onChange={(v) => set({ planes: v })} label="不变反应平面" />
        <Toggle checked={L.compounds} onChange={(v) => set({ compounds: v })} label="化合物竖线" />
        <Toggle checked={L.binaryFaces} onChange={(v) => set({ binaryFaces: v })} label="二元侧面相图" />
        <Toggle checked={L.fieldLabels} onChange={(v) => set({ fieldLabels: v })} label="初晶面标注" />
        <Toggle checked={L.grid} onChange={(v) => set({ grid: v })} label="底面网格" />
        <Toggle checked={L.tieTriangle} onChange={(v) => set({ tieTriangle: v })} label="连结三角形" />
        <Toggle checked={L.path} onChange={(v) => set({ path: v })} label="结晶路径" />
        <Toggle checked={L.cutaway} onChange={(v) => set({ cutaway: v })} label="剖切（隐藏等温面以上）" />
      </div>
      <SliderRow label="温度轴拉伸" labelWidth={92} value={L.tScale} min={0.7} max={2} step={0.05} digits={2} unit="×" onChange={(v) => set({ tScale: v })} />
      <SliderRow label="液相面不透明度" labelWidth={92} value={L.opacity * 100} min={15} max={100} step={1} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
    </Card>
  );
}
