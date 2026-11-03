import { AnalysisLayout, useSection, type Section } from '../../viz/PageLayout';
import { BinarySection } from './BinarySection';
import { TernaryGSection } from './TernaryGSection';
import { StabilitySection } from './StabilitySection';
import { ReactionGSection } from './ReactionGSection';

const SECTIONS: Section[] = [
  { id: 'binary', title: '二元公切线', sub: '下凸包 · 化学势 = 截距' },
  { id: 'ternary', title: '三元公切面与吉布斯能最小化', sub: '线性规划：原问题 = 杠杆，对偶 = 化学势' },
  { id: 'stability', title: '温度与相稳定性', sub: '驱动力 · 液相线即稳定性极限' },
  { id: 'reaction', title: 'ΔG_r 与自由能曲面的区别', sub: '两种"自由能图"' },
];

export default function ThermoPage() {
  const cur = useSection(SECTIONS);
  return (
    <AnalysisLayout
      page="thermo"
      sections={SECTIONS}
      current={cur}
      note={
        <>
          热力学模型：液相正规溶液 + 化学计量固相或固溶体相（示意参数，非真实材料）。二元公切线一节的"固溶体演示模型"为另行构造、明确标注的二元模型。
        </>
      }
    >
      {cur === 'binary' && <BinarySection />}
      {cur === 'ternary' && <TernaryGSection />}
      {cur === 'stability' && <StabilitySection />}
      {cur === 'reaction' && <ReactionGSection />}
    </AnalysisLayout>
  );
}
