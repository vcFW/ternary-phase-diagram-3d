import { cel, phaseColor, regionName } from '../core/colors';
import { getPreset } from '../core/presets';
import { useStore } from '../state/store';
import { TERMS, termFull } from '../core/terms';
import type { ReactionType } from '../core/types';

const KIND_DESC: Record<ReactionType, string> = {
  eutectic: '共晶型：液相降温时两固相同时析出（L → α + β），单箭头。',
  transition: `${termFull(TERMS.transition)}：${TERMS.transition.reaction}。液相位于相容三角形之外；α 被回溶。`,
  peritectic: '转熔型：液相降温时先析出相被回溶、新相析出（L + α → β），双箭头。',
};

export function InfoPanel() {
  const d = useStore((s) => s.diagram);
  const sel = useStore((s) => s.selection);
  const presetId = useStore((s) => s.presetId);
  const setSel = useStore((s) => s.setSel);
  const setT = useStore((s) => s.setT);
  const preset = getPreset(presetId);
  const sym = d.params.components.map((c) => c.symbol);
  const pct = (v: number) => (v * 100).toFixed(1);

  let detail: JSX.Element | null = null;
  if (sel?.kind === 'invariant') {
    const iv = d.topo.invariants.find((v) => v.id === sel.id);
    if (iv)
      detail = (
        <div className="info-card">
          <h4>
            <span className="tag">{iv.label}</span> {iv.name}
          </h4>
          <div className="eq">{iv.reaction.text}</div>
          <p>
            温度 <b className="mono">{cel(iv.T, 1)}</b>，液相成分 <span className="mono">{sym[0]} {pct(iv.x[0])} / {sym[1]} {pct(iv.x[1])} / {sym[2]} {pct(iv.x[2])} %</span>
          </p>
          <p>{iv.rank === 'ternary' ? `四相平衡（L + ${iv.solids.length} 固相），F = 4 − 4 = 0：温度与各相成分均固定，冷却时出现恒温平台。` : '二元体系中的三相平衡，F = 0（该二元系内）。'}</p>
          <p>{KIND_DESC[iv.reaction.type]}</p>
          <button className="btn sm" onClick={() => setT(iv.T + 0.3)}>将等温面移到该温度</button>
        </div>
      );
  } else if (sel?.kind === 'curve') {
    const cv = d.topo.curves.find((c) => c.id === sel.id);
    if (cv) {
      const a = d.solids[cv.a].label;
      const b = d.solids[cv.b].label;
      const kinds = Array.from(new Set(cv.pieces.map((p) => p.kind)));
      detail = (
        <div className="info-card">
          <h4>
            <span className="tag">{a}/{b}</span> 界线（单变线）
          </h4>
          <p>
            液相同时对 {a}、{b} 饱和：三相平衡 L + {a} + {b}，F = 4 − 3 = 1。温度范围 {cel(Math.max(...cv.T), 1)} → {cel(Math.min(...cv.T), 1)}。
          </p>
          {cv.pieces.map((p, i) => (
            <p key={i}>
              <b>{p.kind === 'eutectic' ? '共晶型' : `转熔型（${d.solids[p.resorbed].label} 被回溶）`}</b>
              {' — '}
              {p.kind === 'eutectic' ? `L → ${a} + ${b}` : `L + ${d.solids[p.resorbed].label} → ${d.solids[p.resorbed === cv.a ? cv.b : cv.a].label}`}
            </p>
          ))}
          {cv.maxima.length > 0 && <p>界线上存在温度极大点（鞍点）：该处液相成分位于 {a}–{b} 连线（或其延长线）上，沿线向两侧降温。</p>}
          {kinds.length > 1 && <p>该界线中途改变性质（共晶 ↔ 转熔）：切线方向穿过某固相成分点处发生转变。</p>}
        </div>
      );
    }
  } else if (sel?.kind === 'compound') {
    const c = d.topo.compounds.find((q) => q.si === sel.si);
    const s = d.solids[sel.si];
    if (c)
      detail = (
        <div className="info-card">
          <h4>
            <i className="dot" style={{ background: phaseColor(d, s.id) }} /> 化合物 {s.label}（{s.formula}）
          </h4>
          <p>{c.text}</p>
          <p className="mono dim">成分 {sym[0]} {pct(s.n[0])} / {sym[1]} {pct(s.n[1])} / {sym[2]} {pct(s.n[2])} %，ΔHf = {(s.dHf / 1000).toFixed(2)} kJ/mol</p>
          <p>{c.congruent ? '判据：成分点处自身液相线最高，成分点位于自身初晶区内 → 稳定。' : '判据：成分点处别的固相液相线更高，成分点不在自身初晶区内 → 不稳定，加热时发生包晶（转熔）分解。'}</p>
        </div>
      );
  } else if (sel?.kind === 'region') {
    const ids = sel.key.split('+');
    detail = (
      <div className="info-card">
        <h4>{regionName(sel.key)}</h4>
        <p>共存相：{ids.map((i) => (i === 'L' ? '液相 L' : `固相 ${i}`)).join('、')}；相数 P = {ids.length}，一般成分（C = 3）下自由度 F = {Math.max(0, 3 - ids.length + 1)}。</p>
        <p>{ids.length === 1 ? '单相区：成分与温度都可独立变化。' : ids.length === 2 ? '两相区：连结线上的相成分由杠杆规则决定。' : '三相区：连结三角形，三相成分被固定在三角形顶点，F = 1。'}</p>
      </div>
    );
  } else if (sel?.kind === 'field') {
    const s = d.solids[sel.si];
    detail = (
      <div className="info-card">
        <h4>{s.label} 初晶区</h4>
        <p>液相首先对 {s.label} 饱和，降温时最先析出 {s.label}。</p>
      </div>
    );
  }

  return (
    <div className="info">
      {detail ? (
        <div className="info-sel">
          {detail}
          <button className="btn sm ghost" onClick={() => setSel(null)}>清除选择</button>
        </div>
      ) : (
        <p className="dim small">提示：单击三维或液相面投影中的界线、不变点、化合物竖线可查看说明。</p>
      )}
      <h5>本体系要点</h5>
      <ul className="points">
        {preset.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <h5>特征点一览（自动提取）</h5>
      <div className="inv-table">
        {[...d.topo.invariants]
          .sort((a, b) => b.T - a.T)
          .map((iv) => (
            <button key={iv.id} className={`inv-row ${sel?.kind === 'invariant' && sel.id === iv.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'invariant', id: iv.id })}>
              <span className="tag">{iv.label}</span>
              <span className="mono">{cel(iv.T)}</span>
              <span>{iv.reaction.text}</span>
              <em className={iv.reaction.type}>{iv.rank === 'binary' ? (iv.reaction.type === 'eutectic' ? '二元共晶' : '二元包晶') : iv.reaction.type === 'eutectic' ? '共晶' : iv.reaction.type === 'transition' ? '过渡' : '包晶'}</em>
            </button>
          ))}
      </div>
      <h5>读图提示</h5>
      <ul className="points">
        <li>单箭头界线 = 共晶型（L → α + β）；双箭头界线 = 转熔型（L + α → β）；箭头指向降温方向。</li>
        <li>不变点反应类型由液相点与三个固相点的相对位置决定：液相在三角形内 → 共晶；在某一边外侧 → 过渡点；在某顶点对角区 → 包晶点。</li>
        <li>Alkemade 线（相容三角形边）与界线相交处为界线的温度极大点（稳定化合物）。</li>
      </ul>
    </div>
  );
}
