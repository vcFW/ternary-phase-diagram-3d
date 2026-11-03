import { useState, type ReactNode } from 'react';
import { fmtNum, type Mat } from '../math/linalg';

/**
 * 数学对象的显示组件：矩阵（列可高亮并与几何对象联动）、公式、推导步骤、结论来源标记。
 * 所有数值均来自确定性的计算模块；这里只负责呈现。
 */

export function MatrixView({
  M,
  rowLabels,
  colLabels,
  colColors,
  hiCol,
  onHoverCol,
  aug,
  digits = 4,
  name,
  hiCells,
}: {
  M: Mat;
  rowLabels?: string[];
  colLabels?: string[];
  colColors?: string[];
  hiCol?: number | null;
  onHoverCol?: (j: number | null) => void;
  /** 增广分隔线位于第 aug 列之前 */
  aug?: number;
  digits?: number;
  name?: ReactNode;
  hiCells?: [number, number][];
}) {
  const n = M[0]?.length ?? 0;
  return (
    <div className="mat-wrap">
      {name && <span className="mat-name">{name} =</span>}
      <table className="mat" onMouseLeave={() => onHoverCol?.(null)}>
        {colLabels && (
          <thead>
            <tr>
              {rowLabels && <th />}
              <th className="br" />
              {colLabels.map((c, j) => (
                <th key={j} className={`${hiCol === j ? 'hi' : ''} ${aug === j ? 'aug' : ''}`} style={{ color: colColors?.[j] }} onMouseEnter={() => onHoverCol?.(j)}>
                  {c}
                </th>
              ))}
              <th className="br" />
            </tr>
          </thead>
        )}
        <tbody>
          {M.map((r, i) => (
            <tr key={i}>
              {rowLabels && <th className="rl">{rowLabels[i]}</th>}
              <td className={`br l ${i === 0 ? 'top' : ''} ${i === M.length - 1 ? 'bot' : ''}`} />
              {r.map((v, j) => (
                <td
                  key={j}
                  className={`mono ${hiCol === j ? 'hi' : ''} ${aug === j ? 'aug' : ''} ${hiCells?.some(([a, b]) => a === i && b === j) ? 'cell' : ''}`}
                  onMouseEnter={() => onHoverCol?.(j)}
                >
                  {fmtNum(v, digits)}
                </td>
              ))}
              <td className={`br r ${i === 0 ? 'top' : ''} ${i === M.length - 1 ? 'bot' : ''}`} />
            </tr>
          ))}
        </tbody>
      </table>
      {n === 0 && <span className="dim">（空）</span>}
    </div>
  );
}

export function VecView({ v, labels, digits = 4, name }: { v: number[]; labels?: string[]; digits?: number; name?: ReactNode }) {
  return <MatrixView M={v.map((x) => [x])} rowLabels={labels} digits={digits} name={name} />;
}

/** 行内数学（衬线斜体），保持国际通用记号 */
export function M({ children }: { children: ReactNode }) {
  return <span className="m">{children}</span>;
}

/** 独立成行的公式 */
export function Eq({ children, tag }: { children: ReactNode; tag?: string }) {
  return (
    <div className="eqn">
      <span className="m">{children}</span>
      {tag && <span className="eqn-tag">({tag})</span>}
    </div>
  );
}

/** 结论来源：数学推导 / 模型计算 / 假设 / 不可确定 —— 原则 6 要求三者明确区分 */
export type ProvKind = 'math' | 'model' | 'assume' | 'unknown' | 'demo';
const PROV: Record<ProvKind, string> = {
  math: '数学推导',
  model: '模型计算',
  assume: '假设',
  unknown: '无法唯一确定',
  demo: '演示模型',
};
export function Prov({ k, title }: { k: ProvKind; title?: string }) {
  return (
    <span className={`prov ${k}`} title={title}>
      {PROV[k]}
    </span>
  );
}

export type StepKind = 'known' | 'assume' | 'govern' | 'op' | 'mid' | 'result' | 'phys' | 'valid';
export const STEP_NAME: Record<StepKind, string> = {
  known: '已知量',
  assume: '假设',
  govern: '控制方程',
  op: '数学运算',
  mid: '中间结果',
  result: '最终结果',
  phys: '物理解释',
  valid: '适用条件',
};

export interface Step {
  kind: StepKind;
  title?: string;
  body: ReactNode;
}

/** 逐步推导：可单步前进 / 后退，或全部展开 */
export function Derivation({ steps, title, initial }: { steps: Step[]; title?: string; initial?: 'all' | 'step' }) {
  const [mode, setMode] = useState<'all' | 'step'>(initial ?? 'step');
  const [k, setK] = useState(steps.length - 1);
  const shown = mode === 'all' ? steps.length : Math.min(steps.length, k + 1);
  return (
    <div className="deriv">
      <div className="deriv-head">
        {title && <b>{title}</b>}
        <span className="grow" />
        <div className="seg sm">
          <button className={mode === 'step' ? 'on' : ''} onClick={() => { setMode('step'); setK(0); }}>逐步</button>
          <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>全部</button>
        </div>
        {mode === 'step' && (
          <>
            <button className="btn sm" disabled={k <= 0} onClick={() => setK(Math.max(0, k - 1))}>上一步</button>
            <span className="mono dim">{Math.min(k + 1, steps.length)}/{steps.length}</span>
            <button className="btn sm" disabled={k >= steps.length - 1} onClick={() => setK(Math.min(steps.length - 1, k + 1))}>下一步</button>
          </>
        )}
      </div>
      <ol className="deriv-list">
        {steps.slice(0, shown).map((s, i) => (
          <li key={i} className={`st ${s.kind} ${mode === 'step' && i === shown - 1 ? 'cur' : ''}`}>
            <span className="st-kind">{STEP_NAME[s.kind]}</span>
            <div className="st-body">
              {s.title && <div className="st-title">{s.title}</div>}
              {s.body}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 键值表 */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 面板：页面内的分区卡片（标题 + 可选右侧控件） */
export function Panel({ title, sub, right, children, className, prov }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; prov?: ProvKind }) {
  return (
    <section className={`card panel ${className ?? ''}`}>
      <header className="card-head">
        <span className="card-title">{title}</span>
        {prov && <Prov k={prov} />}
        {sub && <span className="card-sub">{sub}</span>}
        <span className="grow" />
        {right}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const f4 = (v: number) => fmtNum(v, 4);
