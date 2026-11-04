import { useEffect, useRef, useState } from 'react';
import { regionName, solidColor, toC, toK } from '../core/colors';
import { getPreset, PRESETS } from '../core/presets';
import { phaseRule, phaseRuleText } from '../math/phaseRule';
import { useStore } from '../state/store';
import { Drop, NumField, SliderRow } from '../ui/controls';

/**
 * 全局控制条：只放"所有页面共享的物理状态"——体系、总成分、温度、热力学参数。
 * 页面专属控件一律放在各页面内部，二者在视觉上分开（本条为深色底条）。
 */
export function GlobalBar({ page }: { page: string }) {
  const presetId = useStore((s) => s.presetId);
  const pendingPreset = useStore((s) => s.pendingPreset);
  const computing = useStore((s) => s.computing);
  const loadPreset = useStore((s) => s.loadPreset);
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const T = useStore((s) => s.T);
  const eq = useStore((s) => s.eq);
  const xi = useStore((s) => s.xi);
  const setComp = useStore((s) => s.setComp);
  const setT = useStore((s) => s.setT);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const notice = useStore((s) => s.notice);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  useEffect(() => {
    if (!notice) return;
    setShowNotice(true);
    const t = setTimeout(() => setShowNotice(false), 3800);
    return () => clearTimeout(t);
  }, [notice]);
  const [copied, setCopied] = useState(false);
  const rule = phaseRule(d, eq, x0, xi >= 0);
  const range = d.tRange();
  const sym = d.params.components.map((c) => c.symbol);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用 */
    }
  };
  return (
    <header className="gbar">
      {computing && <div className="gbar-progress" role="progressbar" aria-label="正在计算相图" />}
      <div className="gbar-page">{page}</div>
      <div className="gbar-sep" />
      <label className="gbar-field">
        <span>体系</span>
        <select value={pendingPreset ?? presetId} onChange={(e) => loadPreset(e.target.value)} title={getPreset(presetId).description}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.short}
            </option>
          ))}
        </select>
      </label>
      <div className="gbar-mode" role="tablist" aria-label="交互模式">
        <button className={mode === 'composition' ? 'on' : ''} onClick={() => setMode('composition')} title="成分探索：改变总成分 x₀，温度作为参数">
          <span className="gb-full">成分探索</span>
          <span className="gb-short">探索</span>
        </button>
        <button className={mode === 'cooling' ? 'on' : ''} onClick={() => setMode('cooling')} title="冷却凝固：x₀ 固定，只改变温度，观察液相成分与相分数的演化">
          <span className="gb-full">冷却凝固</span>
          <span className="gb-short">冷却</span>
        </button>
      </div>
      <div className={`gbar-field comp ${mode === 'cooling' ? 'locked' : ''}`} title={mode === 'cooling' ? '冷却凝固模式：总成分固定（封闭体系）；切换到"成分探索"才能修改' : undefined}>
        <span>x₀{mode === 'cooling' ? ' 🔒' : ''}</span>
        {([0, 1, 2] as const).map((i) => (
          <span key={i} className="gbar-num" style={{ ['--c' as string]: solidColor(i) } as React.CSSProperties}>
            <i>{sym[i]}</i>
            {mode === 'cooling' ? <span className="gbar-ro mono">{(x0[i] * 100).toFixed(1)}</span> : <NumField value={x0[i] * 100} min={0} max={100} step={1} digits={1} width={44} onCommit={(v) => setComp(i, v / 100)} />}
          </span>
        ))}
        <span className="dim">%</span>
      </div>
      <div className="gbar-field">
        <span>T</span>
        <NumField value={toC(T)} min={Math.floor(toC(range.Tmin))} max={Math.ceil(toC(range.Tmax))} step={1} digits={1} width={56} onCommit={(v) => setT(toK(v))} />
        <span className="dim">°C</span>
      </div>
      {/* 状态读数：≥1440 完整；1280–1439 缩写；<1280 折叠为可点击徽章（点击弹出详情） */}
      <div className="gbar-state" title="当前总成分与温度下的平衡相组合（PhaseDiagram 模型计算）">
        <b>
          <span className="gb-full">{regionName(eq.key).replace(/^.*?：/, '')}</span>
          <span className="gb-short">{eq.key}</span>
        </b>
        <span className="mono" title={rule.reason || undefined}>{phaseRuleText(rule)}</span>
        {eq.warning && <span className="warn-badge" title={eq.warning}>⚠ 求解未完全收敛</span>}
      </div>
      <Drop className="gbtn gbar-badge" panelClass="gbar-panel" title="当前平衡态读数（点击查看详情）" label={<span className="mono">{eq.key} · F{rule.F}</span>}>
        <div className="gbar-detail">
          <b>{regionName(eq.key)}</b>
          <span className="mono">{phaseRuleText(rule)}</span>
          {rule.reason && <span className="small">{rule.reason}</span>}
          {eq.warning && <span className="warn-badge">⚠ {eq.warning}</span>}
        </div>
      </Drop>
      <div className="grow" />
      <span className="gbar-tag" title="全部参数为假想组元的示意值，不代表任何真实材料">示意模型 · 非真实材料数据</span>
      <Drop className="gbtn gbar-more" panelClass="gbar-panel" title="更多" label="⋯">
        <div className="gbar-detail">
          <span className="gbar-tag static">示意模型 · 非真实材料数据</span>
          <span className="small">全部参数为假想组元的示意值，不代表任何真实材料。</span>
        </div>
      </Drop>
      <div className="gbar-pop">
        <button className={`gbtn ${paramsOpen ? 'on' : ''}`} onClick={() => setParamsOpen(!paramsOpen)}>
          <span className="gb-full">热力学参数</span>
          <span className="gb-short">参数</span>
        </button>
        {paramsOpen && <ParamsPopover onClose={() => setParamsOpen(false)} />}
      </div>
      <button className="gbtn" onClick={copy} title="复制包含当前页面与物理状态的深链接">
        <span className="gb-full">{copied ? '已复制' : '复制链接'}</span>
        <span className="gb-short">{copied ? '✓' : '链接'}</span>
      </button>
      {notice && showNotice && <div className="gbar-notice" onClick={() => setShowNotice(false)}>{notice.text}</div>}
    </header>
  );
}

function ParamsPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.gbar-pop')) onClose();
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  return (
    <div className="popover" ref={ref}>
      <div className="pop-head">
        <b>热力学参数</b>
        <span className="dim small">全局：改变后所有页面的相图、平衡与推导同步重算</span>
      </div>
      <ParamsEditor />
    </div>
  );
}

/** 全局热力学参数编辑器（全局条弹出框与"数学实验"页共用） */
export function ParamsEditor() {
  const presetId = useStore((s) => s.presetId);
  const ov = useStore((s) => s.override);
  const set = useStore((s) => s.setOverride);
  const d = useStore((s) => s.diagram);
  const preset = getPreset(presetId);
  const stab = ov.stab ?? -(preset.tunable >= 0 ? preset.params.compounds[preset.tunable].dHf : 0);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      {preset.tunable >= 0 && (
        <SliderRow label="化合物稳定度 −ΔHf" labelWidth={118} value={stab / 1000} min={0.2} max={6} step={0.05} digits={2} unit="kJ" onChange={(v) => set({ stab: v * 1000 })} />
      )}
      <SliderRow label="液相相互作用 Ω" labelWidth={118} value={ov.omega / 1000} min={-8} max={6} step={0.25} digits={2} unit="kJ" onChange={(v) => set({ omega: v * 1000 })} />
      {([0, 1, 2] as const).map((i) => (
        <SliderRow
          key={i}
          label={`${sym[i]} 熔点偏移`}
          labelWidth={118}
          color={solidColor(i)}
          value={ov.dTm[i]}
          min={-200}
          max={200}
          step={5}
          digits={0}
          unit="K"
          onChange={(v) => {
            const t = [...ov.dTm] as [number, number, number];
            t[i] = v;
            set({ dTm: t });
          }}
        />
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => set({ stab: null, omega: 0, dTm: [0, 0, 0] })}>
          恢复预设参数
        </button>
        <span className="note">模型：液相正规溶液 + 化学计量固相 / 固溶体（见“数学实验与验证 · 模型假设”）。</span>
      </div>
    </>
  );
}
