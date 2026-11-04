import { useEffect, useState } from 'react';
import { cel, phaseColor, regionName } from '../../core/colors';
import { analyzeCurveAt } from '../../math/curves';
import { fmtNum } from '../../math/linalg';
import type { PointAnalysis } from '../../math/pointAnalysis';
import { parametrize } from '../../math/spaces';
import { navigate } from '../../app/router';
import { InfoPanel } from '../../panels/InfoPanel';
import { cstr, DerivationPanel, pc, ReactionNow, Sec } from '../../panels/PointPanels';
import { invariantAnalyses } from '../../state/derived';
import { useStore } from '../../state/store';
import { Derivation, KV, MatrixView, type Step } from '../../viz/MathView';
import { COLOR } from '../../ui/tokens';

type Tab = 'eq' | 'deriv' | 'sel' | 'info';

const TABS: { id: Tab; label: string }[] = [
  { id: 'eq', label: '相平衡' },
  { id: 'deriv', label: '推导' },
  { id: 'sel', label: '选中对象' },
  { id: 'info', label: '说明' },
];

const KIND_TEXT = { liquid: '液相区', coexist: '液–固共存区', solid: '固相区' } as const;

/** 工作台右侧"检查器"：相平衡 · 推导 · 选中对象 · 说明。几何 / 稳定性 / 演化已移到各分析页，这里只留跳转链接。 */
export function Inspector({ an }: { an: PointAnalysis | null }) {
  const sel = useStore((s) => s.selection);
  const [tab, setTab] = useState<Tab>('eq');
  useEffect(() => {
    if (sel?.kind === 'curve' || sel?.kind === 'invariant') setTab('sel');
    else setTab((t) => (t === 'sel' ? 'eq' : t));
  }, [sel]);
  return (
    <div className="insp">
      <div className="insp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {!an && tab !== 'sel' && tab !== 'info' && <p className="dim">计算中…</p>}
        {an && tab === 'eq' && <EqTab an={an} />}
        {an && tab === 'deriv' && <DerivTab an={an} />}
        {tab === 'sel' && <SelTab />}
        {tab === 'info' && <InfoPanel />}
      </div>
    </div>
  );
}

// ===================================================================== 相平衡
function EqTab({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const mode = useStore((s) => s.mode);
  const xi = useStore((s) => s.xi);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      <Sec title="状态" prov="model">
        <div className="ins-big">
          <span className={`kind ${an.kind}`}>{KIND_TEXT[an.kind]}</span>
          <b>{regionName(an.eq.key)}</b>
        </div>
        <KV
          rows={[
            ['总成分 x₀', <span className="mono">{sym.map((s, i) => `${s} ${pc(an.x0[i])}`).join(' · ')} %</span>],
            ['温度 T', <span className="mono">{cel(an.T, 2)}（{an.T.toFixed(2)} K）</span>],
            ['三维位置 (x_A, x_B, T)', <span className="mono">({an.x0[0].toFixed(4)}, {an.x0[1].toFixed(4)}, {an.T.toFixed(1)} K)</span>],
            ['液相线 T_liq(x₀)', <span className="mono">{cel(an.Tliq, 2)}，初晶 {d.solids[an.liqSi].label}；当前 {an.T >= an.Tliq ? '高于' : '低于'}液相线 {Math.abs(an.T - an.Tliq).toFixed(1)} K</span>],
            ['相律 F = C − P + 1', <span className="mono" title={an.ruleNote || undefined}>P = {an.P} · C = {an.C} · F = {xi >= 0 ? 0 : an.F}{xi >= 0 ? '（不变反应平台）' : ''}</span>],
            ['交互模式', <span>{mode === 'composition' ? '成分探索（x₀ 可变，T 为参数）' : '冷却凝固（x₀ 固定，T 变化）'}</span>],
          ]}
        />
      </Sec>
      <Sec title="平衡相" prov="model">
        <table className="grid">
          <thead>
            <tr>
              <th>相</th>
              <th>类型</th>
              <th>成分 {sym.join('/')}（%）</th>
              <th>分数</th>
            </tr>
          </thead>
          <tbody>
            {an.phases.map((p) => (
              <tr key={p.id + p.si}>
                <td>
                  <i className="swatch" style={{ background: p.si < 0 ? COLOR.phase.liquid : phaseColor(d, p.id) }} />
                  {p.id}
                </td>
                <td>{p.kind === 'liquid' ? '液相（溶液）' : p.kind === 'solution' ? '固溶体' : '化学计量相'}</td>
                <td className="num">{cstr(p.x)}</td>
                <td className="num">
                  <div className="fbar">
                    <span style={{ width: `${p.frac * 100}%`, background: p.si < 0 ? COLOR.phase.liquid : phaseColor(d, p.id) }} />
                  </div>
                  {pc(p.frac)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">相分数以摩尔原子计，由"推导"标签中的线性方程组 A f = b 求得。</p>
      </Sec>
    </>
  );
}

// ===================================================================== 推导
function DerivTab({ an }: { an: PointAnalysis }) {
  const link = (label: string, page: 'linear' | 'thermo' | 'path', sub: string) => (
    <button className="btn sm" onClick={() => navigate(page, sub)}>
      {label} →
    </button>
  );
  return (
    <>
      <ReactionNow an={an} />
      <DerivationPanel an={an} />
      <Sec title="在分析页展开">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {link('几何与向量', 'linear', 'vectors')}
          {link('稳定性', 'thermo', 'stability')}
          {link('演化与相变序列', 'path', 'equilibrium')}
        </div>
        <p className="note">向量 / 连结线几何、相稳定性证书、拖动 x₀ 与冷却的演化，在对应分析页中与本检查器使用同一全局状态。</p>
      </Sec>
    </>
  );
}

// ===================================================================== 选中对象
function SelTab() {
  const d = useStore((s) => s.diagram);
  const sel = useStore((s) => s.selection);
  const setSel = useStore((s) => s.setSel);
  const setT = useStore((s) => s.setT);
  const sym = d.params.components.map((c) => c.symbol);
  if (sel?.kind === 'curve') {
    const cv = d.topo.curves.find((c) => c.id === sel.id);
    if (!cv) return <p className="dim">该界线已不存在（体系已改变）。</p>;
    const cp = parametrize(cv);
    const s = Math.min(cp.length, Math.max(0, sel.s ?? cp.length / 2));
    const a = analyzeCurveAt(d, cv, s);
    const la = d.solids[cv.a].label;
    const lb = d.solids[cv.b].label;
    const ti = a.ti;
    const kind = ti.kind === 'eutectic' ? `共晶型：L → ${la} + ${lb}` : ti.kind === 'peritectic-a' ? `转熔型：L + ${la} → ${lb}` : ti.kind === 'peritectic-b' ? `转熔型：L + ${lb} → ${la}` : '退化（切线平行于连线）';
    const v = a.gd.nullBasis[0];
    const steps: Step[] = [
      { kind: 'known', body: <>界线 L + {la} + {lb}，参数化 p(s)，s = {s.toFixed(4)} / {cp.length.toFixed(4)}；该点 x_L = ({cstr(a.frame.x)}) %，T = {cel(a.frame.T, 2)}。</> },
      { kind: 'govern', title: '几何约束', body: <>液相同时对两个固相饱和：T_{la}(x) = T_{lb}(x) = T —— 两张液相面的交线，F = 4 − 3 = 1。</> },
      { kind: 'op', title: '切向量', body: <>局部二次拟合求 dp/ds：t = ({fmtNum(a.frame.tCool[0], 4)}, {fmtNum(a.frame.tCool[1], 4)})（降温方向），法向 n = ({fmtNum(-a.frame.tCool[1], 4)}, {fmtNum(a.frame.tCool[0], 4)})；dT/ds = {fmtNum(a.frame.dTds, 2)} K。</> },
      {
        kind: 'op',
        title: '切线规则：2×2 线性方程组',
        body: (
          <>
            <MatrixView name="[t | −(b−a)]" M={ti.M} digits={4} />
            <span className="small">p + τt = a + λ(b − a) ⇒ (τ, λ) = ({fmtNum(ti.tau, 4)}, {fmtNum(ti.lambda, 4)})；det = {fmtNum(ti.det, 5)}</span>
          </>
        ),
      },
      { kind: 'result', body: <b>{kind}</b> },
      {
        kind: 'mid',
        title: 'Gibbs–Duhem（热力学约束）',
        body: (
          <>
            <MatrixView name="G" M={a.gd.G} rowLabels={['L', la, lb]} colLabels={['S', 'x_A', 'x_B', 'x_C']} digits={3} />
            <span className="small">零空间 (dT, dμ) ∝ ({v ? v.map((q) => fmtNum(q, 3)).join(', ') : '—'})；dT/|dμ| = {fmtNum(a.dTrel, 4)}。液相落在共轭固相连线上时 dT = 0（Alkemade 极大）。</span>
          </>
        ),
      },
      { kind: 'phys', body: <>液相沿 t 移动时失去的物质（瞬时析出物 x*）位于切线反向延长线与固相连线的交点；λ 越出 [0, 1] 表示需要"负量"的某固相 —— 它正在被回溶。</> },
      { kind: 'valid', body: <>平衡结晶；固溶体时用共轭成分代替名义成分；切线平行于连线时规则失效。</> },
    ];
    return (
      <>
        <div className="row" style={{ marginBottom: 6 }}>
          <b>
            {la}/{lb} 界线
          </b>
          <span className="grow" />
          <button className="btn sm" onClick={() => setT(a.frame.T + 0.2)}>温度设为该点</button>
          <button className="btn sm ghost" onClick={() => setSel(null)}>取消选中</button>
        </div>
        <input type="range" min={0} max={1} step={0.002} value={s / cp.length} style={{ width: '100%' }} onChange={(e) => setSel({ kind: 'curve', id: cv.id, s: parseFloat(e.target.value) * cp.length })} />
        <Derivation title="界线上该点的推导" steps={steps} />
      </>
    );
  }
  if (sel?.kind === 'invariant') {
    const ia = invariantAnalyses(d).find((q) => q.iv.id === sel.id);
    if (!ia) return <p className="dim">该不变点已不存在。</p>;
    const iv = ia.iv;
    const rt = ia.thermo;
    const steps: Step[] = [
      { kind: 'known', body: <>{iv.label}（{iv.name}）：T = {cel(iv.T, 2)}，x_L = ({cstr(iv.x)}) %；共存固相 {iv.solids.map((si, k) => `${d.solids[si].label}(${cstr(iv.solidX[k], 1)})`).join('，')}。</> },
      { kind: 'govern', title: '条件', body: <>{iv.rank === 'ternary' ? '液相同时对三个固相饱和：T_a = T_b = T_c（2 个方程，2 个成分未知量 + T）⇒ 四相共存，F = 4 − 4 = 0：温度与各相成分全部固定。' : '二元边上的三相平衡（该二元系内 F = 0）。'}</> },
      {
        kind: 'op',
        title: '守恒：反应 = 成分矩阵的零空间',
        body: (
          <>
            <MatrixView name="N" M={ia.rx.N} rowLabels={sym} colLabels={ia.phases.map((p) => p.label)} digits={4} />
            <span className="small">rank N = {ia.rx.rank}，dim ker N = {ia.rx.nullDim}；ν = ({ia.rx.nu?.map((q) => fmtNum(q, 4)).join(', ') ?? '—'})，‖Nν‖∞ = {ia.rx.residual.toExponential(1)}</span>
          </>
        ),
      },
      { kind: 'result', body: <><b className="mono">{ia.rx.text}</b>　{ia.rx.message}</> },
      ...(rt
        ? [
            {
              kind: 'mid' as const,
              title: '方向：反应吉布斯能',
              body: (
                <>
                  ΔG_r(T) = ΔH_r − TΔS_r，ΔH_r = {fmtNum(rt.dH, 1)} J/mol，ΔS_r = {fmtNum(rt.dS, 3)}；ΔG_r(T_inv) = {fmtNum(rt.dG(iv.T), 4)}（四相共切面 ⇒ 0）；ΔG_r(T_inv − 10 K) = {fmtNum(rt.dG(iv.T - 10), 2)} J/mol ⇒ 降温时{rt.dG(iv.T - 10) < 0 ? '正向（消耗液相）' : '逆向'}进行。
                </>
              ),
            },
          ]
        : []),
      { kind: 'phys', body: <>ν 的符号 = 液相点关于固相三角形的重心坐标的符号：全正 ⇒ 共晶（重心位）；一负 ⇒ 过渡点（交叉位）；两负 ⇒ 双转熔（共轭位）。冷却曲线上表现为恒温平台，平台长度 ∝ 反应潜热。</> },
      { kind: 'valid', body: <>非退化：三固相成分不共线、液相不在三角形边上。守恒只说明"允许"，平衡与方向需要热力学。</> },
    ];
    return (
      <>
        <div className="row" style={{ marginBottom: 6 }}>
          <b>
            {iv.label} · {iv.name}
          </b>
          <span className="grow" />
          <button className="btn sm" onClick={() => setT(iv.T + 0.3)}>温度设为 T_inv + 0.3 K</button>
          <button className="btn sm ghost" onClick={() => setSel(null)}>取消选中</button>
        </div>
        <Derivation title="不变点推导" steps={steps} />
      </>
    );
  }
  return <p className="dim">在二维图中单击一条界线或一个不变点（E / U / P / e / p），这里将给出它的几何约束、向量关系、反应分类、热力学条件与逐步推导。</p>;
}

