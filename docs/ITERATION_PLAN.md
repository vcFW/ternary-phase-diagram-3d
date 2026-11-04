# 下一轮迭代计划（v4）：正确性 · 一致性 · 性能 · 可理解性

> 评审日期：2026-11-03　评审基线：`42d602f`（工作区另有 `demo/` 下未提交改动，与本计划无关）
> 读者：接手实现的工程师 / 模型。本文件自足：按"执行顺序"逐项实施即可，无需重新评估整个项目。
> 约定：任务编号 `Pn.m`；每项包含 **问题与证据 → 改动 → 涉及模块 → 验收标准**。文件路径相对仓库根目录。

---

## 0. 项目定位与评判标准

**定位**：冶金物理化学课程中"三元相图"部分的教学 + 分析平台。用户是学生、教师与需要推理相图的工程人员。
核心价值不是"画得多"，而是：**(1) 结论科学正确、可验证；(2) 每个结论能追溯到守恒 / 几何 / 热力学；(3) 交互直观，用户知道自己在改什么。**

据此，本轮的评判标准依次为：

1. **科学正确**：相律、反应分类、相界位置、凝固路径必须与教材定义一致，数值误差可量化。
2. **单一事实来源**：同一物理量（体系、x₀、T、模式、颜色、术语）在全站只有一个控件、一个颜色、一个名字。
3. **响应性**：任何拖动操作 ≤ 50 ms 主线程占用（固溶体体系允许先粗后精）；切换体系不冻结界面。
4. **一致的 MATLAB 风格**：浅色、细线、Parula / MATLAB 默认色序、图号 + 标题条、等宽数值；全站同一套组件与间距。
5. **复杂度与价值匹配**：工作台是主场景（密集但有序），分析页是"讲一件事"的文档（一图一结论一推导）。

## 1. 评审结论摘要

现状基础很好：`npm test` 214 项全部通过，`tsc` 无错误；热力学内核（闭式饱和温度、构造式平衡、LP + KKT 牛顿、零空间反应分类、10 组验证算例）设计扎实。
问题集中在**少数科学错误、固溶体体系的性能、控件重复与视觉体系分裂**。

| # | 发现 | 严重度 | 证据 |
| --- | --- | --- | --- |
| F1 | **相律自由度在二元边 / 顶点 / 伪二元连线上错误**：全站固定 F = 4 − P（C = 3）。x₀ 在 A–B 边上时实际 C = 2，F 被多算 1（顶点上多算 2）。 | 高（科学错误） | `core/diagram.ts:179`、`core/solution.ts:344`、`app/GlobalBar.tsx:83`、`pages/path/PathPage.tsx:118,146`；预设"二元稳定化合物"的默认 x₀ = (0.3,0.3,0.4) 恰在 D–C 连线上，终态 C+D 两相 |
| F2 | **固溶体体系严重卡顿**：切换到"有限固溶度三元共晶"主线程长任务 1935 ms + 951 ms；拖动温度每帧约 150 ms，拖动 x₀ 约 120 ms。`new PhaseDiagram` 在 Node 中即需 908 ms（拓扑提取 110² 网格 × 固溶体饱和迭代）。 | 高 | 浏览器 PerformanceObserver(longtask) 实测；Node 基准见附录 A |
| F3 | **固溶体等温截面相界为锯齿台阶**（下凸包网格 1/64 分辨率，黑色粗折线），专业观感差且误导"相界有结构"。 | 高 | `core/hullSection.ts`（HULL_N = 64）；工作台图 1 在 ss-eutectic 下可见 |
| F4 | **同一控件多处重复**：模式切换 ×3（全局条、工作台工具条、图 1 下方）；x₀ 输入 ×2；T ×3（全局条输入、全局条右侧读数、"截面温度（参数）"滑块，后者实为全局 T）；冷却播放 ×4（图 1 下 ModeBar、CoolingDock、三维"冷却栏"、凝固路径页）；"体系"选择 ×2。 | 高（直接造成"不知道在改什么"） | `app/GlobalBar.tsx`、`pages/workspace/WorkspacePage.tsx:86-150,197-250`、`panels/CoolingDock.tsx` |
| F5 | **局部温度与全局温度混淆**：热力学页"二元公切线"的 T 滑块是页内局部状态（`useState(Tg)`），标签只写"T"，与顶栏 T 不同步且无提示。 | 中 | `pages/thermo/BinarySection.tsx:28` |
| F6 | **工作台工具条溢出**：需要 1301 px，1024 宽时只有 808 px，1440 宽时也放不下（"布局""转到分析"被裁掉）；三维图提示条 377/783 px 溢出；全局条在 1024 宽时相区读数被截成"液…"。 | 中 | DOM 实测 `.tstrip` scrollWidth 1301 / clientWidth 808 |
| F7 | **颜色语义冲突**：液相在三处分别为 `#a9c8e4`（`core/colors.ts`）、`#0072BD`（`Inspector.tsx:112,119,409`、`PhaseFigure2D.tsx:20`）、`#3a78b5`（XYPlot 序列）；其中 `#0072BD` 同时是组元 B 的颜色与三维共晶点颜色。全仓 TS 中硬编码十六进制颜色 200+ 处，三份 CSS 共 211 处；字号 12 种（10–18 px）。 | 中 | `grep -rhoE "#[0-9a-fA-F]{6}"` |
| F8 | **三维图例是静态的**：固溶体 / 简单共晶体系也显示"转熔线""过渡点 U"；图例浮在绘图区之上遮挡曲面；工具按钮两行折行压住温度轴标题。 | 中 | `scene/Viewport3D.tsx:118-121` |
| F9 | **检查器 8 个标签页**（相平衡、反应与转变、几何与向量、稳定性、数学推导、演化、选中对象、讲解），与分析页 2–5 内容大量重叠；默认叠加层 6 项全开，x₀ 周围标签互相压盖。 | 中 | `pages/workspace/Inspector.tsx:16-25`、`state/store.ts defaultOverlays` |
| F10 | **两套三元图渲染栈**：工作台用 `core/canvasDraw.ts` + `PhaseFigure2D.tsx`（有刻度），分析页用 `viz/TernaryPlot.tsx`（无刻度、不同线宽与配色），同一相图在不同页面长得不一样。 | 中 | 对比工作台图 1 与 `#/path` 页三元图 |
| F11 | **垂直截面在冷却模式下可能不经过 x₀**（默认截面为化合物连线 D–C），状态点不在截面上，且截面上单击会被冷却模式拒绝。 | 中 | `state/store.ts initialSection`；`#/workspace?p=binary-incongruent&x=0.6,0.25,0.15` |
| F12 | **缺少"双转熔点（三元包晶 P / 双降点）"实例**：规则页讲三类不变点，但六个预设没有一个出现 P 型点，学生无法交互验证。 | 中（教学完整性） | `core/presets.ts`；各预设不变点：见附录 A |
| F13 | **LP 单纯形无防循环规则**，退化（边 / 顶点成分）时靠 500 次迭代上限退出且不报告状态；曾导致白屏（已有回归测试兜底）。 | 中 | `core/solution.ts:69-110`、`math/gibbsMin.ts` |
| F14 | Scheil 固定步长 0.5 K，ss-eutectic 需 747 步；相集合变化处无二分定位。 | 低-中 | `math/scheil.ts` |
| F15 | 文档与代码漂移：README 写 206 项测试 / "8 组验证算例" / "Scheil 未实现"，实际 214 项 / 10 组 / 已实现。`window.__store` 在生产构建中暴露。死代码：`panels/IsoView.tsx`、`panels/ProjectionView.tsx`、`panels/StatusCard.tsx` 无引用；`legacy/` 两份旧源码快照留在工作树。 | 低 | `README.md`、`src/main.tsx:10` |
| F16 | 规则页主导航第 9 项为"'二级定理'（待核实）"——未决考证放在主导航，削弱专业感。 | 低 | `pages/rules/RulesPage.tsx:16` |
| F17 | 公式以普通文本 + 斜体排版（`MathView.Eq`），矩阵 / 分式 / 上下标可读性差。 | 低-中 | `viz/MathView.tsx` |
| F18 | 页面懒加载时出现"正在加载…"空白页闪烁；无端到端测试，界面回归全靠手测。 | 低 | `app/AppShell.tsx` |

已验证**没有**问题的部分（无需改动）：极端参数（Ω = −8 / +6 kJ、稳定度 0.2–6 kJ、熔点偏移 ±200 K）× 顶点 / 边 / 中心成分 × 工作台、路径、热力学、线性代数、规则页，均未出现渲染错误或 NaN；URL 深链接往返正确；化学计量体系交互流畅（setX0 ≤ 5 ms）。

## 2. 本轮设计决策（已拍板，实施时不再讨论）

1. **全局状态只在顶栏改**：体系、x₀、T、模式、热力学参数五项**只**在顶部全局条出现可编辑控件。页面内只能出现"页面局部参数"，且必须带 `局部` 徽标并提供"↦ 设为全局"按钮（反向同步）。
2. **冷却只有一个"时间轴"组件**：`CoolingTransport`（播放 / 单步到事件 / 进度 / 速度 / 事件刻度），工作台底部与凝固路径页共用同一组件、同一状态。
3. **计算放进 Web Worker**（Comlink 包装）：凡可能 > 16 ms 的计算（固溶体相图构建、等温 / 垂直截面、冷却轨迹、Scheil）一律异步，主线程只做渲染；结果按 `(diagram.uid, 量化后的 T / x₀)` 缓存；先粗后精。
4. **固溶体相界改为"连结线延拓"精确追踪**（ZPF 线映射，参照 Sundman 等的映射算法，pycalphad 新 mapping 模块即基于此思路），下凸包仅用于确定相区拓扑与初值。
5. **一套设计令牌**：颜色、字号、间距、线宽在 `src/ui/tokens.ts`（TS）与 `src/styles/tokens.css`（CSS 变量）中**同源生成**；业务代码禁止出现十六进制颜色字面量（ESLint 规则或测试强制）。
6. **一套三元图组件**：以 `viz/TernaryPlot.tsx`（SVG）为唯一坐标轴 / 刻度 / 标注实现；工作台保留 canvas 作为**填充底图层**（性能），叠加层、坐标轴、标签全部走同一 SVG 组件。
7. **公式用 KaTeX**（成熟、离线、无运行时依赖服务器）。
8. **相律用有效组元数**：C_eff 由 x₀ 的非零组元数决定，并在 x₀ 与全部平衡相位于一条真正的伪二元连线上时降为 2（共线性用 `math/linalg.ts` 的 SVD 求秩判定，规则见 P0.1），F = C_eff − P + 1。这本身是"线性代数主线"的好例子，要在规则页相律一节体现。
9. **不引入重量级图表库**（Plotly / ECharts 与 MATLAB 观感不符且体积大）；`XYPlot` 继续自研，但改用令牌。
10. **术语表单一来源**：`src/core/terms.ts`，所有反应 / 不变点 / 界线名称从此取，兼顾国内教材别名（见 P3.8）。

## 3. 工作分解

### P0　科学正确性与低成本修复（先做，1–2 天）

#### P0.1　相律：有效组元数
- **问题**：F1。
- **改动**：
  - `src/math/phaseRule.ts`（新）：`effectiveComponents(d, x0, eq): { C, reason }`，规则按顺序：
    1. C₀ = x₀ 中含量 > 1e-9 的组元数（边上 = 2，顶点 = 1）；
    2. 若 C₀ = 3，且 x₀ 与全部平衡相成分共线（`linalg.rank` 求 `[pᵢ − x₀]` 的秩 ≤ 1），**并且**该直线经过两个化学计量固相、二者均为一致熔融（`topo.compounds[].congruent` 或纯组元）——即真正的伪二元连线（Alkemade 线且界线在此有温度极大点）——则 C = 2；
    3. 否则 C = C₀。
    **注意**：不能只用"相点共线"判定（内部两相区 L + A 的 x₀、x_L、A 本来就共线，C 仍为 3）；必须同时满足"直线是两个稳定固相的连线"。
    `phaseRule(d, eq, x0, onPlateau)` 返回 `{ C, P, F = C − P + 1, reason }`；平台上 F = 0 的特例逻辑也收进这里。
  - `Equilibrium.dof` 字段删除（或改为由 `phaseRule` 计算的派生值），所有显示处（`GlobalBar.tsx:83`、`PathPage.tsx:118,146`、`Inspector.tsx` 中"相数 P / 自由度"、`InfoPanel`）统一调用 `phaseRule`，并显示 `C = 2（二元子体系）` 之类的注释。
  - 规则页"Gibbs 相律"一节（`pages/rules/SystemRules.tsx` PhaseRule）增加"边上 / 伪二元连线上 C 降为 2"的推导与交互演示（把 x₀ 拖到边上看 C、F 变化）。
- **验收**：
  - 新增单元测试：x₀ = (0.5,0.5,0) 在 L+A 区 → C=2、F=1；x₀ 在三角形内部 L+A → C=3、F=2；x₀ = 顶点 A 纯固相 → C=1、F=1（恒压单组元单相：F = C − P + 1 = 1）；binary-congruent 中 x₀ = (0.3,0.3,0.4)（D–C 伪二元连线上）在 C+D 区 → C=2、F=1，在其伪二元共晶温度的 L+C+D 平台 → F=0；binary-incongruent 中 x₀ 在 D–C 连线上（D 不一致熔融，不是伪二元）→ C=3。
  - 全站搜不到 `4 - phases.length` / `4 − P` 的硬编码。

#### P0.2　液相 / 组元 / 不变点颜色语义统一（令牌化的第一步）
- **问题**：F7。
- **改动**：在 `src/ui/tokens.ts` 定义语义色：`phase.liquid`（建议 `#4d4d4d` 深灰线 + `#e8eef5` 填充，避开 MATLAB 色序中的任何组元色）、`component[0..2]`、`compound[...]`、`point.eutectic / transition / peritectic`、`line.eutectic / peritectic`、`state.x0`（`#c00000`）、`state.liquid`、`axis`、`grid`。`core/colors.ts` 改为从令牌取值。替换 `Inspector.tsx`、`PhaseFigure2D.tsx`、`PhaseScene.ts`、`XYPlot` 调用处的液相与不变点颜色。
- **验收**：`grep -rn "0072BD\|0072bd\|a9c8e4\|3a78b5" src` 只出现在 `tokens.ts`；同一相在 2D、3D、表格、曲线中颜色一致（Playwright 截图人工核对一次）。

#### P0.3　三维图例随体系动态生成
- **问题**：F8 前半。
- **改动**：`scene/Viewport3D.tsx` 图例条目由 `diagram.topo`（是否存在转熔段、各类不变点、固溶体）生成；无条目则不显示该行。图例移到绘图区右上角**外侧**的固定栏（或可折叠），不覆盖曲面。
- **验收**：简单共晶体系图例无"转熔线 / 过渡点"；ss-isomorphous 无界线 / 不变点条目；任何体系图例不遮挡三角形底面。

#### P0.4　局部参数显式化
- **问题**：F5，以及所有页面局部滑块。
- **改动**：新增 `ui/LocalParam.tsx`：包装 `SliderRow`，左侧显示 `局部` 徽标，右侧"↦ 设为全局"按钮（调用 `setT` 等），当局部值 ≠ 全局值时显示差值。替换 `BinarySection` 的 T 以及分析页中其它局部温度 / 成分控件（用 `grep -rn "useState(T\|useState(Tg\|useState(x0" src/pages` 找全）。
- **验收**：任何页面上，凡不改变全局状态的控件都带 `局部` 徽标；改变全局状态的控件只存在于顶栏。

#### P0.5　LP 健壮性
- **问题**：F13。
- **改动**：`core/solution.ts lp()` 与 `math/gibbsMin.ts` 的单纯形：检测到退化步（θ = 0）连续 > 20 次后切换 Bland 规则（最小下标进基 / 出基）；返回 `status: 'optimal' | 'iteration_limit' | 'singular'`；非 optimal 时在 `SolEq` 上标记 `warning`，界面在状态读数旁显示"⚠ 求解未完全收敛"。
- **验收**：新增测试——对每个体系在边、顶点、三相三角形顶点上逐点求解，`status === 'optimal'`；人为构造的退化算例（四个共面列）不再触发迭代上限。

#### P0.6　冷却模式下的垂直截面
- **问题**：F11。
- **改动**：进入冷却模式时，若当前截面不过 x₀，自动切到"过状态点"模式（沿用原方向），并 `flash` 提示一次；截面视图中冷却模式下单击 / 拖动只改 T（不再尝试改 x₀ 再被拒绝）。
- **验收**：在 `#/workspace?p=binary-incongruent&x=0.6,0.25,0.15` 切到冷却模式、垂直截面视图，状态点位于截面内；拖动只改变温度。

#### P0.7　杂项
- `src/main.tsx`：`window.__store` 仅在 `import.meta.env.DEV` 时挂载（demo 录制脚本依赖 dev 模式，不受影响）。
- 删除无引用的 `panels/IsoView.tsx`、`panels/ProjectionView.tsx`、`panels/StatusCard.tsx`。
- `legacy/` 两份快照：打 git tag `legacy-v1`、`legacy-v2` 后从工作树删除，README 注明从 tag 取回。
- binary-congruent 默认 x₀ 改为 (0.32, 0.30, 0.38)（离开 D–C 连线，展示一般情形）；在该预设"典型成分"中保留"D–C 连线上（伪二元）"一条作为专门示例。
- **验收**：`npm run build` 产物中搜不到 `__store`；`tsc`、全部测试通过。

### P1　架构：计算异步化与设计令牌（3–4 天）

#### P1.1　计算 Worker
- **问题**：F2。
- **改动**：
  - 依赖：`comlink`（Google Chrome Labs，MIT，~1 KB）。
  - `src/compute/worker.ts`：在 Worker 内持有 `PhaseDiagram` 实例表（按 `paramsHash` 键），暴露 `build(params)`、`isoSection(T)`、`verticalSection(spec)`、`trace(x0)`、`scheil(x0)`、`equilibrium(x0,T)`。返回可结构化克隆的纯数据（不传类实例）。
  - `src/compute/client.ts`：主线程封装；每类请求带递增 `reqId`，只接受最新一次结果（拖动中旧请求作废）；先请求粗分辨率（例如 hull N=32、截面 60 行）立即渲染，再请求精细结果替换。
  - Store 改造：`diagram` 构建对**化学计量体系保持同步**（< 50 ms，避免不必要的复杂度）；对含固溶体体系走 Worker，期间 `status: 'computing'`，顶栏显示细进度条，旧图保持显示（灰度 60%）而不是空白。`equilibrium(x0,T)` 单点在主线程仍可同步（ss 单点 ~5–15 ms 可接受），截面 / 轨迹 / Scheil 一律异步。
  - Vite：`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`。
- **验收**（ss-eutectic，Chrome，M 系列 Mac 或同级）：
  - 切换体系时无 > 100 ms 的主线程长任务（PerformanceObserver 测试脚本见 P4.2）；
  - 拖动 T：主线程每帧 ≤ 50 ms，粗结果 ≤ 150 ms 内出现，精细结果 ≤ 600 ms；
  - 化学计量体系行为与性能不退化（setX0 ≤ 10 ms）。

#### P1.2　固溶体拓扑提取提速
- **改动**：`core/topology.ts` 对含固溶体体系改为两级网格：先 N=40 求各点初晶相，只在初晶相发生变化的单元及其邻域细化到等效 N=110；`solTsat` 以邻点结果热启动 `y`。
- **验收**：Node 中 `new PhaseDiagram(ss-eutectic)` ≤ 250 ms（现 908 ms）；`tests/core.test.ts` 中拓扑断言全部不变；界线点与原实现最大偏差 ≤ 1e-3（成分）。

#### P1.3　设计令牌与样式整合
- **问题**：F7、视觉不一致。
- **改动**：
  - `src/ui/tokens.ts`：颜色（语义色 + MATLAB 色序 + Parula 端点）、字号阶梯（11 / 12 / 13 / 15 / 18 五级）、间距（4 / 8 / 12 / 16 / 24）、线宽（坐标轴 1、相界 1.5、强调 2）、圆角 2 px。
  - `scripts/gen-tokens.ts`（或 Vite 插件）由 tokens.ts 生成 `src/styles/tokens.css` 的 `:root` 变量，保证同源。
  - CSS 重组：`styles/tokens.css`、`styles/base.css`（排版、表格、按钮、输入）、`styles/shell.css`（导航、顶栏）、`styles/figure.css`（图窗、工具条）、`styles/doc.css`（分析页文档排版）。合并 `styles.css`、`shell.css`、`workspace.css` 中的重复规则（三者现有 2600 行）。
  - 测试 `tests/style.test.ts`：扫描 `src/**/*.{ts,tsx}`（除 tokens.ts）不得出现 `#[0-9a-fA-F]{3,6}` 字面量；扫描 CSS（除 tokens.css）不得出现十六进制颜色与令牌外的 font-size。
- **验收**：上述测试通过；三份旧 CSS 删除；视觉回归截图（P4.1）与改动前人工比对，仅有预期变化。

#### P1.4　派生计算统一
- `state/derived.ts` 成为唯一的派生入口（已有雏形）；把 `pointAnalysis`、冷却轨迹、Scheil 的缓存都挂到这里，并区分"同步派生"与"异步派生（Worker）"两类 hook：`useDerived(key, fn)` / `useAsyncDerived(key, request)`（后者返回 `{ data, status, stale }`）。
- **验收**：页面组件中不再直接调用 `computeTrace`、`scheil`、`hullSection`、`verticalSection`。

### P2　算法升级（4–6 天，可与 P3 并行，由不同人负责）

#### P2.1　固溶体等温截面：连结线延拓（ZPF 映射）
- **问题**：F3。
- **算法**（在 Worker 中运行）：
  1. 用现有下凸包（N=48 即可）得到：单相小块、两相面（端点属于两种相 / 同一相但相距远 = 溶解度间隙）、三相面。
  2. 三相三角形：已有 KKT 牛顿精化，保留。
  3. 两相区：对每个连通的两相面簇，取一条连结线作种子，用 `SolutionEngine.polish` 的两相 KKT 系统求精确解；然后沿"连结线族参数"做**伪弧长延拓**：固定一个相的一个成分坐标作为参数步进（步长自适应：牛顿迭代次数 > 4 则步长减半，< 2 则加倍，范围 0.002–0.03），每步以上一步为初值求解；终止条件：到达三角形边界、到达三相三角形的一条边（与 2 中的精确顶点吻合，误差 < 1e-6 即连接）、或两相成分趋同（临界点，|y₁ − y₂| < 1e-4）。
  4. 两侧端点序列即精确相界（ZPF 线）；连结线按等弧长抽样 12–20 条绘制。
  5. 失败回退：延拓失败的区段用原凸包边界并在图上以虚线标出"近似"。
- **参考**：Sundman 等的相图映射算法（Thermo-Calc / OpenCalphad 的 mapping 思路）；pycalphad 新 mapping 后端以此为蓝本（PR #517，可读其 `pycalphad/mapping/` 中的节点 / 出口点处理作为设计参照，不需要引入 Python）。
- **涉及**：`core/hullSection.ts`（拆为 `hullTopology.ts` + `zpfTrace.ts`）、`core/solution.ts`（暴露两相 KKT 求解接口，允许固定一个成分分量）、`core/isothermal.ts` 的 `IsoSection` 类型（相界由折线改为平滑曲线点列）。
- **验收**：
  - ss-eutectic、ss-isomorphous 若干温度下，相界上任一点做逐点平衡：相集合跨越该点改变，且两侧化学势差 < 1e-6 RT；
  - 新相界与 N=256 凸包结果的 Hausdorff 距离 ≤ 1/256；
  - 截面计算（Worker 内）≤ 300 ms；
  - 视觉：无台阶状相界（截图核对）。

#### P2.2　固溶体垂直截面
- **改动**：保留"逐行取样 + 二分定位"的结构，但：(a) 移入 Worker；(b) 行数先 40 后 120；(c) 相界点用二分到 1e-4 后，同一相界的点按连续性连接成曲线（按相集合标签匹配），不再画网格台阶；(d) 结果按 `(uid, spec)` 缓存，拖动截面时只对新截面重算。
- **验收**：ss-eutectic 拖动垂直截面时主线程无长任务；粗结果 ≤ 200 ms，精细 ≤ 800 ms；`tests/core.test.ts` 的"垂直截面栅格与逐点平衡一致"继续通过。

#### P2.3　Scheil：自适应步长 + 事件定位 + 解析参照
- **问题**：F14。
- **改动**：`math/scheil.ts` 步长自适应（相集合不变时步长按液相成分变化量控制，|ΔxL| 目标 2e-3，步长 0.25–10 K）；相集合改变时在区间内二分定位事件温度（≤ 0.05 K）；到达不变点（液相 + 3 固相）时把剩余液相按不变反应一次性结晶并记录"终凝平台"。参考 pycalphad 生态的 `scheil` 包（`simulate_scheil_solidification`，默认 1 K 步长、可自适应）的假设表述，在页面"假设"框中与之对齐。
- **新增验证算例 11**：二元理想匀晶极限下的经典 Scheil 方程 `x_L = x₀ · f_L^(k−1)`（k 为常数分配系数时成立）——用 `ss-isomorphous` 的二元边或 `math/binary.ts` 的固溶体演示模型构造近似常数 k 的情形，比较数值 Scheil 与解析式（容差按 k 的变化量给出）。
- **验收**：ss-eutectic Scheil 步数 ≤ 200（现 747）、耗时降低；算例 11 进入 `validation.ts` 与 `#/lab/validation`；现有测试通过。

#### P2.4　解析导数替代有限差分
- `core/diagram.ts refineUni` 用 `T_s(x)` 闭式解的解析梯度（`math/spaces.ts` 已有液相面梯度，复用之）；固溶体相用包络定理给出的导数。
- **验收**：界线求点牛顿迭代平均次数下降；`refineUni` 回退到初值（`return x0`）的比例在测试统计中 < 1%。

#### P2.5　新预设：含双转熔点（三元包晶 P / 双降点）的体系
- **问题**：F12。
- **改动**：写一次性脚本 `scripts/search-peritectic.ts`：在"不一致熔融三元化合物 S"体系的参数空间（S 的成分、ΔHf、ΔSf、Ω_ij、熔点偏移）上随机 / 网格搜索，筛选 `topo.invariants` 中出现 `reaction.type === 'peritectic'` 且各初晶区面积 ≥ 3% 的参数组，取拓扑最清晰的一组固化为预设 `ternary-peritectic`，附 3–4 个典型成分（含"终点在 P"与"穿过 P 后继续到 E"）。每个典型成分的终态由测试断言。
- **验收**：新预设在 `tests/core.test.ts` 的全部体系级断言中通过；规则页"不变点与反应分类"三种类型都能一键载入实例。

#### P2.6　（积压，不在本轮实施）真实体系接口
- 定义 `DiagramSource` 接口（相、成分、`equilibrium(x,T)`、截面、拓扑），让 `PhaseDiagram` 成为其一个实现；为将来接入"pycalphad 离线计算的 (x,T) 网格 JSON"预留。本轮只做接口抽取的**设计文档**，不实现。理由：教学价值高但需要可信 TDB 数据与验证，超出本轮范围。

### P3　交互与界面（5–7 天）

#### P3.1　控件单一化（最重要的 UX 改动）
- **问题**：F4。
- **改动**：
  - **顶栏**（`app/GlobalBar.tsx`）：`体系 | 模式[成分探索|冷却凝固] | x₀ A B C | T | 状态读数(相区 · P · C · F) | ⋯ | 热力学参数 | 复制链接`。删除右端重复的温度大字读数（`gbar-T`）。冷却模式下 x₀ 显示为只读文本（带锁图标），而不是灰掉的输入框。
  - **工作台**删除：工具条"模式"组、"设置 → 体系"下拉、图 1 下方的 `ModeBar`（含 x₀ 输入与"截面温度（参数）"滑块）。
  - 图 1 下方只保留与该视图相关的局部控件（例如垂直截面的端点选择），没有则不显示。
  - **冷却时间轴**：新建 `panels/CoolingTransport.tsx`（由 `CoolingDock.tsx` 精简而来），模式 = 冷却时固定在工作台底部；凝固路径页 `#/path/equilibrium` 复用同一组件。三维工具条"冷却栏"开关删除。
  - 在成分探索模式下按"播放"时：自动切到冷却模式并给出一次性提示（现有逻辑保留）。
- **验收**：在全站 DOM 中，`x₀` 可编辑输入框只有 3 个（顶栏）；模式切换只有 1 处；播放按钮在任一页面最多 1 个。

#### P3.2　工作台工具条重排
- **问题**：F6、F9 后半。
- **改动**：工具条只保留四组，目标宽度 ≤ 880 px（在 1280 宽、导航收起时完整显示；更窄时末组收进"⋯"溢出菜单）：
  1. **视图**：等温截面 / 液相面投影 / 垂直截面（分段按钮）；
  2. **叠加层**：单个下拉，含三个预设——"基本"（平衡相点 + 连结线 + 液相轨迹，**默认**）、"几何"（+ 读数线、成分向量、∇T、界线标架）、"全部"，以及逐项复选；
  3. **截面与示例**：截面设置下拉、典型成分下拉；
  4. **转到分析**：线性方程组 / 公切面 / 凝固路径（图标 + 文字）。
  "专注图形"移到图窗标题条的图标按钮；"三维图层"移到三维图窗自己的工具条。
- **验收**：1280×800、导航展开时工具条无水平溢出；默认状态下 x₀ 周围标签互不重叠（截图核对三个化学计量体系）。

#### P3.3　检查器精简为 4 个标签
- **改动**：`相平衡`（状态 + 平衡相表 + 相律）、`推导`（当前点的杠杆 / 重心线性方程组与反应零空间，合并原"反应与转变""数学推导"，各节末尾"在分析页展开 →"深链接）、`选中对象`（选中界线 / 不变点时自动切换，现有逻辑保留）、`说明`（原"讲解"）。原"几何与向量""稳定性""演化"内容移到对应分析页（线性代数页、热力学页 · 稳定性、凝固路径页），检查器中只留跳转链接。
- **验收**：标签数 = 4；被移除的内容在目标分析页可找到且使用同一全局状态；`Inspector.tsx` 行数减少 ≥ 40%。

#### P3.4　三维图窗
- **改动**：工具条改为单行图标按钮（视角：默认 / 俯视 / 正视 / 侧视 / 正对截面；显示：等温面 / 垂直面 / 剖切；导出：截图），每个按钮有 `title`；图例按 P0.3 外置；温度读数标签避让坐标轴文字（简单做法：固定在图窗右下角而非跟随三维点）；底部操作提示改为图窗标题条右侧的"?"悬浮说明，不再常驻占一行。
- **验收**：1024×768 下三维图窗内无任何文本重叠或溢出（`scrollWidth > clientWidth` 检测为 0，见 P4.2）。

#### P3.5　顶栏与整体响应式
- **改动**：断点 ≥ 1440：完整；1280–1439：隐藏"示意模型"标签（移入"⋯"），状态读数缩写；1024–1279：导航默认收起、状态读数折叠为一个可点击的徽章（点击弹出详情）。所有固定宽度元素在断点下不溢出。
- **验收**：在 1024×768、1280×800、1440×900、1920×1080 四个尺寸的每个页面，`.gbar`、`.tstrip`、图窗标题条均无溢出（自动检测）。

#### P3.6　分析页统一模板
- **问题**：页面复杂度不一：线性代数页信息密度合适；规则页 9 节、每节五层，文字过长；热力学页的二选一控件折行成"列表框"外观。
- **改动**：
  - 统一节结构：**标题 + 一句结论** → **主图（左）+ 关键数值 / 控件（右）** → **推导**（`Derivation`，默认折叠为"结论 + 3 步"，可展开全部）→ **假设与适用范围**（来源徽标）。规则页"五层框架"保留，但"①定义与假设"与"④物理意义"默认展开，"③数学推导"默认折叠。
  - `Segmented` 控件：不换行，超长时缩写 + `title`；同类选择（数据源、二元边）全部用 `Segmented`，不用原生 `<select size>`。
  - 规则页"'二级定理'（待核实）"从主导航移除，改为规则页末尾"术语说明"小节中的一段（保留检索记录与"请提供出处"）。
- **验收**：每个分析页的每一节首屏（1280×800）内能看到主图与结论；规则页导航 8 项；全站无折行的分段按钮。

#### P3.7　KaTeX 公式
- **改动**：依赖 `katex`（MIT）。`viz/MathView.tsx` 新增 `<TeX>{String.raw`...`}</TeX>` 与 `<TeXBlock>`；`MatrixView` 保留（它是可交互的数值矩阵）。按页面逐步迁移 `Eq` 的内容，优先：线性代数页、规则页相律 / 杠杆 / 重心、热力学页公切面。字体随 KaTeX CSS 打包，不依赖网络。
- **验收**：迁移页面中不再出现用 `<i>`/下划线拼写的公式；首屏 JS 增量 ≤ 300 KB（KaTeX 仅随分析页 chunk 加载）。

#### P3.8　术语单一来源
- **改动**：`src/core/terms.ts` 定义每个概念的 `{ name, short, aliases, symbol }`，例如：
  - 三元共晶点：名称"三元共晶点"，别名"低共熔点"，符号 E，反应 `L → α + β + γ`；
  - 过渡点：名称"过渡点（单转熔点）"，别名"双升点、包共晶点"，符号 U；
  - 三元包晶点：名称"三元包晶点（双转熔点）"，别名"双降点"，符号 P；
  - 共晶线 / 转熔线、一致 / 不一致熔融化合物、初晶区、连结线、连结三角形、副三角形等。
  `core/topology.ts:317,339`、`panels/InfoPanel.tsx`、`math/reaction.ts`、规则页、README 一律引用该表；首次出现处以 `name（aliases）` 形式展示。
- **验收**：`grep` 不到散落的"过渡点（单转熔点）"等字面量（除 terms.ts）；README 与界面术语一致。

#### P3.9　统一三元图组件
- **问题**：F10。
- **改动**：`viz/TernaryPlot.tsx` 增加刻度、网格、轴标题、边标签的完整实现与 `variant: 'figure' | 'compact'`；`PhaseFigure2D.tsx` 改为"canvas 填充底图（`canvasDraw.ts` 只保留区域填充与液相面着色） + TernaryPlot（坐标轴、相界、标注、叠加层、交互）"。分析页全部用 TernaryPlot。
- **验收**：工作台图 1 与 `#/path`、`#/linear` 页的三元图坐标轴、刻度、字体、线宽、相界颜色完全一致（截图对比）；`canvasDraw.ts` 行数减少 ≥ 50%。

#### P3.10　页面切换体验
- **改动**：空闲时（`requestIdleCallback`）预取其余页面 chunk；导航项 `pointerenter` 时预取对应页面；`Suspense` fallback 改为与页面同布局的骨架（标题条 + 灰色占位），不再显示整页文字"正在加载…"。
- **验收**：生产构建下首次进入工作台 3 s 后，切换任意页面不出现 fallback。

### P4　质量保障（与上面并行，贯穿全程）

#### P4.1　端到端与视觉回归
- 依赖：`@playwright/test`（dev）。`e2e/smoke.spec.ts`：6 页 × {binary-incongruent, ss-eutectic} × {1280×800, 1024×768}：页面无 ErrorBoundary、无 console error、无 NaN / Infinity 文本、关键元素无溢出（`scrollWidth > clientWidth + 2` 的元素列表为空，白名单除外）。
- `e2e/visual.spec.ts`：上述组合截图，`toHaveScreenshot` 基线（阈值 0.2%）。
- `package.json` 增加 `"e2e": "playwright test"`。

#### P4.2　性能预算测试
- `e2e/perf.spec.ts`：PerformanceObserver(longtask) 记录：(a) 切换到 ss-eutectic；(b) 程序化设置 T 连续 10 次；(c) 设置 x₀ 连续 10 次。断言：(a) 无 > 100 ms 长任务；(b)(c) 单次长任务 ≤ 50 ms（化学计量体系）/ ≤ 80 ms（固溶体体系，主线程部分）。
- Node 侧 `tests/perf.test.ts`（可用 `describe.skipIf(process.env.CI)` 控制）：`new PhaseDiagram` 各体系耗时上限。

#### P4.3　算法测试补充
- P0.1 相律、P0.5 LP 状态、P2.1 ZPF 相界一致性、P2.3 算例 11、P2.5 新预设——各自的测试已在对应任务的验收中列出。
- 可选：用 `highs`（HiGHS 的 WASM 构建，MIT）作为**仅测试用**的 LP 参照解，对随机 x₀ / T 比较目标值（容差 1e-8）。不进入生产依赖。

#### P4.4　文档
- README：更新测试数、算例数、页面说明（检查器 4 标签、控件单一化、Worker）、已知限制（删去"Scheil 未实现"；固溶体相界改为精确追踪后更新精度说明）、新预设、术语表链接。
- 新增 `docs/ARCHITECTURE.md`：状态流（顶栏 → store → derived / worker → 视图）、颜色令牌、组件清单、如何新增预设 / 页面节。

## 4. 执行顺序与依赖

```
第 1 批（串行，地基）
  P0.1 相律 → P0.2 颜色令牌（雏形）→ P0.3 三维图例 → P0.4 局部参数 → P0.5 LP → P0.6 冷却截面 → P0.7 杂项
  P4.1 Playwright 骨架（尽早建立截图基线，后续改动都可回归）

第 2 批（架构）
  P1.3 设计令牌与样式整合   ← 依赖 P0.2
  P1.1 计算 Worker          ← 独立
  P1.4 派生计算统一          ← 依赖 P1.1
  P1.2 拓扑提取提速          ← 独立（可与 P1.1 并行）

第 3 批（可两条线并行）
  线 A 算法：P2.1 ZPF 相界 → P2.2 垂直截面 → P2.3 Scheil → P2.4 解析导数 → P2.5 新预设
             （P2.1/P2.2 依赖 P1.1 的 Worker 管线）
  线 B 界面：P3.1 控件单一化 → P3.2 工具条 → P3.3 检查器 → P3.4 三维图窗 → P3.5 响应式
             → P3.9 统一三元图组件（依赖 P1.3）→ P3.6 分析页模板 → P3.7 KaTeX → P3.8 术语 → P3.10 预取

第 4 批
  P4.2 性能预算、P4.3 补充测试收口、P4.4 文档
```

每完成一个任务：`npm run typecheck && npm test && npm run e2e` 全绿后单独提交，提交信息以任务编号开头（例如 `P0.1 相律改用有效组元数`）。

## 5. 明确不做（本轮）

- 不接入真实材料数据库 / pycalphad 运行时（仅做 P2.6 接口设计）。
- 不做暗色主题（MATLAB 风格以浅色为准）。
- 不做移动端适配（最小支持宽度 1024 px；更窄时显示"请在更宽的窗口中使用"）。
- 不引入 Plotly / ECharts / D3 全家桶；不更换 three.js / zustand / React。
- 不重写已通过验证的化学计量体系构造式求解器（它是精确解，且是 LP 求解器的独立对照）。

## 6. 总体完成标准（Definition of Done）

1. `npm run typecheck`、`npm test`、`npm run e2e` 全部通过；测试数 ≥ 240，验证算例 11 组。
2. 相律显示在边 / 伪二元连线 / 顶点上正确（P0.1 测试）。
3. ss-eutectic：切换体系无 > 100 ms 长任务；拖动 T / x₀ 交互流畅（P4.2）；等温截面相界平滑且通过 ZPF 一致性检查（P2.1）。
4. 全局状态五项只在顶栏可编辑；冷却时间轴全站唯一；检查器 4 标签；工具条在 1280 宽无溢出。
5. 业务代码无十六进制颜色字面量；全站同一相同一颜色；三元图坐标轴全站一致。
6. 新预设展示双转熔点 P；术语与国内教材别名一致。
7. README 与 `docs/ARCHITECTURE.md` 与实际一致。

---

## 附录 A　评审实测数据

**测试与类型检查**（基线 42d602f）：`tsc -b --noEmit` 无输出；`vitest run` 4 文件 214 项通过，8.4 s。

**Node 基准**（`new PhaseDiagram` / Scheil(dT=0.5) / 冷却轨迹 / 下凸包截面，单位 ms）：

| 体系 | 构建 | Scheil（步数） | 冷却轨迹（样本） | 凸包截面 | 平衡终态 |
| --- | --- | --- | --- | --- | --- |
| binary-incongruent | 8 | 9（337） | 11（478） | — | A+C+D |
| ternary-incongruent | 4 | 2（426） | 4（530） | — | B+C+S |
| binary-congruent | 8 | 2（62） | 7（340） | — | C+D（x₀ 在 D–C 连线上） |
| simple-eutectic | 4 | 5（389） | 3（478） | — | A+B+C |
| ss-eutectic | **908** | 54（747） | 43（621） | 24 | α+β+γ |
| ss-isomorphous | 10 | 15（363） | 15（884） | 25 | α |

**浏览器长任务**（ss-eutectic，工作台）：切换体系 1935 + 52 + 951 ms；setT（等温视图）147 ms；setX0 117 ms。化学计量体系 setX0 3–5 ms、setT 2–3 ms。

**各体系不变点**（°C）：binary-incongruent E 561、U 591、p 774、e₁ 762、e₂ 728、e₃ 626；ternary-incongruent E 565、U₁ 649、U₂ 610；binary-congruent E₁ 657、E₂ 590；simple-eutectic E 534；ss-eutectic E 599；ss-isomorphous 无。——没有 P 型（双转熔）点。

**布局溢出**（1024×768）：`.tstrip` 808 / 1301 px；`.vp-hint` 377 / 783 px；顶栏相区读数被截断。

## 附录 B　开源组件选型

| 用途 | 选择 | 理由 | 备选 / 不选原因 |
| --- | --- | --- | --- |
| Worker 通信 | `comlink` | 体积 ~1 KB，类型友好，Vite 原生支持 module worker | 手写 postMessage：样板多、易错 |
| 公式排版 | `katex` | 同步渲染、离线、输出稳定，适合大量小公式 | MathJax 3：更重、异步排版易闪烁 |
| E2E / 视觉回归 | `@playwright/test` | 截图基线、多尺寸、可读 PerformanceObserver | Cypress：视觉回归需插件 |
| LP 参照（仅测试） | `highs`（HiGHS WASM） | 工业级 LP，用作独立对照 | glpk.js：可用但更慢；不进生产 |
| 相界追踪算法 | 自研（参照 Sundman 等映射算法、pycalphad mapping 设计） | 三元 + 正规溶液规模小，自研可控；pycalphad 为 Python，不宜进浏览器 | Pyodide + pycalphad：体积与启动时间不可接受 |
| Scheil 假设表述 | 参照 pycalphad `scheil` 包 | 社区事实标准，便于将来与真实体系结果对照 | — |
| 线性代数 | 保留 `math/linalg.ts` | 3×3 / 4×4 规模，自研 Jacobi SVD 已验证且服务于教学展示 | ml-matrix：无必要 |
| 三维 | 保留 three.js | 已稳定 | — |

## 附录 C　关键文件索引

- 状态：`src/state/store.ts`（全局状态与动作）、`src/state/urlState.ts`（深链接）、`src/state/derived.ts`（派生缓存）
- 外壳：`src/app/AppShell.tsx`、`src/app/GlobalBar.tsx`、`src/app/router.ts`
- 热力学内核：`src/core/thermo.ts`（模型、闭式 T_s、固溶体 argmax）、`src/core/diagram.ts`（构造式平衡）、`src/core/solution.ts`（LP + KKT）、`src/core/topology.ts`（界线、不变点）、`src/core/hullSection.ts`（固溶体等温截面）、`src/core/vertical.ts`、`src/core/isothermal.ts`、`src/core/cooling.ts`
- 数学层：`src/math/*.ts`（`validation.ts` 为页面与测试共用的算例）
- 工作台：`src/pages/workspace/{WorkspacePage,PhaseFigure2D,Inspector}.tsx`、`src/core/canvasDraw.ts`、`src/scene/{Viewport3D.tsx,PhaseScene.ts}`、`src/panels/{CoolingDock,Sidebar,VerticalView,InfoPanel}.tsx`
- 分析页：`src/pages/{linear,rules,thermo,path,lab}/`，共用 `src/viz/{PageLayout,TernaryPlot,XYPlot,Axo3D,MathView}.tsx`
- 样式：`src/styles.css`、`src/shell.css`、`src/workspace.css`（P1.3 后合并到 `src/styles/`）
