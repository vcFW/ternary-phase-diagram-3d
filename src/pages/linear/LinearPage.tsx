import { AnalysisLayout, useSection, type Section } from '../../viz/PageLayout';
import { VectorsSection } from './VectorsSection';
import { ProjectionSection } from './ProjectionSection';
import { GeometrySection } from './GeometrySection';
import { LeverSection } from './LeverSection';

const SECTIONS: Section[] = [
  { id: 'vectors', title: '成分向量与坐标变换', sub: '重心坐标 ⇄ 笛卡尔坐标，矩阵 H' },
  { id: 'projection', title: '三维 → 二维投影', sub: '秩、零空间与信息损失' },
  { id: 'geometry', title: '等温线与界线的几何', sub: '梯度、切向量、温度方向' },
  { id: 'lever', title: '相分数的线性方程组', sub: '杠杆规则 / 重心坐标 / 条件数' },
];

export default function LinearPage() {
  const cur = useSection(SECTIONS);
  return (
    <AnalysisLayout
      page="linear"
      sections={SECTIONS}
      current={cur}
      note={<>全部计算使用顶部全局状态（x₀, T）。在任一图中拖动红色状态点，会同步改变所有页面的物理状态。</>}
    >
      {cur === 'vectors' && <VectorsSection />}
      {cur === 'projection' && <ProjectionSection />}
      {cur === 'geometry' && <GeometrySection />}
      {cur === 'lever' && <LeverSection />}
    </AnalysisLayout>
  );
}
