import type { ReactNode } from 'react';
import { AnalysisLayout, useSection, type Section } from '../../viz/PageLayout';
import { LeverRule, GravityRule, RatioRule } from './LinearRules';
import { AlkemadeRule, TangentRule } from './CurveRules';
import { PathRule, PhaseRule, InvariantRule } from './SystemRules';

const SECTIONS: Section[] = [
  { id: 'lever', title: '直线规则与杠杆规则', sub: '两相：共线 + 线段比' },
  { id: 'gravity', title: '重心规则（三角形规则）', sub: '重心位 / 交叉位 / 共轭位' },
  { id: 'ratio', title: '等比例规则与背向线规则', sub: '过顶点的直线；初晶时液相背离固相' },
  { id: 'alkemade', title: '连线规则 · Alkemade 定理', sub: '界线温度极大点' },
  { id: 'tangent', title: '切线规则', sub: '共晶型 / 转熔型界线的判别' },
  { id: 'path', title: '结晶路径规则与结晶终点', sub: '初晶区 → 界线 → 不变点' },
  { id: 'phaserule', title: 'Gibbs 相律', sub: '秩–零化度定理' },
  { id: 'invariant', title: '不变点与反应分类', sub: '零空间 · 三层区分' },
];

export default function RulesPage() {
  const cur = useSection(SECTIONS);
  return (
    <AnalysisLayout page="rules" sections={SECTIONS} current={cur} note={<>每条规则按五层展开：定义与假设 → 几何解释 → 数学推导 → 物理意义 → 交互验证与反例。</>}>
      {cur === 'lever' && <LeverRule />}
      {cur === 'gravity' && <GravityRule />}
      {cur === 'ratio' && <RatioRule />}
      {cur === 'alkemade' && <AlkemadeRule />}
      {cur === 'tangent' && <TangentRule />}
      {cur === 'path' && <PathRule />}
      {cur === 'phaserule' && <PhaseRule />}
      {cur === 'invariant' && <InvariantRule />}
    </AnalysisLayout>
  );
}

/**
 * 五层解释框架。默认展开 ① 定义与假设 和 ④ 物理意义；② 几何、③ 数学推导、⑤ 验证与反例折叠，点击展开。
 */
export function Layers5({ def, geo, math, phys, verify }: { def: ReactNode; geo: ReactNode; math: ReactNode; phys: ReactNode; verify?: ReactNode }) {
  const item = (title: string, body: ReactNode, open = false) => (
    <details open={open}>
      <summary>{title}</summary>
      <div className="lv">{body}</div>
    </details>
  );
  return (
    <div className="layer5">
      {item('① 定义与假设', def, true)}
      {item('② 几何解释', geo)}
      {item('③ 数学推导', math)}
      {item('④ 物理意义', phys, true)}
      {verify && item('⑤ 验证与反例', verify)}
    </div>
  );
}
