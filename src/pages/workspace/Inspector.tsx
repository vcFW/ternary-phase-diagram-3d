import { useEffect, useMemo, useState } from 'react';
import { cel, phaseColor, regionName, toC } from '../../core/colors';
import type { Comp } from '../../core/types';
import { analyzeCurveAt } from '../../math/curves';
import { fmtNum } from '../../math/linalg';
import type { PointAnalysis } from '../../math/pointAnalysis';
import { parametrize } from '../../math/spaces';
import { InfoPanel } from '../../panels/InfoPanel';
import { invariantAnalyses } from '../../state/derived';
import { useStore } from '../../state/store';
import { Derivation, Eq, KV, MatrixView, Prov, type Step } from '../../viz/MathView';
import { XYPlot, type Series } from '../../viz/XYPlot';
import { COLOR } from '../../ui/tokens';

type Tab = 'eq' | 'rx' | 'geo' | 'stab' | 'math' | 'evo' | 'sel' | 'info';

const TABS: { id: Tab; label: string }[] = [
  { id: 'eq', label: '相平衡' },
  { id: 'rx', label: '反应与转变' },
  { id: 'geo', label: '几何与向量' },
  { id: 'stab', label: '稳定性' },
  { id: 'math', label: '数学推导' },
  { id: 'evo', label: '演化' },
  { id: 'sel', label: '选中对象' },
  { id: 'info', label: '讲解' },
];

const KIND_TEXT = { liquid: '液相区', coexist: '液–固共存区', solid: '固相区' } as const;
const pc = (v: number, d = 2) => `${(v * 100).toFixed(d)}`;
const cstr = (x: Comp, d = 2) => x.map((v) => pc(v, d)).join(' / ');

/** 工作台右侧"检查器"：当前点（或选中的界线 / 不变点）的平衡、反应、几何、稳定性、数学与演化。 */
export function Inspector({ an, history }: { an: PointAnalysis | null; history: { x: Comp; G: number; f: Record<string, number> }[] }) {
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
        {an && tab === 'rx' && <RxTab an={an} />}
        {an && tab === 'geo' && <GeoTab an={an} />}
        {an && tab === 'stab' && <StabTab an={an} />}
        {an && tab === 'math' && <MathTab an={an} />}
        {an && tab === 'evo' && <EvoTab an={an} history={history} />}
        {tab === 'sel' && <SelTab />}
        {tab === 'info' && <InfoPanel />}
      </div>
    </div>
  );
}

function Sec({ title, prov, children }: { title: string; prov?: 'math' | 'model' | 'unknown' | 'assume' | 'demo'; children: React.ReactNode }) {
  return (
    <section className="ins-sec">
      <h4>
        {title} {prov && <Prov k={prov} />}
      </h4>
      {children}
    </section>
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
        <p className="note">相分数以摩尔原子计，由下一页"数学推导"中的线性方程组 A f = b 求得。</p>
      </Sec>
    </>
  );
}

// ===================================================================== 反应
function RxTab({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const setIdx = useStore((s) => s.setIdx);
  const inv = invariantAnalyses(d);
  const r = an.reaction;
  const ev = (e: (typeof an.next)[number]) => {
    const ia = e.kind === 'invariant' ? inv.find((a) => a.iv.rank === 'ternary' && Math.abs(a.iv.T - e.T) < 0.05) : null;
    return (
      <li key={`${e.T}-${e.title}`}>
        <button className="ev-head" onClick={() => setIdx(e.index)}>
          <span className="mono">{cel(e.T, 1)}</span>
          <b>{e.title}</b>
        </button>
        <div className="ev-body">
          <p>{e.detail}</p>
          {ia && ia.rx.nu && (
            <p className="small">
              反应向量 ν = ({ia.rx.nu.map((v) => fmtNum(v, 3)).join(', ')}) = ker N；{ia.rx.message}
            </p>
          )}
        </div>
      </li>
    );
  };
  return (
    <>
      <Sec title="此刻降温一小步会发生什么" prov="model">
        <div className="ins-big">
          <b className="mono">{r.text}</b>
          <span className={`kind ${r.type}`}>{{ primary: '初晶析出', eutectic: '共晶型单变反应', peritectic: '转熔（包晶）型单变反应', invariant: '四相不变反应', solid: '固态', none: '无反应' }[r.type]}</span>
        </div>
        <p>{r.explain}</p>
        {r.lambda !== undefined && (
          <p className="small">
            判据：λ ∈ (0, 1) ⇒ 共晶型；λ &lt; 0 或 λ &gt; 1 ⇒ 远离交点的固相被回溶。此处 λ = {fmtNum(r.lambda, 4)}。
          </p>
        )}
      </Sec>
      <Sec title="以 x₀ 固定冷却时的相变序列" prov="model">
        <p className="note">（冷却凝固模式的含义：总成分不变，只有温度降低；以下事件按温度排列，单击跳转。）</p>
        {an.past.length > 0 && <div className="sublabel">已发生（高于当前温度）</div>}
        <ol className="ev-list">{an.past.map(ev)}</ol>
        <div className="sublabel">将发生（低于当前温度）</div>
        <ol className="ev-list">{an.next.length ? an.next.map(ev) : <li className="dim">冷却至下限温度不再有相变。</li>}</ol>
      </Sec>
      <Sec title="恒温下移动 x₀ 会越过的相界" prov="model">
        {an.neighbors.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>方向（相对 A→B 边）</th>
                <th>距离</th>
                <th>进入相区</th>
              </tr>
            </thead>
            <tbody>
              {an.neighbors.map((n) => (
                <tr key={n.dir}>
                  <td className="num">{((n.dir * 180) / Math.PI).toFixed(0)}°</td>
                  <td className="num">≤ {n.dist.toFixed(3)}</td>
                  <td>{regionName(n.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">在 0.1 范围内各方向均停留在同一相区。</p>
        )}
        <p className="note">越过相界时相数改变 1（相区接触规则）：例如 L+α → L+α+β 表示新相 β 开始在液相中饱和。</p>
      </Sec>
    </>
  );
}

// ===================================================================== 几何与向量
function GeoTab({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  return (
    <>
      <Sec title="向量" prov="math">
        <table className="grid">
          <thead>
            <tr>
              <th>向量</th>
              <th>笛卡尔分量</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            {an.vectors.map((v, k) => (
              <tr key={k}>
                <td className="mono">{v.label}</td>
                <td className="num">({fmtNum(v.v[0], 3)}, {fmtNum(v.v[1], 3)})</td>
                <td className="small">{v.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">坐标：A = (0, 0)，B = (1, 0)，C = (½, √3/2)。图中箭头只表示方向，长度已归一化。</p>
      </Sec>
      <Sec title="连结线 / 连结三角形" prov="math">
        {an.phases.length === 1 && <p>单相：没有连结线。x₀ 就是该相的成分。</p>}
        {an.phases.length === 2 && <p>两相：x₀、c₁、c₂ 共线（直线规则），f₁ : f₂ = |x₀c₂| : |x₀c₁|（杠杆规则）。共线性残差 = {an.lever.residual.toExponential(2)}。</p>}
        {an.phases.length === 3 && (
          <p>
            三相：x₀ 在连结三角形内，fᵢ = 子三角形面积 / 总面积（重心坐标）。有向面积 S = {fmtNum(an.lever.areas?.total ?? NaN, 5)}，子三角形 = ({an.lever.areas?.sub.map((v) => fmtNum(v, 5)).join(', ')})。
          </p>
        )}
        <p className="small">
          读数线：过 x₀ 作平行于对边的三条直线，与边的交点读出 {sym.map((s, i) => `x_${s} = ${an.x0[i].toFixed(3)}`).join('，')} —— 这是重心坐标的几何读法。
        </p>
      </Sec>
      {an.reaction.curve && (
        <Sec title="液相所在界线的局部几何" prov="model">
          <KV
            rows={[
              ['切向 t（降温方向）', <span className="mono">({fmtNum(an.reaction.curve.frame.tCool[0], 4)}, {fmtNum(an.reaction.curve.frame.tCool[1], 4)})</span>],
              ['dT/ds', <span className="mono">{fmtNum(an.reaction.curve.frame.dTds, 2)} K / 单位弧长</span>],
              ['切线–连线求交 (τ, λ)', <span className="mono">({fmtNum(an.reaction.curve.ti.tau, 4)}, {fmtNum(an.reaction.curve.ti.lambda, 4)})</span>],
              ['共轭固相成分', <span className="mono">{cstr(an.reaction.curve.ya)} | {cstr(an.reaction.curve.yb)}</span>],
            ]}
          />
        </Sec>
      )}
    </>
  );
}

// ===================================================================== 稳定性
function StabTab({ an }: { an: PointAnalysis }) {
  const st = an.stability;
  const CLS = { stable: '稳定', metastable: '亚稳', unstable: '不稳定' } as const;
  const mu = st.gm.mu;
  return (
    <>
      <Sec title="平衡解是否为全局最小" prov="model">
        <KV
          rows={[
            ['公切面 μ = (μ_A, μ_B, μ_C)', <span className="mono">({mu.map((v) => fmtNum(v, 1)).join(', ')}) J/mol</span>],
            ['最小切面距离（证书）', <span className={st.certificate > -1e-3 ? 'ok' : 'bad'}>{fmtNum(st.certificate, 4)} J/mol {st.certificate > -1e-3 ? '≥ 0 ⇒ 没有任何相能自发析出：全局稳定' : '< 0 ⇒ 存在可析出相（不是平衡）'}</span>],
            ['G_eq', <span className="mono">{fmtNum(an.eq.G, 3)} J/mol（独立 LP：{fmtNum(st.gm.G, 3)}）</span>],
          ]}
        />
        <table className="grid">
          <thead>
            <tr>
              <th>相</th>
              <th>切面距离 r = min[G − μ·x]</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {st.forces.map((f) => (
              <tr key={f.id + f.si}>
                <td>{f.id}</td>
                <td className="num">{Number.isFinite(f.r) ? fmtNum(f.r, 3) : '+∞'}</td>
                <td className="small">
                  {f.status === 'on-plane' ? '在公切面上（共存相）' : f.status === 'above' ? '在切面之上：析出驱动力为负（不会出现）' : f.status === 'below' ? '在切面之下：有析出驱动力！' : '含缺失组元，不可能出现'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Sec>
      <Sec title="假想的均匀单相状态（成分 x₀）" prov="model">
        <table className="grid">
          <thead>
            <tr>
              <th>相</th>
              <th>G_φ(x₀) − G_eq</th>
              <th>Hessian 特征值</th>
              <th>分类</th>
            </tr>
          </thead>
          <tbody>
            {st.homogeneous.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td className="num">{fmtNum(h.excess, 2)}</td>
                <td className="num">{fmtNum(h.eig[0], 0)}, {fmtNum(h.eig[1], 0)}</td>
                <td className={h.cls === 'stable' ? 'ok' : h.cls === 'unstable' ? 'bad' : ''}>{CLS[h.cls]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {st.homogeneous[0]?.maxDF && st.homogeneous[0].maxDF.df > 0 && (
          <p>
            若液相保持均匀（过冷），对 <b>{st.homogeneous[0].maxDF.id}</b> 的析出驱动力最大：Δ = {fmtNum(st.homogeneous[0].maxDF.df, 1)} J/mol —— 这是形核的热力学驱动力（但能否形核还取决于界面能等动力学因素，本模型不包含）。
          </p>
        )}
        <p className="small">
          判据：<b>稳定</b> = 吉布斯能等于全局最小；<b>亚稳</b> = 高于最小值但 Hessian 正定（对任意小的成分涨落稳定，需形核越过能垒）；<b>不稳定</b> = Hessian 有非正特征值（旋节分解，任意小涨落都会长大）。
        </p>
        <p className="note">
          <Prov k="assume" /> 结论依赖热力学模型（示意参数）。若没有可靠的 G 数据，只能由几何给出相分数与守恒关系，稳定性<b>无法判定</b>。
        </p>
      </Sec>
    </>
  );
}

// ===================================================================== 数学推导
function MathTab({ an }: { an: PointAnalysis }) {
  const d = useStore((s) => s.diagram);
  const sym = d.params.components.map((c) => c.symbol);
  const lv = an.lever;
  const names = an.phases.map((p) => p.id);
  const steps: Step[] = [
    { kind: 'known', body: <>x₀ = ({an.x0.map((v) => fmtNum(v, 4)).join(', ')})，T = {cel(an.T, 2)}；热力学模型给出各相 G_φ(x, T)。</> },
    {
      kind: 'govern',
      title: '吉布斯能最小化',
      body: (
        <Eq>
          min Σ f_φ G_φ(c_φ, T)　s.t.　Σ f_φ c_φ = x₀,　f_φ ≥ 0
        </Eq>
      ),
    },
    { kind: 'mid', title: '最优性（KKT）', body: <>共存相化学势相等 μ_φ(c_φ) = μ（公切面）；其余相切面距离 ≥ 0。本点证书 = {fmtNum(an.stability.certificate, 4)} J/mol。</> },
    {
      kind: 'op',
      title: '相分数：约束线性方程组',
      body: (
        <>
          <MatrixView name="[A | b]" M={lv.A.map((row, i) => [...row, lv.b[i]])} rowLabels={[`x_${sym[0]}`, `x_${sym[1]}`, 'Σ']} colLabels={[...names, 'x₀']} aug={names.length} digits={4} />
          <span className="small">
            rank A = {lv.rank}{lv.det !== null ? `，det A = ${fmtNum(lv.det, 5)}` : ''}，κ(A) = {Number.isFinite(lv.cond) ? fmtNum(lv.cond, 3) : '∞'}；残差 {Number.isFinite(lv.residual) ? lv.residual.toExponential(2) : '—'}
          </span>
        </>
      ),
    },
    { kind: 'result', body: <span className="mono">f = ({lv.f?.map((v) => fmtNum(v, 5)).join(', ') ?? '—'})</span> },
    {
      kind: 'mid',
      title: 'Gibbs 相律 = 秩–零化度',
      body: (
        <>
          <MatrixView name="G" M={an.gd.G} rowLabels={names} colLabels={['S', 'x_A', 'x_B', 'x_C']} digits={3} />
          <span className="small">每行为一个相的 Gibbs–Duhem 方程 S dT + Σ xᵢ dμᵢ = 0；F = 4 − rank = {an.gd.F}。</span>
        </>
      ),
    },
    ...(an.sens.valid
      ? [
          {
            kind: 'op' as const,
            title: '成分灵敏度 ∂f/∂x₀',
            body: (
              <>
                <MatrixView name="∂f/∂(x_A, x_B)" M={an.sens.M} rowLabels={names} colLabels={['∂x_A', '∂x_B']} digits={3} />
                <span className="small">{an.sens.note}</span>
              </>
            ),
          },
        ]
      : [{ kind: 'phys' as const, body: <>{an.sens.note}</> }]),
    { kind: 'valid', body: <>封闭体系、恒压、平衡；相分数非负是物理约束（越界即说明相组合错误）。G 模型为示意参数。</> },
  ];
  return <Derivation title="此点的完整数学描述" steps={steps} initial="all" />;
}

// ===================================================================== 演化
function EvoTab({ an, history }: { an: PointAnalysis; history: { x: Comp; G: number; f: Record<string, number> }[] }) {
  const d = useStore((s) => s.diagram);
  const mode = useStore((s) => s.mode);
  const trace = useStore((s) => s.trace);
  const idx = useStore((s) => s.idx);
  const ids = useMemo(() => Array.from(new Set(trace.samples.flatMap((s) => s.eq.phases.map((p) => p.id)))), [trace]);
  const S = trace.samples;
  const cur = S[Math.min(S.length - 1, Math.round(idx))];
  if (mode === 'cooling') {
    const fs: Series[] = ids.map((id) => ({
      id,
      pts: S.filter((s) => s.xi < 0).map((s) => [toC(s.T), s.eq.phases.find((p) => p.id === id)?.frac ?? 0] as [number, number]),
      color: id === 'L' ? COLOR.phase.liquid : phaseColor(d, id),
      label: id,
    }));
    const gs: Series[] = [{ id: 'G', pts: S.filter((s) => s.xi < 0).map((s) => [toC(s.T), s.eq.G / 1000] as [number, number]), color: '#1d2229', label: 'G_eq(T)' }];
    // 当前温度的 df/dT（有限差分）
    const k = Math.min(S.length - 2, Math.max(0, Math.round(idx)));
    const a = S[k];
    const b = S[k + 1];
    const dT = a && b ? a.T - b.T : 0;
    return (
      <>
        <Sec title="冷却：x₀ 固定，温度为唯一变量" prov="model">
          <p className="small">
            封闭体系的总成分不随时间变化 —— 图中红色 x₀ 保持不动；移动的是液相成分 x_L（蓝色）与相分数。质量守恒在每一时刻都成立：Σ fᵢ cᵢ = x₀。
          </p>
          <XYPlot height={170} series={fs} ylim={[0, 1]} xlim={[toC(S[0].T), toC(S[S.length - 1].T)]} xlabel="T / °C（向右降温）" ylabel="相分数" vlines={[{ x: toC(cur.T), color: '#C00000', dash: '' }]} />
          <XYPlot height={140} series={gs} xlim={[toC(S[0].T), toC(S[S.length - 1].T)]} ylabel="G / kJ" legend={false} vlines={[{ x: toC(cur.T), color: '#C00000', dash: '' }]} />
        </Sec>
        {a && b && dT > 1e-6 && a.eq.key === b.eq.key && (
          <Sec title="此刻的变化率（降温 1 K）" prov="model">
            <table className="grid">
              <thead>
                <tr>
                  <th>相</th>
                  <th>−df/dT</th>
                  <th>含义</th>
                </tr>
              </thead>
              <tbody>
                {b.eq.phases.map((p) => {
                  const fa = a.eq.phases.find((q) => q.id === p.id)?.frac ?? 0;
                  const rate = (p.frac - fa) / dT;
                  return (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td className="num">{fmtNum(rate, 5)} /K</td>
                      <td className="small">{rate > 0 ? '增加（析出）' : rate < 0 ? (p.si < 0 ? '液相减少' : '减少（被回溶）') : '不变'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Sec>
        )}
      </>
    );
  }
  const n = history.length;
  const last = n >= 2 ? history[n - 1] : null;
  const prev = n >= 2 ? history[n - 2] : null;
  const dx: number[] | null = last && prev ? [0, 1, 2].map((i) => last.x[i] - prev.x[i]) : null;
  const pred = dx && an.sens.valid ? an.sens.M.map((r) => r[0] * dx[0] + r[1] * dx[1]) : null;
  const gs: Series[] = [{ id: 'G', pts: history.map((h, i) => [i, h.G / 1000] as [number, number]), color: '#1d2229', label: 'G_eq（拖动序列）' }];
  return (
    <>
      <Sec title="成分探索：T 固定，x₀ 为变量" prov="model">
        <p className="small">拖动 x₀ 时温度不变；相组合、相分数与 G_eq 随 x₀ 变化。G_eq(x₀) 是下凸包本身，因此它是 x₀ 的凸函数。</p>
        {n > 1 ? <XYPlot height={150} series={gs} xlabel="拖动步" ylabel="G_eq / kJ" legend={false} /> : <p className="dim">在左图中拖动 x₀ 以生成轨迹。</p>}
      </Sec>
      {dx && (
        <Sec title="最近一步：Δx₀ 与相分数响应" prov="math">
          <KV
            rows={[
              ['Δx₀', <span className="mono">({dx.map((v) => fmtNum(v, 4)).join(', ')})</span>],
              ['实际 Δf', <span className="mono">{Object.keys(last!.f).map((k) => `${k}: ${fmtNum((last!.f[k] ?? 0) - (prev!.f[k] ?? 0), 4)}`).join('，')}</span>],
              ['线性预测 (∂f/∂x₀)·Δx₀', <span className="mono">{pred ? an.phases.map((p, i) => `${p.id}: ${fmtNum(pred[i], 4)}`).join('，') : an.sens.note}</span>],
            ]}
          />
        </Sec>
      )}
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
        <Derivation title="界线上该点的推导" steps={steps} initial="all" />
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
        <Derivation title="不变点推导" steps={steps} initial="all" />
      </>
    );
  }
  return <p className="dim">在二维图中单击一条界线或一个不变点（E / U / P / e / p），这里将给出它的几何约束、向量关系、反应分类、热力学条件与逐步推导。</p>;
}

