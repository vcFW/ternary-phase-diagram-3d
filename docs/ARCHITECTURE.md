# 架构说明

> 与 `docs/ITERATION_PLAN.md`（v4）实施后的代码一致。文件路径相对仓库根目录。

## 1. 状态流

```
顶栏 GlobalBar ──► store (zustand) ──► 同步派生 / 异步派生 ──► 视图
 体系·模式·x₀·T·参数     src/state/store.ts      derived.ts / asyncCompute.ts      页面 / 图窗 / 三维
```

- **全局状态只在顶栏改**：体系、交互模式、x₀、T、热力学参数五项。页面内只允许"局部参数"，一律用 `ui/LocalParam`（带"局部"徽标，可"↦ 设为全局"）。
  冷却模式下 x₀ 是只读文本。冷却时间轴全站只有一个：`panels/CoolingTransport`（工作台底部与凝固路径页共用）。
- **store**（`src/state/store.ts`）：`presetId / override / diagram / x0 / T / eq / trace / idx / mode / section / overlays / history …`。
  - 化学计量体系：`PhaseDiagram` 同步构建（< 50 ms）。
  - 含固溶体的体系：`withDiagram()` 把拓扑提取、液相面网格、冷却轨迹交给计算 Worker，期间 `computing = true`、
    `pendingPreset` 记录目标体系；主线程收到结果后用预计算数据构造 `PhaseDiagram`。旧图保持显示（顶栏进度条 + 灰度 60%）。
  - 成分改变时冷却轨迹：化学计量体系同步；固溶体体系经"最新者优先"通道异步更新（期间沿用同一相图上的旧轨迹）。
  - `asyncTick`：异步结果到达计数；依赖异步缓存的视图（二维图、三维场景、垂直截面）订阅它重绘。
- **派生计算的唯一入口**：
  - `state/derived.ts`：同步派生（`memo` 缓存、`usePointAnalysis`、`invariantAnalyses`、`useDerived`）。
  - `state/asyncCompute.ts`：异步派生（`isoOf`、`verticalOf`、`regionSlicesOf`、`useScheil`）。固溶体体系先粗后精（等温截面 N = 32 → 64；
    垂直截面 40 行 → 120 行），按 `(diagram.uid, 量化参数)` 缓存；未就绪时返回同一相图上最近一次的结果（stale）。
  - 页面组件不直接调用 `computeTrace / scheil / hullSection / verticalRaster`。
- **URL 深链接**：`app/AppShell.tsx` 的 `useUrlSync` 把 `(体系, x₀, T, 参数)` 与地址栏双向同步（`state/urlState.ts`）。

## 2. 计算 Worker（`src/compute/`）

| 文件 | 作用 |
| --- | --- |
| `api.ts` | Worker 与"无 Worker 环境（Node 测试）"共用的纯函数：`build`（拓扑 + 液相面网格 + 冷却轨迹）、`iso`、`vertical`、`regionSlices`、`trace`、`scheil`；入参 / 返回值均为可结构化克隆的纯数据，相图实例按参数哈希缓存在计算方内部 |
| `worker.ts` | `comlink.expose(computeApi)` |
| `client.ts` | 主线程封装：`useWorkerFor(params)`（含固溶体且有 Worker 时走 Worker）、`call()`、`Channel`（同一通道同一时刻最多一个在途任务 + 一个待发任务，新任务顶替旧的待发任务） |

性能预算（`e2e/perf.spec.ts`、`tests/perf.test.ts`）：ss-eutectic 切换体系主线程无 > 100 ms 长任务，拖动 T / x₀ 单次长任务 ≤ 80 ms；
化学计量体系 ≤ 50 ms；Node 中 `new PhaseDiagram`：化学计量 ≤ 100 ms、固溶体 ≤ 250 ms。

## 3. 热力学内核（`src/core/`）

- `thermo.ts`：模型、闭式 `T_s`、固溶体 argmax、**解析梯度 `gradTsat`**（化学计量相商法则；固溶体包络定理）。
- `diagram.ts`：构造式平衡（化学计量体系）；`liquidusGrid / liquidusFast`（液相面网格与网格插值，误差 < 0.1 K，用于逐像素底图与三维曲面）。
- `solution.ts`：固溶体通用求解器 = 单纯形 LP（`simplex3`：退化步 > 20 次切换 Bland 规则，返回 `LpStatus`）+ KKT 牛顿精化 + 加 / 去相迭代。
- `topology.ts`：界线、不变点、反应分类；含固溶体时两级网格（粗网格求初晶相，只细化初晶相变化的单元及邻域）；交点用 Illinois 试位法。
- `hullSection.ts` + `zpfTrace.ts`：固溶体等温截面 = 下凸包拓扑 + **连结线延拓（ZPF 映射）**得到的精确相界（失败簇回退为凸包近似并以虚线标出）。
- `vertical.ts`：垂直截面栅格，并把逐行相界点连成折线（`boundaries`）。
- `terms.ts`：**术语单一来源**（名称、教材别名、符号、反应式）。
- `math/phaseRule.ts`：**相律的有效组元数** C（边 / 顶点 / 伪二元连线上降低），`F = C − P + 1`。
- `math/scheil.ts`：Gulliver–Scheil，自适应步长 0.25–10 K，事件温度二分定位，终凝平台。

## 4. 设计令牌与样式

- `src/ui/tokens.ts` 是颜色、字号阶梯（11 / 12 / 13 / 15 / 18）、间距、线宽的**唯一来源**；`npm run gen:tokens` 生成 `src/styles/tokens.css`
  （`tests/style.test.ts` 校验二者同步）。
- 业务代码（除 `tokens.ts`）与样式表（除 `tokens.css`）**禁止**出现十六进制颜色字面量；字号只能用 `var(--fs-xs|sm|md|lg|xl)`（同一测试强制）。
- 语义色：`COLOR.phase.liquid`（线 / 点 / 色块，深灰）与 `COLOR.phase.liquidFill`（相区填充底色）、`COLOR.component[0..2]`、`COLOR.compound[…]`、
  `COLOR.point.{eutectic,transition,peritectic}`、`COLOR.line.{eutectic,transition,peritectic}`、`COLOR.stateX0`。
- 样式表：`styles/{tokens,base,shell,doc,figure}.css`。

## 5. 组件清单

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| `GlobalBar` | `app/GlobalBar.tsx` | 顶栏；响应式：≥1440 完整，1280–1439 缩写，<1280 导航收起、状态读数折叠为徽章 |
| `CoolingTransport` | `panels/CoolingTransport.tsx` | 全站唯一冷却时间轴 |
| `TernaryPlot` | `viz/TernaryPlot.tsx` | **唯一**的三元图坐标轴 / 刻度 / 轴标题 / 相界 / 标注实现（SVG）；`variant: 'figure' | 'compact'` |
| `PhaseFigure2D` | `pages/workspace/PhaseFigure2D.tsx` | 工作台图 1 = canvas 填充底图（`core/canvasDraw.ts`）+ `TernaryPlot` + `IsoOverlay` |
| `Viewport3D` / `PhaseScene` | `scene/` | 三维图窗（单行图标工具条、图层下拉、温度徽标、标题条"?"说明） |
| `Inspector` | `pages/workspace/Inspector.tsx` | 4 个标签：相平衡 · 推导 · 选中对象 · 说明 |
| `PointPanels` | `panels/PointPanels.tsx` | 几何 / 稳定性 / 演化 / 推导 / 当前反应面板；嵌入线性代数、热力学、凝固路径页（与检查器同一全局状态） |
| `LocalParam` / `Drop` / `HelpTip` | `ui/` | 局部参数、下拉面板、标题条悬浮说明 |
| `TeX` / `TeXBlock` | `viz/TeX.tsx` | KaTeX 公式（仅随分析页 chunk 加载） |

## 6. 如何扩展

**新增预设体系**
1. 在 `core/presets.ts` 的 `PRESETS` 追加：`params`（成分、Ω、化合物、可选 `solutions`）、`examples`（典型成分，`final` 为期望终态）、`x0`、`tunable`。
2. 化合物成分 `n` 必须归一（和为 1）。拓扑由热力学模型自动给出；`tests/core.test.ts` 会对全部预设跑一致性测试，
   典型成分的 `final` 由测试断言。想要特定拓扑（例如双转熔点），可参考 `scripts/search-peritectic.ts` 的随机搜索。
3. 需要术语 / 说明时，只改 `core/terms.ts`。

**新增分析页章节**
1. 在对应 `pages/<页面>/<页面>Page.tsx` 的 `SECTIONS` 加 `{ id, title, sub }`，并在路由分支渲染章节组件。
2. 章节结构：`PageTitle`（标题 + 一句结论）→ 主图 + 关键数值 / 控件 → `Derivation`（默认摘要，可展开）→ 假设与适用范围（来源徽标 `Prov`）。
   图用 `TernaryPlot` / `XYPlot`；公式用 `TeX` / `TeXBlock`；页内局部控件用 `LocalParam`；颜色只从 `ui/tokens` 取。
3. 需要当前状态的完整分析时用 `usePointAnalysis()`；重计算走 `state/asyncCompute.ts`（固溶体体系）而不是页面内直接计算。

## 7. 测试与质量保障

- `npm run typecheck`、`npm test`（vitest：一致性、数学层、11 组验证算例、LP、ZPF、Scheil、相律、拓扑、预设、样式 / 令牌、性能）；
  `npm run test:perf` 以串行 + 严格阈值跑性能用例（`npm test` 并行时阈值放宽，避免 CPU 争用造成误报）。
- `npm run e2e`（Playwright，本机 Chrome）：冒烟、布局无溢出（4 尺寸 × 6 页）、控件单一化、性能预算、视觉回归；基线用 `npm run e2e:update` 生成。
