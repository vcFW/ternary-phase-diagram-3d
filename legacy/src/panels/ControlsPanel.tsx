import { useEffect, useState } from 'react';
import { COMPONENT_COLORS, formatC } from '../core/phases';
import { SYSTEMS } from '../core/registry';
import type { CompIndex, ModelParams } from '../core/types';
import { useStore, type LayerId } from '../state/store';
import { NumberField, Section, Segmented, Slider, Toggle } from '../ui/controls';

export function ControlsPanel() {
  return (
    <div className="controls">
      <SystemSection />
      <CompositionSection />
      <TemperatureSection />
      <SliceSection />
      <LayerSection />
    </div>
  );
}

function SystemSection() {
  const systemId = useStore((s) => s.systemId);
  const setSystem = useStore((s) => s.setSystem);
  const entry = SYSTEMS.find((e) => e.meta.id === systemId)!;
  return (
    <Section title="体系与模型">
      <select className="select" value={systemId} onChange={(e) => setSystem(e.target.value)}>
        {SYSTEMS.map((e) => (
          <option key={e.meta.id} value={e.meta.id} disabled={!e.meta.available}>
            {e.meta.name}
          </option>
        ))}
      </select>
      <div className="badge-row">
        <span className="badge edu">教学模型</span>
        <span className="badge">非实测数据</span>
      </div>
      <p className="note">{entry.meta.description}</p>
      <ParamEditor />
    </Section>
  );
}

function ParamEditor() {
  const params = useStore((s) => s.params);
  const setParams = useStore((s) => s.setParams);
  const warnings = useStore((s) => s.warnings);
  const [draft, setDraft] = useState<ModelParams>(params);
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(params), [params]);
  const upd = (fn: (p: ModelParams) => void) => {
    const p: ModelParams = JSON.parse(JSON.stringify(draft));
    fn(p);
    setDraft(p);
  };
  return (
    <div className="param-editor">
      <button className="link-btn" onClick={() => setOpen(!open)}>
        {open ? '收起模型参数' : '编辑模型参数…'}
      </button>
      {open && (
        <>
          <table className="param-table">
            <thead>
              <tr>
                <th>组元</th>
                <th>T_m / °C</th>
                <th>ΔH / kJ·mol⁻¹</th>
              </tr>
            </thead>
            <tbody>
              {draft.components.map((c, i) => (
                <tr key={i}>
                  <td style={{ color: COMPONENT_COLORS[i], fontWeight: 600 }}>{c.symbol}</td>
                  <td>
                    <NumberField value={c.Tm - 273.15} digits={0} step={10} min={300} max={3000} width={70} onCommit={(v) => upd((p) => (p.components[i].Tm = v + 273.15))} />
                  </td>
                  <td>
                    <NumberField value={c.dH / 1000} digits={1} step={1} min={5} max={120} width={70} onCommit={(v) => upd((p) => (p.components[i].dH = v * 1000))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="param-table">
            <thead>
              <tr>
                <th>液相相互作用</th>
                <th>Ω / kJ·mol⁻¹</th>
              </tr>
            </thead>
            <tbody>
              {(['AB', 'BC', 'CA'] as const).map((k) => (
                <tr key={k}>
                  <td>Ω_{k}</td>
                  <td>
                    <NumberField value={draft.omega[k] / 1000} digits={1} step={1} min={-30} max={8} width={70} onCommit={(v) => upd((p) => (p.omega[k] = v * 1000))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <button className="btn primary" onClick={() => setParams(draft)}>
              重新计算相图
            </button>
            <button className="btn" onClick={() => setDraft(params)}>
              撤销
            </button>
          </div>
          {warnings.map((w, n) => (
            <p key={n} className="warn">
              {w}
            </p>
          ))}
          <p className="note">液相线方程 T_i = (ΔH_i + Gᵉˣ_i)/(ΔH_i/T_m,i − R ln x_i)，取 ΔC_p = 0。Ω &lt; 0 表示组元间吸引，Ω = 0 为理想溶液。</p>
        </>
      )}
    </div>
  );
}

function CompositionSection() {
  const comp = useStore((s) => s.comp);
  const setComponent = useStore((s) => s.setComponent);
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  const sum = comp[0] + comp[1] + comp[2];
  const L = d.liquidus(comp);
  return (
    <Section title="成分（摩尔分数）" right={<span className="mono small">Σ = {(sum * 100).toFixed(1)}%</span>}>
      {([0, 1, 2] as CompIndex[]).map((i) => (
        <div className="ctl-row" key={i}>
          <span className="ctl-label" style={{ color: COMPONENT_COLORS[i] }}>
            x({sym[i]})
          </span>
          <Slider value={comp[i] * 100} min={0} max={100} step={0.1} accent={COMPONENT_COLORS[i]} onChange={(v) => setComponent(i, v / 100)} />
          <NumberField value={comp[i] * 100} min={0} max={100} digits={1} unit="%" onCommit={(v) => setComponent(i, v / 100)} />
        </div>
      ))}
      <p className="note">调节任一组元时，其余两组元按原比例分配余量，总和恒为 100%。</p>
      <div className="kv">
        <span>液相线温度</span>
        <b className="mono">{formatC(L.T)}</b>
        <span>初晶相</span>
        <b>{sym[L.primary]}</b>
      </div>
    </Section>
  );
}

function TemperatureSection() {
  const T = useStore((s) => s.T);
  const setT = useStore((s) => s.setT);
  const d = useStore((s) => s.diagram);
  const comp = useStore((s) => s.comp);
  const tr = d.tRange;
  return (
    <Section title="温度">
      <div className="ctl-row">
        <span className="ctl-label">T</span>
        <Slider value={T - 273.15} min={tr[0] - 273.15} max={tr[1] - 273.15} step={0.5} accent="#1f4e79" onChange={(v) => setT(v + 273.15)} />
        <NumberField value={T - 273.15} min={tr[0] - 273.15} max={tr[1] - 273.15} digits={1} unit="°C" width={78} onCommit={(v) => setT(v + 273.15)} />
      </div>
      <div className="row gap wrap">
        <button className="btn sm" onClick={() => setT(d.liquidus(comp).T)}>
          至液相线
        </button>
        <button className="btn sm" onClick={() => setT(d.primaryPathEnd(comp).T)}>
          至单变线
        </button>
        <button className="btn sm" onClick={() => setT(d.eutectic.T + 0.01)}>
          至 T_E⁺
        </button>
        <button className="btn sm" onClick={() => setT(d.eutectic.T - 1)}>
          至 T_E⁻
        </button>
      </div>
      <p className="note">温度同时决定等温截面高度与状态点位置；拖动三维中的等温截面亦可调节。</p>
    </Section>
  );
}

function SliceSection() {
  const vert = useStore((s) => s.vert);
  const setVert = useStore((s) => s.setVert);
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  const j = (vert.k + 1) % 3;
  const i = (vert.k + 2) % 3;
  return (
    <Section title="截面">
      <div className="ctl-row">
        <Toggle checked={layers.isoSlice.visible} onChange={(v) => setLayer('isoSlice', { visible: v })} label="等温截面" />
        <Slider value={layers.isoSlice.opacity} min={0.1} max={1} step={0.01} onChange={(v) => setLayer('isoSlice', { opacity: v })} />
      </div>
      <div className="ctl-row">
        <Toggle checked={layers.vertSlice.visible} onChange={(v) => setLayer('vertSlice', { visible: v })} label="垂直截面" />
        <Slider value={layers.vertSlice.opacity} min={0.1} max={1} step={0.01} onChange={(v) => setLayer('vertSlice', { opacity: v })} />
      </div>
      <div className="ctl-row">
        <span className="ctl-label wide">类型</span>
        <Segmented
          value={vert.mode}
          options={[
            { value: 'const', label: '等含量' },
            { value: 'ratio', label: '过顶点定比' },
          ]}
          onChange={(m) => setVert({ mode: m })}
        />
      </div>
      <div className="ctl-row">
        <span className="ctl-label wide">{vert.mode === 'const' ? '固定组元' : '顶点'}</span>
        <Segmented
          value={String(vert.k) as '0' | '1' | '2'}
          options={sym.map((s, n) => ({ value: String(n) as '0' | '1' | '2', label: s }))}
          onChange={(k) => setVert({ k: Number(k) as CompIndex })}
        />
      </div>
      <div className="ctl-row">
        <span className="ctl-label wide">{vert.mode === 'const' ? `x(${sym[vert.k]})` : `${sym[j]}/(${sym[j]}+${sym[i]})`}</span>
        <Slider value={vert.value} min={0} max={vert.mode === 'const' ? 0.95 : 1} step={0.001} accent="#1f4e79" onChange={(v) => setVert({ value: v })} />
        <NumberField value={vert.value} min={0} max={vert.mode === 'const' ? 0.95 : 1} digits={3} step={0.01} onCommit={(v) => setVert({ value: v })} />
      </div>
      <div className="ctl-row">
        <Toggle checked={vert.lock} onChange={(v) => setVert({ lock: v })} label="锁定成分点（截面始终通过状态点）" />
      </div>
    </Section>
  );
}

const LAYER_LABELS: [LayerId, string, boolean][] = [
  ['liquidus', '液相面（初晶面）', true],
  ['isotherms', '液相面等温线', true],
  ['mono', '单变线（共晶谷线）', false],
  ['points', '不变点 / 熔点', false],
  ['ruled', '直纹面（三相区边界）', true],
  ['eplane', '三元共晶平面', true],
  ['path', '结晶路径', false],
  ['frame', '坐标框架', false],
];

function LayerSection() {
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const surfaceColor = useStore((s) => s.surfaceColor);
  const setSurfaceColor = useStore((s) => s.setSurfaceColor);
  const cmap = useStore((s) => s.cmap);
  const setCmap = useStore((s) => s.setCmap);
  return (
    <Section title="图层与外观">
      {LAYER_LABELS.map(([id, label, op]) => (
        <div className="ctl-row" key={id}>
          <Toggle checked={layers[id].visible} onChange={(v) => setLayer(id, { visible: v })} label={label} />
          {op && <Slider value={layers[id].opacity} min={0.05} max={1} step={0.01} onChange={(v) => setLayer(id, { opacity: v })} />}
        </div>
      ))}
      <div className="ctl-row">
        <span className="ctl-label wide">液相面着色</span>
        <Segmented
          value={surfaceColor}
          options={[
            { value: 'temperature', label: '温度' },
            { value: 'phase', label: '初晶相' },
          ]}
          onChange={setSurfaceColor}
        />
      </div>
      <div className="ctl-row">
        <span className="ctl-label wide">色图</span>
        <Segmented
          value={cmap}
          options={[
            { value: 'parula', label: 'parula' },
            { value: 'viridis', label: 'viridis' },
            { value: 'gray', label: 'gray' },
          ]}
          onChange={setCmap}
        />
      </div>
    </Section>
  );
}
