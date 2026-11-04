# P2.6 设计文档：`DiagramSource` 接口（真实体系接入，本轮不实现）

## 目标

让 `PhaseDiagram`（示意热力学模型 + 自动拓扑）只是"相图数据源"的一个实现，为将来接入**离线 CALPHAD 计算**
（pycalphad 的 (x, T) 网格 JSON）预留位置，而界面与数学层无需改动。

## 为什么本轮不做

教学价值高，但需要**可信的 TDB 数据与验证**；Pyodide + pycalphad 的体积与启动时间在浏览器中不可接受。
推荐路径：离线用 CALPHAD 计算 → 导出网格 JSON → 前端只读取。

## 接口草案

```ts
export interface DiagramSource {
  /** 体系标识与组元 / 相的元数据 */
  readonly id: string;
  readonly components: ComponentDef[];
  readonly phases: PhaseMeta[];                // 名称、类型（液相 / 化学计量 / 固溶体）、颜色键
  /** 温度范围 / K */
  tRange(): { Tmin: number; Tmax: number };
  /** 平衡：返回相组成、相分数、吉布斯能；hint 用于热启动 */
  equilibrium(x: Comp, T: number, hint?: Equilibrium | null): Equilibrium;
  /** 液相线温度与初晶相 */
  liquidus(x: Comp): { T: number; si: number };
  /** 拓扑（界线 / 不变点 / 初晶区 / 化合物信息） */
  readonly topo: Topology;
  /** 截面（可由 equilibrium 推出，数据源可提供加速实现） */
  isoSection?(T: number): IsoSection;
  verticalRaster?(spec: VerticalSpec, W: number, H: number, Tmin: number, Tmax: number): VerticalRaster;
  /** 化学势 / 驱动力等"模型计算"类量；真实数据源可不提供 → 对应页面降级为"不可用"并标注 */
  thermo?: ThermoModel;
}
```

- `PhaseDiagram implements DiagramSource`：现有字段（`th`、`solids`、`sol` 等）作为内部实现细节，页面通过接口访问。
- **网格数据源** `GridSource`：读取 `{ components, phases, x: 网格, T: 网格, phaseFractions, phaseCompositions }` 的 JSON，
  `equilibrium` 做双线性 / 重心插值；拓扑由离线脚本同时导出（界线折线、不变点、反应式）。
- 来源标记：数据源声明 `provenance: 'demo-model' | 'calphad-grid'`；页面据此显示"示意模型 / CALPHAD 数据（来源、版本、TDB 引用）"徽标。

## 需要先解决的事

1. 数据来源与许可证（TDB 的出处、可再分发性）。
2. 验证：与文献相图 / 实验数据对照的基准算例；插值误差上限。
3. 页面降级策略：缺少化学势 / 驱动力时，"吉布斯自由能与热力学"页的哪些章节可用。
4. 网格数据体积（压缩、按需分块加载）。
