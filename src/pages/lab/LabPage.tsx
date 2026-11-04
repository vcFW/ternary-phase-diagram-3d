import { useMemo, useState } from 'react';
import { cel, solidColor } from '../../core/colors';
import { getPreset, PRESETS } from '../../core/presets';
import type { Comp } from '../../core/types';
import { tangentIntersect } from '../../math/curves';
import { combine, phaseFractions, sensitivity } from '../../math/lever';
import { fmtNum, gaussSteps, lstsq, solve, svd } from '../../math/linalg';
import { analyzeReaction } from '../../math/reaction';
import { runValidation, type Case } from '../../math/validation';
import { useStore } from '../../state/store';
import { ParamsEditor } from '../../app/GlobalBar';
import { AnalysisLayout, PageTitle, useSection, type Section } from '../../viz/PageLayout';
import { Handle, TernaryPlot } from '../../viz/TernaryPlot';
import { XYPlot } from '../../viz/XYPlot';
import { KV, MatrixView, Panel, Prov } from '../../viz/MathView';
import { NumField, Segmented } from '../../ui/controls';
import { LocalParam } from '../../ui/LocalParam';
import { COLOR } from '../../ui/tokens';

const SECTIONS: Section[] = [
  { id: 'validation', title: '验证算例（10 组）', sub: '解析 / 独立数值 / 文献参照' },
  { id: 'matrix', title: '矩阵实验室', sub: '自定义相点：分数、反应、消元' },
  { id: 'degenerate', title: '退化与病态', sub: '条件数、行列式、误差放大' },
  { id: 'params', title: '参数与示例体系', sub: '可编辑的热力学参数' },
  { id: 'assumptions', title: '模型假设与局限', sub: '含 pycalphad 集成评估' },
];

export default function LabPage() {
  const cur = useSection(SECTIONS);
  return (
    <AnalysisLayout page="lab" sections={SECTIONS} current={cur} note={<>本页所有计算与自动测试（npm test）调用同一批函数。</>}>
      {cur === 'validation' && <ValidationSection />}
      {cur === 'matrix' && <MatrixLab />}
      {cur === 'degenerate' && <DegenerateLab />}
      {cur === 'params' && <ParamsSection />}
      {cur === 'assumptions' && <Assumptions />}
    </AnalysisLayout>
  );
}

// ===================================================================== 验证
function ValidationSection() {
  const [run, setRun] = useState(0);
  const { cases, ms } = useMemo(() => {
    const t0 = performance.now();
    const c = runValidation();
    return { cases: c, ms: performance.now() - t0, run };
  }, [run]);
  const total = cases.reduce((s, c) => s + c.checks.length, 0);
  const pass = cases.reduce((s, c) => s + c.checks.filter((k) => k.pass).length, 0);
  return (
    <>
      <PageTitle title="可复现验证算例" desc="每个算例都有解析解、独立数值方法或文献公式作为参照；同一代码亦由 vitest 自动运行。" />
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={pass === total ? 'ok' : 'bad'}>
          {pass} / {total} 项检查通过
        </span>
        <span className="dim">耗时 {ms.toFixed(0)} ms</span>
        <button className="btn sm" onClick={() => setRun(run + 1)}>重新运行</button>
      </div>
      <div className="stack">
        {cases.map((c) => (
          <CaseCard key={c.id} c={c} />
        ))}
      </div>
    </>
  );
}

const BASIS: Record<Case['basis'], string> = { analytic: '解析参照', numeric: '独立数值参照', literature: '文献公式参照' };

function CaseCard({ c }: { c: Case }) {
  const ok = c.checks.every((k) => k.pass);
  return (
    <Panel title={`算例 ${c.id} · ${c.title}`} sub={BASIS[c.basis]} right={<span className={ok ? 'ok' : 'bad'}>{ok ? '全部通过' : '存在失败'}</span>}>
      <p className="small">{c.basisText}</p>
      <p className="small dim">{c.setup}</p>
      <table className="grid">
        <thead>
          <tr>
            <th>检查项</th>
            <th>参照</th>
            <th>期望</th>
            <th>计算</th>
            <th>误差</th>
            <th>容差</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c.checks.map((k, i) => (
            <tr key={i}>
              <td>{k.name}</td>
              <td className="small">{k.ref}</td>
              <td className="num">{k.expected}</td>
              <td className="num">{k.computed}</td>
              <td className="num">{k.err.toExponential(1)}</td>
              <td className="num">{k.tol === 0 ? '—' : k.tol.toExponential(0)}</td>
              <td className={k.pass ? 'ok' : 'bad'}>{k.pass ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ===================================================================== 矩阵实验室
const PRESET_SETS: Record<string, { name: string; p: Comp[]; c0: Comp }> = {
  normal: { name: '一般三角形', p: [[0.8, 0.1, 0.1], [0.1, 0.75, 0.15], [0.15, 0.2, 0.65]], c0: [0.4, 0.33, 0.27] },
  outside: { name: '总成分在三角形外', p: [[0.6, 0.3, 0.1], [0.3, 0.6, 0.1], [0.4, 0.4, 0.2]], c0: [0.3, 0.3, 0.4] },
  collinear: { name: '三点共线（奇异）', p: [[0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.4, 0.4, 0.2]], c0: [0.4, 0.4, 0.2] },
  thin: { name: '扁三角形（病态）', p: [[0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.4, 0.399, 0.201]], c0: [0.4, 0.3995, 0.2005] },
  four: { name: '四相（欠定）', p: [[0.33, 0.33, 0.34], [1, 0, 0], [0, 1, 0], [0, 0, 1]], c0: [0.4, 0.3, 0.3] },
  two: { name: '两相（超定）', p: [[0.8, 0.1, 0.1], [0.2, 0.5, 0.3]], c0: [0.5, 0.3, 0.2] },
};

function MatrixLab() {
  const d = useStore((s) => s.diagram);
  const [p, setP] = useState<Comp[]>(PRESET_SETS.normal.p);
  const [c0, setC0] = useState<Comp>(PRESET_SETS.normal.c0);
  const [key, setKey] = useState('normal');
  const r = phaseFractions(p, c0);
  const rx = analyzeReaction(p.map((x, i) => ({ label: `φ${i + 1}`, x, si: i === 0 && p.length === 4 ? -1 : i })));
  const el = p.length <= 3 ? gaussSteps(r.A.map((row, i) => [...row, r.b[i]])) : null;
  const sens = sensitivity(p, c0);
  const ls = lstsq(r.A, r.b);
  const lu = p.length === 3 ? solve(r.A, r.b) : null;
  const sv = svd(r.A);
  const edit = (i: number, j: number, v: number) => {
    // 编辑第 j 个组元，其余两个按比例缩放，保持 Σ = 1
    const upd = (x: Comp): Comp => {
      const y = [...x] as Comp;
      const rest = 1 - y[j];
      const nv = Math.min(1, Math.max(0, v));
      const k1 = (j + 1) % 3;
      const k2 = (j + 2) % 3;
      if (rest < 1e-12) {
        y[k1] = (1 - nv) / 2;
        y[k2] = (1 - nv) / 2;
      } else {
        y[k1] *= (1 - nv) / rest;
        y[k2] *= (1 - nv) / rest;
      }
      y[j] = nv;
      return y;
    };
    if (i < 0) setC0(upd(c0));
    else setP(p.map((x, k) => (k === i ? upd(x) : x)));
  };
  const names = p.map((_, i) => `φ${i + 1}`);
  return (
    <>
      <PageTitle title="矩阵实验室" desc="输入任意相成分点：同一个成分矩阵同时回答「相分数是多少」（Af = b）与「能发生什么反应」（Nν = 0）。" />
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <Segmented
          size="sm"
          value={key}
          onChange={(k) => {
            setKey(k);
            setP(PRESET_SETS[k].p);
            setC0(PRESET_SETS[k].c0);
          }}
          options={Object.entries(PRESET_SETS).map(([k, v]) => ({ value: k, label: v.name }))}
        />
      </div>
      <div className="cols c12">
        <div className="stack">
          <Panel title="相点（可拖动 / 输入）" prov="math">
            <div className="plot-box short">
              <TernaryPlot d={d} background="none" boundaries={false} invariants={false} solids={false} minHeight={240}>
                {(m) => (
                  <>
                    {p.length >= 3 && <polygon points={p.slice(0, p.length === 4 ? 4 : 3).map((x) => m.px(x).join(',')).join(' ')} className={`tri-fill ${r.status === 'ok' ? '' : 'bad'}`} />}
                    {p.length === 2 && (() => { const a = m.px(p[0]); const b = m.px(p[1]); return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="lnk" strokeWidth={2} />; })()}
                    {p.map((x, i) => <Handle key={i} m={m} x={x} color={solidColor(i)} label={names[i]} onDrag={(y) => setP(p.map((z, k) => (k === i ? y : z)))} />)}
                    <Handle m={m} x={c0} onDrag={setC0} label="c₀" />
                  </>
                )}
              </TernaryPlot>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th />
                  <th>x_A</th>
                  <th>x_B</th>
                  <th>x_C</th>
                </tr>
              </thead>
              <tbody>
                {[...p, c0].map((x, i) => (
                  <tr key={i}>
                    <th>{i < p.length ? names[i] : 'c₀'}</th>
                    {[0, 1, 2].map((j) => (
                      <td key={j}>
                        <NumField value={x[j]} min={0} max={1} step={0.01} digits={4} width={64} onCommit={(v) => edit(i < p.length ? i : -1, j, v)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">修改某个分量时，另两个分量按比例缩放以保持 Σ = 1（成分约束）。</p>
          </Panel>
          <Panel title="几何解与代数解的对照" prov="math">
            <table className="grid">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>f</th>
                </tr>
              </thead>
              <tbody>
                {r.cramer && r.det && <tr><td>Cramer 法则</td><td className="num">{r.f!.map((v) => fmtNum(v, 6)).join(', ')}</td></tr>}
                {r.areas && r.areas.total !== 0 && <tr><td>子三角形面积比（几何）</td><td className="num">{r.areas.sub.map((s) => fmtNum(s / r.areas!.total, 6)).join(', ')}</td></tr>}
                {lu && <tr><td>列主元 LU</td><td className="num">{lu.map((v) => fmtNum(v, 6)).join(', ')}</td></tr>}
                <tr><td>SVD 伪逆（最小范数最小二乘）</td><td className="num">{ls.x.map((v) => fmtNum(v, 6)).join(', ')}（残差 {ls.residual.toExponential(1)}）</td></tr>
                {el?.x && <tr><td>高斯消元回代</td><td className="num">{el.x.map((v) => fmtNum(v, 6)).join(', ')}</td></tr>}
              </tbody>
            </table>
            {r.f && <p className="small">回代检验：Σ fᵢcᵢ = ({combine(p, r.f).map((v) => fmtNum(v, 6)).join(', ')})，c₀ = ({c0.map((v) => fmtNum(v, 6)).join(', ')})。</p>}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="相分数系统 A f = b" prov="math">
            <MatrixView name="[A | b]" M={r.A.map((row, i) => [...row, r.b[i]])} rowLabels={['x_A', 'x_B', 'Σ']} colLabels={[...names, 'c₀']} colColors={[...p.map((_, i) => solidColor(i)), '#1d2229']} aug={p.length} digits={5} />
            <KV
              rows={[
                ['rank A / 相数', <span className="mono">{r.rank} / {p.length}</span>],
                ['奇异值 σ', <span className="mono">{sv.S.slice(0, Math.min(3, p.length)).map((v) => fmtNum(v, 6)).join(', ')}</span>],
                ['det A', <span className="mono">{r.det !== null ? fmtNum(r.det, 6) : '（非方阵）'}</span>],
                ['κ(A)', <span className="mono">{Number.isFinite(r.cond) ? fmtNum(r.cond, 4) : '∞'}</span>],
                ['实测误差放大 / κ 上界', <span className="mono">{sens ? `${fmtNum(sens.amp, 3)} / ${Number.isFinite(sens.kappa) ? fmtNum(sens.kappa, 3) : '∞'}` : '—'}</span>],
                ['状态', <span className={r.status === 'ok' ? 'ok' : 'bad'}>{r.status}</span>],
              ]}
            />
            <p className="small">{r.message}</p>
          </Panel>
          <Panel title="反应系统 N ν = 0" prov="math" sub={p.length === 4 ? 'φ1 视为液相（ν = −1 归一）' : ''}>
            <MatrixView name="N" M={rx.N} rowLabels={['A', 'B', 'C']} colLabels={names} colColors={p.map((_, i) => solidColor(i))} digits={4} />
            <KV
              rows={[
                ['rank N / dim ker N', <span className="mono">{rx.rank} / {rx.nullDim}</span>],
                ['ν', <span className="mono">{rx.nu ? `(${rx.nu.map((v) => fmtNum(v, 4)).join(', ')})` : '—'}</span>],
                ['反应', <span className="mono">{rx.text}</span>],
              ]}
            />
            <p className="small">{rx.message}</p>
          </Panel>
          {el && (
            <Panel title="高斯消元过程" prov="math">
              {el.steps.map((s, i) => (
                <div key={i}>
                  <div className="small dim">{s.op}</div>
                  <MatrixView M={s.M} aug={p.length} digits={5} />
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

// ===================================================================== 退化与病态
function DegenerateLab() {
  const [le, setLe] = useState(-1.5);
  const eps = Math.pow(10, le);
  const tri = (e: number): Comp[] => [
    [0.7, 0.2, 0.1],
    [0.2, 0.7, 0.1],
    [0.45 - e / 2, 0.45 - e / 2, 0.1 + e],
  ];
  const curve = useMemo(() => {
    const out: { e: number; k: number; det: number; amp: number }[] = [];
    for (let l = -6; l <= 0; l += 0.1) {
      const e = Math.pow(10, l);
      const P = tri(e);
      const c = combine(P, [0.3, 0.3, 0.4]);
      const r = phaseFractions(P, c);
      const s = sensitivity(P, c, 1e-7);
      out.push({ e: l, k: Math.log10(r.cond), det: Math.log10(Math.abs(r.det ?? 1e-300)), amp: s ? Math.log10(s.amp) : NaN });
    }
    return out;
  }, []);
  const P = tri(eps);
  const c = combine(P, [0.3, 0.3, 0.4]);
  const r = phaseFractions(P, c);
  const s = sensitivity(P, c, 1e-7);
  // 切线与连线近平行
  const [ang, setAng] = useState(20);
  const th = (ang * Math.PI) / 180;
  const ti = tangentIntersect([0.4, 0.2], [Math.cos(th), Math.sin(th)], [1, 0, 0], [0, 1, 0]);
  return (
    <>
      <PageTitle title="退化与病态配置" desc="奇异与病态不是数值噪声，而是几何退化：三角形变扁、直线趋于平行。" />
      <div className="cols c2">
        <Panel title="扁三角形：第三个相点逼近 φ1φ2 连线" prov="math">
          <LocalParam label="log₁₀ ε" labelWidth={64} value={le} min={-6} max={0} step={0.05} digits={2} onChange={setLe} />
          <XYPlot
            height={240}
            series={[
              { id: 'k', pts: curve.map((q) => [q.e, q.k] as [number, number]), color: '#c00000', label: 'log₁₀ κ(A)' },
              { id: 'd', pts: curve.map((q) => [q.e, q.det] as [number, number]), color: COLOR.accent, label: 'log₁₀ |det A|' },
              { id: 'a', pts: curve.map((q) => [q.e, q.amp] as [number, number]), color: '#77ac30', dash: '4 3', label: 'log₁₀ 实测相对误差放大' },
            ]}
            xlabel="log₁₀ ε（第三点到连线的距离尺度）"
            vlines={[{ x: le, color: '#7b8490' }]}
          />
          <KV
            rows={[
              ['ε', <span className="mono">{eps.toExponential(2)}</span>],
              ['det A', <span className="mono">{fmtNum(r.det ?? NaN, 8)}</span>],
              ['κ(A)', <span className="mono">{Number.isFinite(r.cond) ? r.cond.toExponential(3) : '∞'}</span>],
              ['实测放大（c₀ 扰动 10⁻⁷）', <span className="mono">{s ? s.amp.toExponential(3) : '—'}</span>],
              ['f（真值 0.3, 0.3, 0.4）', <span className="mono">{r.f?.map((v) => fmtNum(v, 8)).join(', ')}</span>],
            ]}
          />
          <p className="small">
            det A ∝ ε（三角形面积），κ ∝ 1/ε：斜率为 −1 的直线。实测放大始终不超过 κ，且随 ε 同比例增长。物理含义：若三个平衡相成分几乎共线，测量到的成分误差会被放大成巨大的相分数误差 ——
            这类数据上用"重心规则"读相分数是不可靠的。
          </p>
        </Panel>
        <Panel title="切线与连线趋于平行" prov="math">
          <LocalParam label="切线倾角" labelWidth={64} value={ang} min={0} max={90} step={0.1} digits={1} unit="°" onChange={setAng} />
          <MatrixView name="[t | −(b−a)]" M={ti.M} digits={6} />
          <KV
            rows={[
              ['det', <span className="mono">{fmtNum(ti.det, 8)}</span>],
              ['(τ, λ)', <span className="mono">{Number.isFinite(ti.tau) ? `(${fmtNum(ti.tau, 4)}, ${fmtNum(ti.lambda, 4)})` : '无交点（平行）'}</span>],
              ['判定', <span>{ti.kind === 'parallel' ? '退化：切线规则无结论' : ti.kind === 'eutectic' ? '交点在线段内' : '交点在线段外'}</span>],
            ]}
          />
          <p className="small">倾角 → 0 时 det = sin θ → 0，交点 λ 发散至 ±∞：界线在该处恰好平行于两固相连线，"共晶 / 转熔"的分界正好经过这里 —— 在 λ = ±∞ 两侧类型相同但被回溶的相互换。</p>
        </Panel>
      </div>
    </>
  );
}

// ===================================================================== 参数
function ParamsSection() {
  const d = useStore((s) => s.diagram);
  const presetId = useStore((s) => s.presetId);
  const loadPreset = useStore((s) => s.loadPreset);
  const preset = getPreset(presetId);
  return (
    <>
      <PageTitle title="参数与示例体系" desc="全部为假想组元 A–B–C 的示意参数；改变后所有页面同步重算（拓扑由模型自动推出）。" />
      <div className="cols c2">
        <div className="stack">
          <Panel title="示例体系" prov="demo">
            <div className="stack" style={{ gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.id} className={`btn ${p.id === presetId ? 'on' : ''}`} style={{ textAlign: 'left' }} onClick={() => loadPreset(p.id)}>
                  <b>{p.short}</b> <span className="dim">· {p.name}</span>
                </button>
              ))}
            </div>
            <p className="small">{preset.description}</p>
          </Panel>
          <Panel title="可编辑参数" prov="demo">
            <ParamsEditor />
          </Panel>
        </div>
        <Panel title="当前参数与派生常数" prov="model">
          <table className="grid">
            <thead>
              <tr>
                <th>组元</th>
                <th>Tm</th>
                <th>ΔH_fus / (J·mol⁻¹)</th>
              </tr>
            </thead>
            <tbody>
              {d.params.components.map((c, i) => (
                <tr key={c.symbol}>
                  <td><i className="swatch" style={{ background: solidColor(i) }} />{c.symbol}</td>
                  <td className="num">{cel(c.Tm, 1)}</td>
                  <td className="num">{c.dH}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="grid">
            <thead>
              <tr>
                <th>固相</th>
                <th>组成 n</th>
                <th>ΔH_f</th>
                <th>H_s</th>
                <th>S_s</th>
              </tr>
            </thead>
            <tbody>
              {d.solids.map((s) => (
                <tr key={s.id}>
                  <td><i className="swatch" style={{ background: solidColor(s.index) }} />{s.label}（{s.formula}）</td>
                  <td className="num">{s.n.map((v) => fmtNum(v, 3)).join(', ')}</td>
                  <td className="num">{fmtNum(s.dHf, 1)}</td>
                  <td className="num">{fmtNum(s.Hs, 1)}</td>
                  <td className="num">{fmtNum(s.Ss, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <KV
            rows={[
              ['Ω_AB, Ω_AC, Ω_BC', <span className="mono">{d.params.omega.AB}, {d.params.omega.AC}, {d.params.omega.BC} J/mol</span>],
              ['Cp（仅用于冷却时间轴）', <span className="mono">{d.params.Cp} J/(mol·K)</span>],
              ['不变点', <span>{d.topo.invariants.map((iv) => `${iv.label} ${cel(iv.T, 1)}`).join('；')}</span>],
            ]}
          />
          <p className="small">H_s、S_s 为饱和温度闭式解 T_s(x) = (H_s + Σnμᴱˣ)/(S_s − RΣn ln x) 中的常数。</p>
        </Panel>
      </div>
    </>
  );
}

// ===================================================================== 假设
function Assumptions() {
  return (
    <>
      <PageTitle title="模型假设与局限" desc="每一条结论都依赖某些假设；这里集中列出。" />
      <div className="cols c2">
        <Panel title="热力学模型" prov="assume">
          <table className="grid">
            <tbody>
              <tr><th>液相</th><td>三元正规溶液：G_ex = Σ Ωᵢⱼ xᵢxⱼ，S_ex = 0。无三元项、无液–液分层（构造式求解器不支持；LP 求解器支持）。</td></tr>
              <tr><th>固相</th><td>两类：化学计量相（G_s = ΔH_f − TΔS_f，互不溶）；固溶体相（正规溶液 G = Σyᵢ°Gᵢ + RTΣy ln y + ΣΩᵢⱼyᵢyⱼ，°Gᵢ 为晶格稳定性）。同一体系中可并存。</td></tr>
              <tr><th>求解器</th><td>化学计量体系：构造式精确求解（闭式饱和温度）。含固溶体：网格线性规划 + KKT 牛顿精化 + 加 / 去相迭代；等温截面由自由能面下凸包得到（相界分辨率约 1/64）。</td></tr>
              <tr><th>热容</th><td>各相共用同一 Cp，ΔCp = 0 ⇒ ΔH、ΔS 与温度无关。</td></tr>
              <tr><th>压力</th><td>恒压，忽略体积项；相律使用 F = C − P + 1。</td></tr>
              <tr><th>参数</th><td>全部为假想组元的示意值，<b>不代表任何真实材料</b>；不得用于工程设计。</td></tr>
              <tr><th>固溶体演示模型</th><td>二元、两条正规溶液曲线；仅用于演示公切线与随温度变化的平衡成分。</td></tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="数值方法与已知局限" prov="assume">
          <ul className="plain">
            <li>界线由 150×150 三角栅格提取并求精；切向量用局部二次拟合，端点附近精度较低。</li>
            <li>平衡求解有两套独立实现（构造式与线性规划 + 列生成），互相校验；后者收敛精度约 10⁻² J/mol。</li>
            <li>冷却：平衡冷却（无过冷、无偏析）；Scheil 为非平衡极限而非动力学预测。</li>
            <li>数值容差：秩判定采用 max(m,n)·ε·σ_max（与 MATLAB rank 一致的量级）；相分数非负判定 −10⁻⁹。</li>
          </ul>
        </Panel>
        <Panel title="pycalphad / CALPHAD 集成评估" prov="assume">
          <p>
            <b>结论：</b>当前不直接集成，推荐"离线计算 + 数据接口"路径。
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>方案</th>
                <th>可行性</th>
                <th>代价</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>浏览器内运行（Pyodide + pycalphad）</td><td>理论可行</td><td>数十 MB 下载、启动慢，依赖（symengine 等）在 WebAssembly 中支持不完整；不适合交互拖动。</td></tr>
              <tr><td>本地 Python 后端服务</td><td>可行</td><td>需要额外进程与 API；破坏当前纯静态、可离线运行的部署方式。</td></tr>
              <tr><td>离线计算 (x, T) 网格 → JSON</td><td><b>推荐</b></td><td>以相同的 Equilibrium / Topology 接口替换 Thermo；前端无需改动页面。</td></tr>
            </tbody>
          </table>
          <p>
            前提是获得<b>经过验证的 TDB 热力学数据库</b>（及其许可）。本环境未安装 pycalphad，也没有可用的已验证数据库；按要求不编造真实材料数据。
            接入时，任何数值求解器都应先通过本页"验证算例"中的同类检查（守恒、化学势相等、与独立方法对照）。
          </p>
        </Panel>
        <Panel title="结论分类约定" prov="math">
          <p>全平台用以下标记区分结论的来源：</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Prov k="math" /> <span className="small">仅由守恒与几何推出，与模型无关</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Prov k="model" /> <span className="small">依赖热力学模型（示意参数）的计算</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Prov k="demo" /> <span className="small">另行构造的演示模型</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Prov k="assume" /> <span className="small">假设或适用条件</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Prov k="unknown" /> <span className="small">由现有数据（例如仅有二维投影）无法唯一确定</span>
          </div>
        </Panel>
      </div>
    </>
  );
}
