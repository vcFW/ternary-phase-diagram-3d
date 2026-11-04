import { useMemo, useState } from 'react';
import { triBary } from '../../core/barycentric';
import { cel, solidColor, toC } from '../../core/colors';
import { TERMS, termFull } from '../../core/terms';
import type { Comp } from '../../core/types';
import { entropyLiq, entropySol, gibbsDuhem } from '../../math/curves';
import { fmtNum } from '../../math/linalg';
import { effectiveComponents, phaseRule } from '../../math/phaseRule';
import { analyzeReaction, reactionThermo } from '../../math/reaction';
import { useScheil } from '../../state/asyncCompute';
import { invariantAnalyses } from '../../state/derived';
import { useStore } from '../../state/store';
import { PageTitle } from '../../viz/PageLayout';
import { Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { XYPlot } from '../../viz/XYPlot';
import { Eq, KV, M, MatrixView, Panel, Prov } from '../../viz/MathView';
import { Chip } from '../../ui/controls';
import { Layers5 } from './RulesPage';
import { COLOR } from '../../ui/tokens';

// ===================================================================== 结晶路径与终点
export function PathRule() {
  const d = useStore((s) => s.diagram);
  const x0 = useStore((s) => s.x0);
  const setX0 = useStore((s) => s.setX0);
  const trace = useStore((s) => s.trace);
  const facets = useMemo(() => d.facets(), [d]);
  const tri = facets.find((t) => {
    const w = triBary(x0, d.solids[t[0]].n, d.solids[t[1]].n, d.solids[t[2]].n);
    return w.every((v) => v >= -1e-9);
  });
  const ends = tri ? d.topo.invariants.filter((iv) => iv.rank === 'ternary' && [...iv.solids].sort().join() === [...tri].sort().join()) : [];
  const predicted = ends[0];
  const liqEnd = [...trace.events].reverse().find((e) => e.kind === 'invariant' || (e.kind === 'vanish' && e.title.includes('液相')));
  const { data: sch } = useScheil(d, x0);
  const schFinal = sch[sch.length - 1];
  const schSolids = Object.entries(schFinal.solids).filter(([, v]) => v > 1e-4).map(([k]) => k);
  const eqFinal = trace.finalPhases.map((p) => p.id);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      <PageTitle title="结晶路径规则与结晶终点" desc="初晶区 → 沿背向线 → 到达界线 → 沿界线降温 → 在所属副三角形对应的不变点结束。" />
      <div className="cols c2">
        <Panel title="路径、副三角形与预测终点" prov="model" sub="在图中单击/拖动改变 x₀">
          <div className="plot-box tall">
            <TernaryPlot d={d} background="fields" onPick={(x) => setX0(x, false)}>
              {(m) => (
                <>
                  {facets.map((t, k) => (
                    <polygon key={k} points={t.map((si) => m.px(d.solids[si].n).join(',')).join(' ')} fill="none" stroke={COLOR.accent} strokeDasharray="4 3" strokeWidth={0.9} />
                  ))}
                  {tri && <polygon points={tri.map((si) => m.px(d.solids[si].n).join(',')).join(' ')} className="tri-fill" />}
                  <polyline points={trace.liquidPath.map((p) => m.px(p.x).join(',')).join(' ')} fill="none" stroke={COLOR.path} strokeWidth={2.6} />
                  {predicted && (() => {
                    const p = m.px(predicted.x);
                    return <circle cx={p[0]} cy={p[1]} r={8} fill="none" stroke={COLOR.stateX0} strokeWidth={2} />;
                  })()}
                  <Handle m={m} x={x0} onDrag={(x) => setX0(x, false)} label="x₀" />
                </>
              )}
            </TernaryPlot>
          </div>
          <KV
            rows={[
              ['x₀ 所在副三角形（固相相容三角形）', <>{tri ? tri.map((si) => d.solids[si].label).join('–') : '（在三角形边上 / 退化）'}</>],
              ['几何预测的结晶终点', <>{d.sol ? '—（固溶体：副三角形的顶点随温度移动，不能由名义成分点预先划分）' : predicted ? `${predicted.label}（${predicted.name}），${cel(predicted.T, 1)}` : '—（副三角形无对应三元不变点，或 x₀ 在副三角形边上）'}</>],
              ['平衡冷却计算：液相消失于', <>{liqEnd ? `${cel(liqEnd.T, 1)} · ${liqEnd.title}` : '—'}</>],
              ['平衡终态相', <>{eqFinal.join(' + ')}</>],
              ['几何预测 = 计算？', predicted && liqEnd ? (Math.abs(predicted.T - liqEnd.T) < 0.05 ? <span className="ok">一致</span> : <span className="bad">不一致（检查 x₀ 是否在副三角形边上或转熔使某相耗尽）</span>) : '—'],
              ['Scheil（非平衡）终态相', <>{schSolids.join(' + ')}，凝固终了 {cel(schFinal.T, 1)}</>],
            ]}
          />
          <p className="note">成分 {sym.map((s, i) => `${s} ${(x0[i] * 100).toFixed(1)}%`).join(' · ')}；紫线为平衡冷却的液相路径，红圈为几何预测终点。</p>
        </Panel>
        <Layers5
          def={
            <>
              <p>平衡结晶时：(1) 液相先在初晶区内沿背向线移动；(2) 到达界线后沿界线降温；(3) 最终在 x₀ 所在副三角形（相容三角形）的三个固相所对应的不变点结束（"三角形规则"）。</p>
              <p className="note"><Prov k="assume" /> 完全平衡（固相内扩散充分）、封闭体系、副三角形划分已知。</p>
            </>
          }
          geo={<p>副三角形是低温下固相吉布斯能点集的下凸包刻面：总成分落在哪个刻面上，最终就由哪三个固相组成；它们与液相共存的唯一温度就是对应的不变点。</p>}
          math={
            <>
              <p>最终态：<M>x₀ = Σ fₛ cₛ, fₛ ≥ 0</M> —— 只有包含 x₀ 的三角形给出非负解（重心规则）。</p>
              <p>液相在终态前最后与这三个固相共存：四相平衡 ⇒ F = 4 − 4 = 0，温度与液相成分唯一 ⇒ 终点 = 该三元不变点。</p>
              <p>中间阶段：每一步都满足 x₀ = f_L x_L + Σ fₛ cₛ，路径由守恒 + 饱和条件逐段确定（详见"凝固路径与反应推演"）。</p>
            </>
          }
          phys={<p>"终点在哪"由总成分的位置（线性代数）决定；"什么时候到"由热力学决定。两者分工明确，这也是二维图能预测终态相组成、却不能预测温度的原因。</p>}
          verify={
            <>
              <p>• 在不同副三角形内拖动 x₀：红圈（几何预测）与平衡冷却计算的液相消失点保持一致。</p>
              {d.sol && (
                <div className="callout warn">
                  <b>固溶体体系：</b>固相成分不是定点，低温下的三固相区 α+β+γ 的顶点是随温度移动的固溶度极限，而且三固相区之外还有单相区与两相区。
                  因此"副三角形 = 名义成分点连线"的三角形规则不再成立：结晶终点必须由平衡计算（或实际的等温截面）确定 —— 例如成分落在 α 单相区内时，液相在固相线处消失，根本不经过不变点。
                </div>
              )}
              <div className="callout warn">
                <b>反例：</b>①x₀ 在副三角形的边上（例如正好在 Alkemade 线上）：终态只有两相，液相在二元/拟二元点或界线上结束。
                ②非平衡凝固（Scheil）：转熔反应来不及进行，液相可越过过渡点继续走向共晶点，终态出现平衡相图不允许的相组合
                {schSolids.length > 3 || schSolids.join() !== eqFinal.join() ? `（本成分：Scheil 终态 ${schSolids.join(' + ')}，平衡终态 ${eqFinal.join(' + ')}）` : ''}。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}

// ===================================================================== 相律
export function PhaseRule() {
  const d = useStore((s) => s.diagram);
  const eq = useStore((s) => s.eq);
  const T = useStore((s) => s.T);
  const x0 = useStore((s) => s.x0);
  const xi = useStore((s) => s.xi);
  const [extra, setExtra] = useState<number[]>([]);
  const rule = phaseRule(d, eq, x0, xi >= 0);
  // 有效组元数演示：当前 x₀、A–B 边中点、顶点 A、以及稳定固相两两连线的中点
  const demo = useMemo(() => {
    const sym = d.params.components.map((c) => c.symbol);
    const pts: { name: string; x: Comp }[] = [
      { name: '当前 x₀', x: x0 },
      { name: `${sym[0]}–${sym[1]} 边中点`, x: [0.5, 0.5, 0] },
      { name: `顶点 ${sym[0]}`, x: [1, 0, 0] },
    ];
    const stable = d.solids.filter((s) => s.kind === 'element' || (s.kind !== 'solution' && d.topo.compounds.find((c) => c.si === s.index)?.congruent));
    for (let a = 0; a < stable.length; a++)
      for (let b = a + 1; b < stable.length; b++) {
        const x = stable[a].n.map((v, i) => (v + stable[b].n[i]) / 2) as Comp;
        if (x.every((v) => v > 1e-9)) pts.push({ name: `${stable[a].label}–${stable[b].label} 连线中点`, x });
      }
    return pts.map((p) => {
      const e = d.equilibrium(p.x, T);
      return { ...p, e, r: phaseRule(d, e, p.x), c: effectiveComponents(d, p.x, e) };
    });
  }, [d, x0, T]);
  const base = eq.phases.map((p) => ({ label: p.id, x: p.x, S: p.si < 0 ? entropyLiq(d.th, p.x, T) : entropySol(d.th, p.si) }));
  const add = extra.filter((si) => !eq.phases.some((p) => p.si === si)).map((si) => ({ label: d.solids[si].id, x: d.solids[si].n, S: entropySol(d.th, si, d.solids[si].n, T) }));
  const all = [...base, ...add];
  const gd = gibbsDuhem(all);
  return (
    <>
      <PageTitle title="Gibbs 相律" desc="F = C − P + 2 不是经验规律，而是线性方程组的秩–零化度定理。" />
      <div className="cols c2">
        <Panel title="当前平衡态的 Gibbs–Duhem 方程组" prov="model" sub={`T = ${cel(T, 1)}，恒压`}>
          <MatrixView name="G" M={gd.G} rowLabels={all.map((p) => p.label)} colLabels={['S', 'x_A', 'x_B', 'x_C']} digits={4} />
          <KV
            rows={[
              ['相数 P（行数）', <span className="mono">{all.length}</span>],
              ['未知量 (dT, dμ_A, dμ_B, dμ_C)', <span className="mono">C + 1 = 4</span>],
              ['rank G', <span className="mono">{gd.rank}</span>],
              ['F = dim ker G = 4 − rank G', <b className="mono">{gd.F}</b>],
              ['相律公式 C + 1 − P（名义 C = 3）', <span className="mono">{3 + 1 - all.length}</span>],
              ['有效组元数 C（当前 x₀）', <b className="mono" title={rule.reason || undefined}>{rule.C}</b>],
              ['F = C − P + 1（有效）', <b className="mono">{rule.F}{xi >= 0 ? '（平台）' : ''}</b>],
            ]}
          />
          {rule.reason && <div className="callout">{rule.reason}。</div>}
          <div className="sublabel">有效组元数演示（当前 T 下各成分的平衡与相律）</div>
          <table className="grid">
            <thead>
              <tr><th>成分</th><th>平衡相</th><th>P</th><th>C</th><th>F</th></tr>
            </thead>
            <tbody>
              {demo.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="mono">{r.e.key}</td>
                  <td className="mono">{r.r.P}</td>
                  <td className="mono">{r.r.C}</td>
                  <td className="mono">{r.r.F}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sublabel">假想地再加入固相（检验 P 增大时 F 如何变化）</div>
          <div className="chips">
            {d.solids.map((s) => (
              <Chip key={s.id} color={solidColor(s.index)} active={extra.includes(s.index) || eq.phases.some((p) => p.si === s.index)} onClick={() => setExtra((e) => (e.includes(s.index) ? e.filter((v) => v !== s.index) : [...e, s.index]))}>
                {s.label}
              </Chip>
            ))}
          </div>
          {all.length > 4 && <div className="callout err">P = {all.length} &gt; C + 1：方程个数超过未知量，非零解只在额外的退化条件下存在 —— 一般情况下这么多相不能共存。</div>}
          {gd.F !== 3 + 1 - all.length && all.length <= 4 && <div className="callout warn">rank G &lt; P：行线性相关（相成分或熵退化），F 大于公式值。</div>}
        </Panel>
        <Layers5
          def={
            <>
              <p>C 组元、P 相平衡体系的独立强度变量数 F = C − P + 2；恒压凝聚体系 F = C − P + 1。三元一般成分 C = 3；若 x₀ 在边上（某组元含量为 0）C = 2，在顶点上 C = 1；x₀ 与平衡相恰在两个稳定固相的连线（伪二元截面）上时，C 同样降为 2。</p>
              <p className="note"><Prov k="assume" /> 各相均为体相（忽略界面）；平衡；每相的 Gibbs–Duhem 方程线性无关。</p>
            </>
          }
          geo={<p>强度变量空间 (T, μ_A, μ_B, μ_C)（恒压）是 4 维的；每增加一个共存相就多一个超平面约束，可移动的方向（零空间）减少一维。</p>}
          math={
            <>
              <Eq>Sφ dT − Vφ dP + Σᵢ xφᵢ dμᵢ = 0,　φ = 1 … P</Eq>
              <p>未知量 (dT, dP, dμ₁…dμ_C) 共 C + 2 个，方程 P 个。若行线性无关，rank = P，由秩–零化度定理</p>
              <Eq>F = dim ker = (C + 2) − P</Eq>
              <p>恒压时去掉 dP 一列，F = C + 1 − P。</p>
            </>
          }
          phys={<p>F 是"可以独立改变而不破坏相组合"的强度变量个数：单相区 F = 3（T 与两个成分），两相区 F = 2，三相（界线）F = 1，四相（不变点）F = 0。</p>}
          verify={
            <>
              <p>• 在全局条中改变 T 或成分，使平衡态跨越不同相区：rank 与 F 同步变化，且总与名义值 C + 1 − P（C = 3）相等；把 x₀ 移到边上或伪二元连线上，上表中的有效 C 与 F 随之降低。</p>
              <div className="callout warn">
                <b>例外：</b>行相关时（例如液相恰好落在两固相连线上，且熵也满足同一线性关系 —— 一致熔融化合物恰在其熔点）rank 降低，此时出现"多一个自由度"的退化情形（拟二元）。
                Alkemade 极大点处 rank 不降，但零空间的 dT 分量为零 —— 自由度还在，只是不能沿温度方向用。
              </div>
            </>
          }
        />
      </div>
    </>
  );
}

// ===================================================================== 不变点与反应分类
export function InvariantRule() {
  const d = useStore((s) => s.diagram);
  const setT = useStore((s) => s.setT);
  const presetId = useStore((s) => s.presetId);
  const loadPreset = useStore((s) => s.loadPreset);
  const all = invariantAnalyses(d).filter((a) => a.iv.rank === 'ternary');
  const [pick, setPick] = useState<{ uid: number; k: number } | null>(null);
  const k = pick && pick.uid === d.uid ? Math.min(pick.k, all.length - 1) : 0;
  const cur = all[k];
  const [xL, setXL] = useState<{ id: string; x: Comp } | null>(null);
  if (!cur) return <p className="dim">该体系没有三元不变点。</p>;
  const lx = xL && xL.id === cur.iv.id + d.uid ? xL.x : cur.iv.x;
  const phases = [{ label: 'L', x: lx, si: -1 }, ...cur.iv.solids.map((si, k) => ({ label: d.solids[si].label, x: cur.iv.solidX[k] ?? d.solids[si].n, si }))];
  const rx = analyzeReaction(phases);
  const rt = rx.nu ? reactionThermo(d.th, phases, rx.nu) : null;
  const moved = lx !== cur.iv.x;
  const Ts = cur.iv.T;
  const dG = rt ? [-80, -40, 0, 40, 80].map((dT) => [toC(Ts + dT), rt.dG(Ts + dT)] as [number, number]) : [];
  return (
    <>
      <PageTitle title="不变点与反应分类" desc="反应系数 = 成分矩阵的零空间；但守恒只回答“允许什么”，平衡与方向需要热力学。" />
      <div className="chips" style={{ marginBottom: 8 }}>
        <span className="sublabel">一键载入三类不变点的实例：</span>
        <Chip active={presetId === 'simple-eutectic'} onClick={() => loadPreset('simple-eutectic')} title={`${TERMS.eutectic.name} ${TERMS.eutectic.symbol}：${TERMS.eutectic.reaction}（反应系数全正）`}>共晶点 E · 简单三元共晶</Chip>
        <Chip active={presetId === 'ternary-incongruent'} onClick={() => loadPreset('ternary-incongruent')} title={`${TERMS.transition.name} ${TERMS.transition.symbol}：${TERMS.transition.reaction}（一个负号）`}>过渡点 U · 三元不稳定化合物</Chip>
        <Chip active={presetId === 'ternary-peritectic'} onClick={() => loadPreset('ternary-peritectic')} title={`${TERMS.peritectic.name} ${TERMS.peritectic.symbol}：${TERMS.peritectic.reaction}（两个负号）`}>包晶点 P · 三元包晶体系</Chip>
      </div>
      <div className="cols c2">
        <div className="stack">
          <Panel
            title="反应成分矩阵 N 与零空间"
            prov="math"
            right={
              <select value={k} onChange={(e) => setPick({ uid: d.uid, k: Number(e.target.value) })}>
                {all.map((a, i) => (
                  <option key={a.iv.id} value={i}>
                    {a.iv.label} · {a.iv.name}
                  </option>
                ))}
              </select>
            }
          >
            <div className="plot-box">
              <TernaryPlot d={d} background="fields">
                {(m) => (
                  <>
                    <polygon points={cur.iv.solids.map((si, k) => m.px(cur.iv.solidX[k] ?? d.solids[si].n).join(',')).join(' ')} className={`tri-fill ${rx.cls === 'eutectic' ? '' : 'bad'}`} />
                    <Handle m={m} x={lx} onDrag={(x) => setXL({ id: cur.iv.id + d.uid, x })} label={moved ? 'L（已移动）' : `L = ${cur.iv.label}`} />
                  </>
                )}
              </TernaryPlot>
            </div>
            <MatrixView name="N" M={rx.N} rowLabels={d.params.components.map((c) => c.symbol)} colLabels={phases.map((p) => p.label)} colColors={[COLOR.phase.liquid, ...cur.iv.solids.map(solidColor)]} digits={4} />
            <KV
              rows={[
                ['rank N / dim ker N', <span className="mono">{rx.rank} / {rx.nullDim}</span>],
                ['ν（ν_L = −1）', <span className="mono">({rx.nu?.map((v) => fmtNum(v, 4)).join(', ') ?? '—'})</span>],
                ['守恒残差 ‖Nν‖∞', <span className="mono">{rx.residual.toExponential(2)}</span>],
                ['反应式', <b className="mono">{rx.text}</b>],
                ['分类', <span>{rx.message}</span>],
              ]}
            />
            {moved && (
              <div className="row">
                <span className="callout warn" style={{ flex: 1 }}>液相点已移离真实不变点：此时四相不再平衡共存，ν 只表示"守恒允许的反应"。</span>
                <button className="btn sm" onClick={() => setXL(null)}>复位</button>
              </div>
            )}
          </Panel>
          {rt && (
            <Panel title="反应吉布斯能 ΔG_r(T)（相成分固定）" prov="model">
              <XYPlot height={180} series={[{ id: 'g', pts: dG, color: COLOR.accent, label: 'ΔG_r = Σ νᵢ Gᵢ(T)' }]} xlabel="T / °C" ylabel="ΔG_r / (J·mol⁻¹)" hlines={[{ y: 0 }]} vlines={[{ x: toC(Ts), label: `${cur.iv.label}` }]} />
              <KV
                rows={[
                  ['ΔH_r（每摩尔液相）', <span className="mono">{fmtNum(rt.dH, 2)} J/mol</span>],
                  ['ΔS_r', <span className="mono">{fmtNum(rt.dS, 4)} J/(mol·K)</span>],
                  ['ΔG_r = 0 的温度 ΔH_r/ΔS_r', <span className="mono">{cel(rt.T0, 2)}</span>],
                  ['不变点温度（拓扑模块）', <span className="mono">{cel(Ts, 2)}</span>],
                  ['T_inv − 10 K 时 ΔG_r', <span className={rt.dG(Ts - 10) < 0 ? 'ok' : 'bad'}>{fmtNum(rt.dG(Ts - 10), 3)} J/mol ⇒ 降温时正向（消耗液相）{rt.dG(Ts - 10) < 0 ? '自发' : '不自发'}</span>],
                ]}
              />
              <button className="btn sm" onClick={() => setT(Ts + 0.3)}>把全局温度设到 {cur.iv.label} 之上 0.3 K</button>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="三个层次必须分开" prov="math">
            <table className="grid">
              <thead>
                <tr>
                  <th>层次</th>
                  <th>问题</th>
                  <th>工具</th>
                  <th>本例结论</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>① 守恒</td>
                  <td>哪些反应在原子数上可行？</td>
                  <td>ker N（线性代数）</td>
                  <td>{rx.nullDim === 1 ? `唯一（差比例因子）：${rx.text}` : `零空间维数 ${rx.nullDim}`}</td>
                </tr>
                <tr>
                  <td>② 平衡</td>
                  <td>这四相能否同时稳定共存？</td>
                  <td>公切面：四相 G 共面，且其余所有相在面之上</td>
                  <td>{moved ? <Prov k="unknown" /> : <>在 {cel(Ts, 1)} 成立（拓扑模块由 T_a = T_b = T_c 求得）</>}</td>
                </tr>
                <tr>
                  <td>③ 方向</td>
                  <td>降温时反应朝哪边走？</td>
                  <td>sign ΔG_r(T)</td>
                  <td>{rt ? (rt.dG(Ts - 10) < 0 ? '低于 T_inv 时 ΔG_r < 0：按所写方向（消耗液相）进行' : '低于 T_inv 时 ΔG_r > 0：逆向') : '—'}</td>
                </tr>
              </tbody>
            </table>
            <p>
              N 只含成分，不含任何能量 —— 它不可能告诉我们反应是否自发。在不变点温度，四相共切面 ⇒ ΔG_r = Σνᵢμ·cᵢ = μ·(Nν) = 0；离开该温度，
              ΔG_r(T) = ΔH_r − TΔS_r 的符号给出方向。
            </p>
          </Panel>
          <Layers5
            def={
              <>
                <p>三元凝聚体系中液相与三个固相共存的点为不变点（F = 0）。按液相点相对固相三角形的位置分为：{TERMS.eutectic.short} {TERMS.eutectic.symbol}（{TERMS.eutectic.reaction}；{termFull(TERMS.eutectic)}）、{TERMS.transition.short} {TERMS.transition.symbol}（{TERMS.transition.reaction}；别名{TERMS.transition.aliases.join('、')}）、{TERMS.peritectic.short} {TERMS.peritectic.symbol}（{TERMS.peritectic.reaction}；别名{TERMS.peritectic.aliases.join('、')}）。</p>
              </>
            }
            geo={<p>重心位 / 交叉位 / 共轭位（见"重心规则"）。拖动左图中的液相点越过三角形的边，分类随之改变。</p>}
            math={
              <>
                <Eq>N ν = 0,　N = [x_L | c_α | c_β | c_γ] ∈ R³ˣ⁴</Eq>
                <p>
                  三固相不共线 ⇒ rank N = 3 ⇒ dim ker N = 1。取 ν_L = −1：<M>Σνₛcₛ = x_L</M>，即 νₛ 恰为 x_L 关于固相三角形的重心坐标 ——
                  "反应系数的符号"与"液相点的位置"是同一个数学对象的两种读法。
                </p>
              </>
            }
            phys={<p>νₛ &gt; 0 的固相在降温时生成，νₛ &lt; 0 的固相被液相回溶（转熔）。四相反应在恒温下进行，反应进度 ξ 恰好就是 k = 4 时相分数方程组的零空间方向。</p>}
            verify={
              <div className="callout warn">
                <b>非退化条件：</b>三固相共线（rank N = 2，零空间 2 维）或液相落在三角形的边上（某 νₛ = 0）时，分类失效，属于拟二元退化情形。
                不要把成分矩阵当作反应会发生的证据 —— 例如把液相拖到三角形外很远处，ν 照样存在，但这四相根本不平衡。
              </div>
            }
          />
        </div>
      </div>
    </>
  );
}

// ===================================================================== 二级定理
export function ErjiNote() {
  return (
    <>
      <PageTitle title="“二级定理”：术语考证" desc="先核实含义，不臆造定义。" />
      <div className="cols c2">
        <Panel title="核实结果" prov="unknown">
          <p>
            在三元相图教材、讲义与中文网络资料中检索"二级定理"（2026-11 检索），<b>没有找到</b>该名称在相图文献中的标准定义或出处。
            常见中文教材中三元相图的规则一般称为：连线规则、切线规则、重心规则（重心位 / 交叉位 / 共轭位）、三角形规则、等含量 / 等比例规则、背向线规则、杠杆规则、相区接触规则等。
          </p>
          <p>因此本平台<b>不给出</b>"二级定理"的定义。以下是最可能被这样称呼的已确立概念，请对照你所用教材的上下文判断：</p>
          <table className="grid">
            <thead>
              <tr>
                <th>候选概念</th>
                <th>可能的联系</th>
                <th>本平台位置</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>相区接触规则（Palatnik–Landau）：相邻相区的相数差为 1（点接触除外）</td>
                <td>"相差一级"的说法</td>
                <td>相律（秩–零化度）一节可推出：越过一个边界，P 变化 1，F 变化 1</td>
              </tr>
              <tr>
                <td>副三角形（二级 / 次级三角形）划分与三角形规则</td>
                <td>"二级"可能指"次级（secondary）三角形"</td>
                <td>结晶路径规则与结晶终点</td>
              </tr>
              <tr>
                <td>Alkemade 连线规则（又称连线定理）</td>
                <td>界线与"二元"连线的关系</td>
                <td>连线规则 · Alkemade 定理</td>
              </tr>
              <tr>
                <td>二级相变（Ehrenfest 分类）</td>
                <td>名称相近，但与三元相图几何规则无关</td>
                <td>不在本平台范围内</td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="请协助确认" prov="assume">
          <p>如果能提供该术语出现的教材名称、章节或原句，可以据此核对并把它加入"相图规则与定理"中，按五层结构给出推导与交互验证。</p>
          <p className="note">参考检索来源：烟台大学 MOOC《三元相图》讲义；百度百科"三元相图"；CSDN《冶金物理化学：典型二元相图与三元相图》；西安建筑科技大学《相图基础》讲义。均未出现"二级定理"一词的定义。</p>
        </Panel>
      </div>
    </>
  );
}
