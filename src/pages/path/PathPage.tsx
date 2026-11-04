import { useMemo } from 'react';
import { cel, phaseColor, toC } from '../../core/colors';
import type { TraceSample } from '../../core/cooling';
import type { PhaseDiagram } from '../../core/diagram';
import { conservationResidual } from '../../math/lever';
import { fmtNum } from '../../math/linalg';
import { phaseRule, phaseRuleText } from '../../math/phaseRule';
import { CoolingTransport } from '../../panels/CoolingTransport';
import { useScheil } from '../../state/asyncCompute';
import { EvolutionPanel } from '../../panels/PointPanels';
import { invariantAnalyses, usePointAnalysis } from '../../state/derived';
import { useStore } from '../../state/store';
import { AnalysisLayout, PageTitle, useSection, type Section } from '../../viz/PageLayout';
import { Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { XYPlot, type Series } from '../../viz/XYPlot';
import { KV, MatrixView, Panel, Prov } from '../../viz/MathView';
import { COLOR } from '../../ui/tokens';
import { TeXBlock } from '../../viz/TeX';

const SECTIONS: Section[] = [
  { id: 'equilibrium', title: '平衡冷却逐步推演', sub: '守恒方程 · 事件 · 反应矩阵' },
  { id: 'scheil', title: '平衡 vs Scheil（非平衡极限）', sub: '明确的假设与适用范围' },
  { id: 'projection', title: '只有二维投影时', sub: '哪些量不能唯一重建' },
];

export default function PathPage() {
  const cur = useSection(SECTIONS);
  return (
    <AnalysisLayout page="path" sections={SECTIONS} current={cur} note={<>总成分 x₀ 在封闭体系中固定不变；随温度演化的是液相成分 x_L 与各相分数。</>}>
      {cur === 'equilibrium' && <EquilibriumSection />}
      {cur === 'scheil' && <ScheilSection />}
      {cur === 'projection' && <ProjectionLimits />}
    </AnalysisLayout>
  );
}

function fracSeries(d: PhaseDiagram, samples: TraceSample[]): Series[] {
  const ids = Array.from(new Set(samples.flatMap((s) => s.eq.phases.map((p) => p.id))));
  return ids.map((id) => ({
    id,
    pts: samples.map((s) => [s.t, s.eq.phases.find((p) => p.id === id)?.frac ?? 0] as [number, number]),
    color: id === 'L' ? COLOR.phase.liquid : phaseColor(d, id),
    label: id === 'L' ? '液相 L' : id,
  }));
}

function EquilibriumSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const setIdx = useStore((s) => s.setIdx);
  const eq = useStore((s) => s.eq);
  const xi = useStore((s) => s.xi);
  const sym = d.params.components.map((c) => c.symbol);
  const S = trace.samples;
  const cur = S[Math.min(S.length - 1, Math.round(idx))];
  const fs = useMemo(() => fracSeries(d, S), [d, S]);
  const Tc: Series[] = useMemo(() => [{ id: 'T', pts: S.map((s) => [s.t, toC(s.T)] as [number, number]), color: COLOR.ink, label: '冷却曲线 T(t)' }], [S]);
  const xl: Series[] = useMemo(() => {
    const L = S.filter((s) => s.eq.phases.some((p) => p.si < 0));
    return [0, 1, 2].map((i) => ({ id: `x${i}`, pts: L.map((s) => [s.t, s.eq.phases.find((p) => p.si < 0)!.x[i]] as [number, number]), color: COLOR.component[i], label: `x_L(${sym[i]})` }));
  }, [S, sym]);
  const res = conservationResidual(eq.phases, x0);
  const rule = phaseRule(d, eq, x0, xi >= 0);
  const inv = invariantAnalyses(d);
  const an = usePointAnalysis();
  const tNow = cur?.t ?? 0;
  const evLines = trace.events.map((e) => ({ x: e.t, color: e.plateau ? COLOR.stateX0 : COLOR.muted }));
  return (
    <>
      <PageTitle title="平衡冷却逐步推演" desc="每一时刻都满足同一组守恒方程 x₀ = Σ fᵢcᵢ；改变的只是参与方程的相与各相成分。" />
      <div className="cols c12">
        <div className="stack">
          <Panel title="液相路径与当前连结三角形" prov="model" sub="拖动 x₀；温度由下方进度条控制">
            <div className="plot-box">
              <TernaryPlot d={d} background="fields" onPick={(x) => setX0(x, false)}>
                {(m) => {
                  const P = eq.phases.map((p) => m.px(p.x));
                  return (
                    <>
                      <polyline points={trace.liquidPath.map((p) => m.px(p.x).join(',')).join(' ')} fill="none" stroke={COLOR.path} strokeWidth={2.4} />
                      {P.length === 3 && <polygon points={P.map((p) => p.join(',')).join(' ')} className="tri-fill" />}
                      {P.length === 2 && <line x1={P[0][0]} y1={P[0][1]} x2={P[1][0]} y2={P[1][1]} className="lnk" strokeWidth={1.8} />}
                      {P.length === 4 && <polygon points={P.map((p) => p.join(',')).join(' ')} className="tri-fill bad" />}
                      {eq.phases.map((p, k) => (
                        <circle key={k} cx={P[k][0]} cy={P[k][1]} r={p.si < 0 ? 5 : 4} fill={p.si < 0 ? COLOR.phase.liquid : phaseColor(d, p.id)} stroke={COLOR.ink} />
                      ))}
                      <Handle m={m} x={x0} onDrag={(x) => setX0(x, false)} label="x₀（固定）" />
                    </>
                  );
                }}
              </TernaryPlot>
            </div>
            <CoolingTransport />
          </Panel>
          <Panel title="当前时刻的守恒方程" prov="math">
            <TeXBlock>{`x_0 = ${eq.phases.map((p) => `${fmtNum(p.frac, 4)}\\,\\mathrm{${p.id}}`).join(' + ')}`}</TeXBlock>
            <MatrixView
              name="[C | x₀]"
              M={[0, 1, 2].map((i) => [...eq.phases.map((p) => p.x[i]), x0[i]])}
              rowLabels={sym}
              colLabels={[...eq.phases.map((p) => p.id), 'x₀']}
              colColors={[...eq.phases.map((p) => (p.si < 0 ? COLOR.phase.liquid : phaseColor(d, p.id))), COLOR.ink]}
              aug={eq.phases.length}
            />
            <KV
              rows={[
                ['f', <span className="mono">({eq.phases.map((p) => fmtNum(p.frac, 5)).join(', ')})</span>],
                ['残差 ‖Σfc − x₀‖∞ / |Σf − 1| / min f', <span className="mono">{res.mass.toExponential(1)} / {res.norm.toExponential(1)} / {fmtNum(res.min, 4)}</span>],
                ['P / C / F', <span className="mono" title={rule.reason || undefined}>{rule.P} / {rule.C} / {rule.F}</span>],
              ]}
            />
          </Panel>
        </div>
        <div className="stack">
          <Panel title="相分数、冷却曲线与液相成分（横轴：放热进度 t）" prov="model" sub="t ∝ 释放的热量（焓平衡），平台长度 ∝ 潜热">
            <XYPlot height={190} series={fs} ylim={[0, 1]} xlim={[0, 100]} ylabel="相分数 f" vlines={[...evLines, { x: tNow, color: COLOR.stateX0, dash: '' }]} onPick={(x) => setIdx(S.findIndex((s) => s.t >= x))} />
            <XYPlot height={160} series={Tc} xlim={[0, 100]} ylabel="T / °C" vlines={[{ x: tNow, color: COLOR.stateX0, dash: '' }]} legend={false} onPick={(x) => setIdx(S.findIndex((s) => s.t >= x))} />
            <XYPlot height={160} series={xl} xlim={[0, 100]} ylim={[0, 1]} xlabel="放热进度 t" ylabel="x_L" vlines={[{ x: tNow, color: COLOR.stateX0, dash: '' }]} onPick={(x) => setIdx(S.findIndex((s) => s.t >= x))} />
          </Panel>
          <Panel title="演化：冷却与成分探索（与工作台检查器同源）" prov="model">
            {an ? <EvolutionPanel an={an} /> : <p className="dim">计算中…</p>}
          </Panel>
          <Panel title="事件与每一步的数学 / 热力学条件" prov="model">
            <ol className="ev-list">
              {trace.events.map((e, k) => {
                const after = S[Math.min(S.length - 1, e.index + (e.plateau ? 31 : 2))];
                const ia = e.plateau ? inv.find((a) => a.iv.rank === 'ternary' && Math.abs(a.iv.T - e.T) < 0.05) : null;
                const before = S[Math.max(0, e.index)];
                const dF = e.plateau && after ? Array.from(new Set([...before.eq.phases, ...after.eq.phases].map((p) => p.id))).map((id) => ({ id, d: (after.eq.phases.find((p) => p.id === id)?.frac ?? 0) - (before.eq.phases.find((p) => p.id === id)?.frac ?? 0) })) : null;
                return (
                  <li key={k} className={Math.abs(idx - e.index) < 1 ? 'on' : ''}>
                    <button className="ev-head" onClick={() => setIdx(e.index)}>
                      <span className="mono">{cel(e.T, 1)}</span>
                      <b>{e.title}</b>
                    </button>
                    <div className="ev-body">
                      <p>{e.detail}</p>
                      {after && !e.plateau && e.kind !== 'end' && (
                        <p className="small">
                          之后：{after.eq.key}，{phaseRuleText(phaseRule(d, after.eq, x0))}。
                          {after.eq.phases.length === 2 && after.eq.phases.some((p) => p.si < 0) && ' 守恒 ⇒ 液相沿 固相→x₀ 射线背离固相（背向线规则）。'}
                          {after.eq.phases.length === 3 && after.eq.phases.some((p) => p.si < 0) && ' F = 1：液相被约束在界线上，由 T 唯一确定。'}
                        </p>
                      )}
                      {ia && ia.rx.nu && (
                        <div className="stack" style={{ gap: 4 }}>
                          <MatrixView name="N" M={ia.rx.N} rowLabels={sym} colLabels={ia.phases.map((p) => p.label)} digits={3} />
                          <span className="small">
                            ker N：ν = ({ia.rx.nu.map((v) => fmtNum(v, 3)).join(', ')}) ⇒ {ia.rx.text}（{ia.rx.message}）
                          </span>
                          {dF && <span className="small mono">本成分平台前后相分数变化 Δf：{dF.map((q) => `${q.id} ${q.d >= 0 ? '+' : ''}${fmtNum(q.d, 4)}`).join('，')}（与 ν 成比例，比例 = 平台中消耗的液相量）</span>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ScheilSection() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const trace = useStore((s) => s.trace);
  const { data: sch, computing: schBusy } = useScheil(d, x0);
  const fin = sch[sch.length - 1];
  const eqFin = trace.finalPhases;
  const ids = Array.from(new Set([...Object.keys(fin.solids), ...eqFin.map((p) => p.id)]));
  const eqL: Series = { id: 'eqL', pts: trace.samples.map((s) => [toC(s.T), s.eq.phases.find((p) => p.si < 0)?.frac ?? 0] as [number, number]).filter((p) => p[0] <= toC(trace.Tliq) + 1), color: COLOR.phase.liquid, label: '平衡：液相分数' };
  const scL: Series = { id: 'scL', pts: sch.map((s) => [toC(s.T), s.fL] as [number, number]), color: COLOR.stateX0, dash: '5 3', label: 'Scheil：剩余液相分数' };
  const Tlo = Math.min(...trace.samples.map((s) => s.T), ...sch.map((s) => s.T));
  return (
    <>
      <PageTitle title="平衡冷却 vs Scheil 凝固" desc={`同一热力学模型、两种极限的物质传输假设：结果差异完全来自假设，而不是热力学。${schBusy ? '（Scheil 计算中…）' : ''}`} />
      <div className="cols c2">
        <div className="stack">
          <Panel title="液相路径" prov="model">
            <div className="plot-box">
              <TernaryPlot d={d} background="fields" onPick={(x) => setX0(x, false)}>
                {(m) => (
                  <>
                    <polyline points={trace.liquidPath.map((p) => m.px(p.x).join(',')).join(' ')} fill="none" stroke={COLOR.phase.liquid} strokeWidth={3} />
                    <polyline points={sch.map((s) => m.px(s.xL).join(',')).join(' ')} fill="none" stroke={COLOR.stateX0} strokeWidth={1.8} strokeDasharray="5 3" />
                    <Handle m={m} x={x0} onDrag={(x) => setX0(x, false)} label="x₀" />
                  </>
                )}
              </TernaryPlot>
            </div>
            <div className="legend-inline">
              <span><i style={{ background: COLOR.phase.liquid }} />平衡冷却</span>
              <span><i style={{ background: COLOR.stateX0 }} />Scheil</span>
            </div>
          </Panel>
          <Panel title="液相分数随温度" prov="model">
            <XYPlot height={220} series={[eqL, scL]} xlim={[toC(trace.Tliq) + 5, toC(Tlo)]} ylim={[0, 1]} xlabel="T / °C（向右降温）" ylabel="f_L" />
          </Panel>
        </div>
        <div className="stack">
          <Panel title="终态对比" prov="model">
            <table className="grid">
              <thead>
                <tr>
                  <th>相</th>
                  <th>平衡终态</th>
                  <th>Scheil 累积</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td className="num">{fmtNum((eqFin.find((p) => p.id === id)?.frac ?? 0) * 100, 2)}%</td>
                    <td className="num">{fmtNum((fin.solids[id] ?? 0) * 100, 2)}%</td>
                  </tr>
                ))}
                <tr>
                  <td>凝固终了温度</td>
                  <td className="num">{(() => { const e = [...trace.events].reverse().find((v) => v.kind === 'invariant' || v.title.includes('液相消失')); return e ? cel(e.T, 1) : '—'; })()}</td>
                  <td className="num">{cel(fin.T, 1)}{fin.fL > 0 ? `（剩余液相 ${fmtNum(fin.fL * 100, 3)}%）` : ''}</td>
                </tr>
              </tbody>
            </table>
            <p className="note">Scheil 的"相分数"是不同时刻析出物的累积量 —— 化学计量相各层成分相同；固溶体各层成分不同（成分偏析，表中为平均成分），空间上分层，不处于整体平衡。</p>
          </Panel>
          <Panel title="假设（必须明确）" prov="assume">
            <table className="grid">
              <thead>
                <tr>
                  <th />
                  <th>平衡冷却</th>
                  <th>Scheil</th>
                </tr>
              </thead>
              <tbody>
                <tr><th>固相内扩散</th><td>无限快（整体平衡，可回溶）</td><td>为零（析出即冻结，不能回溶）</td></tr>
                <tr><th>液相内混合</th><td>完全</td><td>完全</td></tr>
                <tr><th>界面</th><td>—</td><td>局部平衡</td></tr>
                <tr><th>转熔反应</th><td>按平衡进行</td><td>不发生（被包裹的先析出相不参与）</td></tr>
                <tr><th>过冷 / 形核</th><td colSpan={2}>均不考虑</td></tr>
                <tr><th>数值方法</th><td>—</td><td>与 pycalphad 生态 scheil 包（simulate_scheil_solidification）假设一致；自适应步长 0.25–10 K，相集合改变处二分定位事件温度，终凝按不变反应平台一次完成</td></tr>
              </tbody>
            </table>
            <div className="callout warn">
              <Prov k="unknown" /> 真实凝固介于两者之间，具体位置取决于扩散系数、冷却速率与组织尺度（需要 Brody–Flemings 等扩散模型或相场 / DICTRA 类动力学计算）。本平台<b>不预测</b>实际非平衡组织，只给出两个极限。
            </div>
          </Panel>
          <Panel title="Scheil 的数学" prov="math">
            <p>每一温度步：把剩余液相当作新的总成分求平衡，x₀⁽ᵏ⁺¹⁾ = x_L⁽ᵏ⁾，f_L⁽ᵏ⁺¹⁾ = f_L⁽ᵏ⁾·f_L(局部)。守恒仍成立，但只对"液相 + 当步析出物"成立 —— 先前的固相被移出了方程。</p>
            <TeXBlock>{String.raw`f_L^{(k+1)} x_L^{(k+1)} + \sum \Delta n_s^{(k)} c_s = f_L^{(k)} x_L^{(k)}`}</TeXBlock>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ProjectionLimits() {
  const d = useStore((s) => s.diagram);
  const trace = useStore((s) => s.trace);
  const x0 = useStore((s) => s.x0);
  const prim = trace.samples.find((s) => s.eq.phases.length === 2 && s.eq.phases.some((p) => p.si < 0));
  const solid = prim?.eq.phases.find((p) => p.si >= 0);
  const rows: [string, 'math' | 'model' | 'unknown', string][] = [
    ['初晶相', 'math', `由 x₀ 所在初晶区读出：${solid?.id ?? '—'}`],
    ['初晶阶段液相路径（方向）', 'math', '直线：背离初晶相成分点（守恒）'],
    ['液相到达哪条界线、在哪一点到达', 'math', '射线与界线的交点（只需二维几何）'],
    ['沿界线的降温方向', 'math', '由箭头（sign dT/ds）读出'],
    ['界线上是共晶还是转熔', 'math', '切线规则（二维几何）'],
    ['结晶终点（哪个不变点）', 'math', '副三角形 / 三角形规则'],
    ['终态相组成与相分数', 'math', '重心坐标（只需二维）'],
    ['液相线温度 T_liq(x₀)', 'unknown', '只能由等温线插值，误差 ≤ ΔT/2；无等温线则无法确定'],
    ['各事件的温度', 'unknown', '不变点温度若有标注可读；界线上到达点的温度只能插值'],
    ['任一温度下的相分数', 'unknown', '需知道该温度下的液相成分 ⇒ 需要 T 与 x_L 的对应（三维信息）'],
    ['冷却曲线、平台长度（潜热）', 'unknown', '需焓数据（热力学模型），投影中完全没有'],
    ['转熔反应中先析出相是否耗尽', 'math', '可由三角形规则判断（例如 x₀ 是否在含被回溶相的副三角形中）'],
    ['非平衡组织', 'unknown', '需要动力学模型'],
  ];
  return (
    <>
      <PageTitle title="只有二维投影时，哪些量不能唯一重建" desc="把每一个结论标注为：仅用几何即可得出 / 需要热力学模型 / 投影数据不足。" />
      <div className="cols c2">
        <Panel title="对当前成分的判定" prov="math">
          <table className="grid">
            <thead>
              <tr>
                <th>量</th>
                <th>来源</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([a, k, c]) => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{k === 'math' ? <Prov k="math" title="仅需二维几何" /> : <Prov k="unknown" />}</td>
                  <td>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="为什么" prov="math">
          <p>
            二维液相面投影是 P:(x, T) ↦ x 作用在液相面与界线上的像。凡是只依赖"成分空间中的线性关系"（共线、凸组合、重心坐标、射线与曲线的交点）的结论都能保留 ——
            它们在 P 下不变。凡是需要温度数值、或需要"某温度下的成分"（温度与成分的耦合）的结论都丢失了 —— 它们沿 ker P 方向。
          </p>
          <p>
            热力学模型（本平台的 G 函数）补回的正是被 P 丢掉的那一维：它给出 T_liq(x)、界线上的 T(s)、各平衡态的焓。当前成分 x₀ = ({x0.map((v) => fmtNum(v, 3)).join(', ')})，
            模型给出液相线 {cel(trace.Tliq, 1)} —— 这个数字在投影中只能被近似读出。
          </p>
          <p className="note">体系：{d.params.compounds.map((c) => `${c.label}（${c.formula}）`).join('、') || '无化合物'}。</p>
        </Panel>
      </div>
    </>
  );
}

