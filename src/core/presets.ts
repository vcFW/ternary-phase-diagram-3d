import type { Comp, CompoundDef, SolutionPhaseDef, SystemParams } from './types';

/**
 * 教学体系预设。全部为假想组元 A–B–C 的示意参数（液相正规溶液 + 化学计量化合物，固相互不溶），
 * 不代表任何真实材料；相图拓扑由热力学模型自动给出，而非手工绘制。
 */
export interface Preset {
  id: string;
  name: string;
  short: string;
  description: string;
  /** 教学要点 */
  points: string[];
  params: SystemParams;
  /** 典型成分（教学演示用） */
  examples: { name: string; x: Comp; note: string; final: string }[];
  /** 默认状态点 */
  x0: Comp;
  /** 可调节稳定度的化合物下标（0 起）；无则 -1 */
  tunable: number;
}

const comps = (): SystemParams['components'] => [
  { symbol: 'A', name: '组元 A', Tm: 1573.15, dH: 21000 },
  { symbol: 'B', name: '组元 B', Tm: 1223.15, dH: 15000 },
  { symbol: 'C', name: '组元 C', Tm: 1423.15, dH: 18000 },
];

/**
 * 固溶体相：host 为基体组元（°G_host = 0），其余组元在该结构中的晶格稳定性 L（J/mol，°G = L，与温度无关）。
 * 数值为示意参数，略作不对称以避免对称性造成的退化（例如恰在对称线上的成分同时到达两条溶解度线）。
 */
const ssPhase = (host: 0 | 1 | 2, id: string, L: [number, number, number], om: { AB: number; AC: number; BC: number }): SolutionPhaseDef => ({
  id,
  label: id,
  formula: `(${'ABC'[host]})`,
  n: [0, 1, 2].map((i) => (i === host ? 1 : 0)) as Comp,
  g0: [[L[0], 0], [L[1], 0], [L[2], 0]],
  omega: om,
});

const binaryD = (dHf: number): CompoundDef => ({ id: 'D', label: 'D', formula: 'AB', n: [0.5, 0.5, 0], dHf, dSf: 0 });
const ternaryS = (dHf: number): CompoundDef => ({ id: 'S', label: 'S', formula: 'A₂BC', n: [0.5, 0.25, 0.25], dHf, dSf: 0 });

export const PRESETS: Preset[] = [
  {
    id: 'binary-incongruent',
    name: '含不一致熔融二元化合物 D（AB）',
    short: '二元不稳定化合物',
    description:
      'A–B 边上存在化合物 D（AB）：加热到包晶温度 p 即分解为液相 + A。D 的成分点落在 A 的初晶区内，没有自己的熔点极大值；三元体系中出现转熔线（L + A → D）与过渡点（L + A ⇌ C + D）。',
    points: [
      'D 的成分点不在自身初晶区内 → 不稳定（不一致熔融）化合物。',
      '转熔线用双箭头：液相沿线降温时 A 被回溶、D 析出（L + A → D）。',
      'D–C 连线（Alkemade 线）不与界线构成温度极大点，因此不是真正的二元截面。',
      '过渡点 U：L + A ⇌ C + D —— 液相位于相容三角形 A–D–C 之外。',
    ],
    params: { components: comps(), omega: { AB: 0, AC: 0, BC: 0 }, compounds: [binaryD(-1500)], Cp: 30 },
    examples: [
      { name: 'D 成分点：完全转熔', x: [0.5, 0.5, 0], note: 'A 初晶；到达包晶温度 p 时 L + A → D 在恒温下进行至 A、L 同时耗尽，终态为纯 D。', final: 'D' },
      { name: 'A 初晶 → 转熔 → 过渡点 U（A 有剩余）', x: [0.6, 0.25, 0.15], note: '沿转熔线 L + A → D，在 U 点 L + A → C + D，液相先于 A 耗尽，终态 A + C + D。', final: 'A+C+D' },
      { name: 'A 初晶 → 转熔 → A 耗尽 → 共晶线 → E', x: [0.4, 0.5, 0.1], note: '转熔使 A 被完全回溶，液相离开转熔线沿 C/D 共晶线到达 E，终态 B + C + D。', final: 'B+C+D' },
      { name: 'C 初晶 → A + C 共晶线 → U', x: [0.25, 0.2, 0.55], note: '液相沿 A/C 共晶线到达过渡点 U，L + A ⇌ C + D 后液相耗尽。', final: 'A+C+D' },
      { name: 'D 初晶 → C + D 共晶线 → E', x: [0.3, 0.4, 0.3], note: '成分点在 D 的初晶区，不经过转熔反应。', final: 'B+C+D' },
      { name: 'B 初晶 → B + D 共晶线 → E', x: [0.15, 0.65, 0.2], note: '远离 A 的区域，行为与简单共晶体系相同。', final: 'B+C+D' },
    ],
    x0: [0.4, 0.3, 0.3],
    tunable: 0,
  },
  {
    id: 'ternary-incongruent',
    name: '含不一致熔融三元化合物 S（A₂BC）',
    short: '三元不稳定化合物',
    description:
      '三角形内部的化合物 S（A₂BC）成分点落在 A 的初晶区内：加热时 S 在转熔温度分解。S 的初晶区被 A 区"包围"，边界 A/S 为转熔线，两端为过渡点 U₁、U₂，另有一个三元共晶点 E。',
    points: [
      'S 的成分点位于 A 的初晶区 → 不一致熔融，S 无自己的熔点。',
      'A/S 界线为转熔线（双箭头）：L + A → S。',
      '两个过渡点 U₁、U₂：L + A ⇌ C + S 与 L + A ⇌ B + S；终点为三元共晶 E。',
      '与稳定三元化合物对比：拖动"化合物稳定度"，可看到 S 由不稳定变为一致熔融（拓扑突变）。',
    ],
    params: { components: comps(), omega: { AB: 0, AC: 0, BC: 0 }, compounds: [ternaryS(-1800)], Cp: 30 },
    examples: [
      { name: 'S 成分点：完全转熔', x: [0.5, 0.25, 0.25], note: 'A 初晶；在 A/S 转熔线温度极大点附近 L + A → S 近似恒温完成，终态为纯 S。', final: 'S' },
      { name: 'A 初晶 → 转熔 → 过渡点 U₂（A 有剩余）', x: [0.55, 0.35, 0.1], note: '沿 A/S 转熔线 L + A → S，到 U₂ 点液相耗尽，终态 A + B + S。', final: 'A+B+S' },
      { name: 'A 初晶 → 转熔 → A 耗尽 → 共晶线 → E', x: [0.35, 0.35, 0.3], note: 'A 在转熔中被耗尽，液相转入 C/S 共晶线，直至 E。', final: 'B+C+S' },
      { name: 'C 初晶 → A + C → 过渡点 U₁', x: [0.3, 0.1, 0.6], note: '在 U₁ 点 L + A ⇌ C + S，液相耗尽，终态 A + C + S。', final: 'A+C+S' },
      { name: 'S 初晶 → E', x: [0.25, 0.4, 0.35], note: '成分点在 S 的初晶区，直接结晶 S，经共晶线到 E。', final: 'B+C+S' },
    ],
    x0: [0.45, 0.28, 0.27],
    tunable: 0,
  },
  {
    id: 'binary-congruent',
    name: '对照：一致熔融二元化合物 D（AB）',
    short: '二元稳定化合物（对照）',
    description:
      '与第一个体系结构相同，但 D 生成焓更负：D 在自身成分点具有熔点极大值，A–B 二元系分裂为两个简单共晶子系，D–C 连线成为真正的二元截面（Alkemade 线），界线上出现温度极大点。',
    points: [
      'D 的成分点位于自身初晶区内 → 稳定（一致熔融）化合物。',
      'D–C 连线与 D/C 界线相交处为温度极大点（鞍点），该连线为真正的伪二元截面。',
      '三元体系被 D–C 连线分为 A–D–C 与 D–B–C 两个独立的共晶副三角形。',
    ],
    params: { components: comps(), omega: { AB: 0, AC: 0, BC: 0 }, compounds: [binaryD(-4000)], Cp: 30 },
    examples: [
      { name: 'D 成分点：一致熔融', x: [0.5, 0.5, 0], note: 'D 在自身成分点熔化（熔点极大），凝固为纯 D，无转熔。', final: 'D' },
      { name: 'D–C 连线上（伪二元）', x: [0.3, 0.3, 0.4], note: '成分点在 D–C 连线上：终态为 C + D 两相。该连线是真正的伪二元截面，有效组元数 C = 2（相律 F = C − P + 1）。', final: 'C+D' },
      { name: 'A–D–C 副三角形内', x: [0.3, 0.2, 0.5], note: '终点为 E₁（A + C + D 共晶）。', final: 'A+C+D' },
      { name: 'D–B–C 副三角形内', x: [0.15, 0.5, 0.35], note: '终点为 E₂（B + C + D 共晶）。', final: 'B+C+D' },
    ],
    x0: [0.32, 0.3, 0.38],
    tunable: 0,
  },
  {
    id: 'simple-eutectic',
    name: '对照：简单三元共晶',
    short: '简单三元共晶',
    description: '三个组元互不形成化合物、固相互不溶，液相为理想溶液：三条共晶线交于唯一的三元共晶点 E，用作参照。',
    points: ['三个初晶区，三条单箭头共晶线交于 E。', '任一成分的结晶终点均为 E 的等温平台。'],
    params: { components: comps(), omega: { AB: 0, AC: 0, BC: 0 }, compounds: [], Cp: 30 },
    examples: [
      { name: '体系中心附近', x: [0.35, 0.3, 0.35], note: '初晶后沿共晶线到达 E，E 点恒温平台结晶完毕。', final: 'A+B+C' },
      { name: 'A 角附近', x: [0.7, 0.1, 0.2], note: '先析出大量 A，液相成分沿 A 的初晶面移动。', final: 'A+B+C' },
      { name: 'C 角附近', x: [0.1, 0.2, 0.7], note: '', final: 'A+B+C' },
    ],
    x0: [0.4, 0.3, 0.3],
    tunable: -1,
  },
  {
    id: 'ternary-peritectic',
    name: '含三元包晶点 P 的体系（不一致熔融三元化合物 S）',
    short: '三元包晶点 P（双转熔）',
    description:
      '三元化合物 S 的成分点落在 A 的初晶区边缘，加热时 S 分解。体系同时包含三类不变点：三元共晶点 E（L → B + C + S）、过渡点 U（L + A ⇌ B + S）和三元包晶点 P（L + A + C ⇌ S，双转熔点）。P 点的液相位于固相三角形 A–C–S 之外、顶点 S 的"背面"，因此两个固相 A、C 同时被回溶、S 析出。参数由随机搜索筛选固化，仅为教学示意。',
    points: [
      'P 点（双转熔点）：L + A + C → S，液相位于相容三角形 A–C–S 的外侧（反应系数有两个负号）。',
      'U 点（过渡点）：L + A ⇌ B + S（一个负号）；E 点：L → B + C + S（全正）。三类不变点在同一体系中并存，可一键对照。',
      '穿过 P 之后若液相仍有剩余，则 A 先被耗尽，液相离开转熔线继续沿共晶线到达 E。',
      '本体系对参数很敏感（稳定度滑块已锁定）：P 与 U 的分类取决于 S 的成分与生成焓之间的微妙平衡。',
    ],
    params: {
      components: comps(),
      omega: { AB: 3330, AC: 3824, BC: -4288 },
      compounds: [{ id: 'S', label: 'S', formula: 'S', n: [0.397, 0.14, 0.463], dHf: -1482, dSf: 0.49 }],
      Cp: 30,
    },
    examples: [
      { name: 'A 初晶 → A/C 共晶线 → P（终点在 P）', x: [0.5, 0.05, 0.45], note: '沿 A/C 共晶线降温到 P 点，L + A + C → S 恒温进行，液相先于 A、C 耗尽，终态 A + C + S。', final: 'A+C+S' },
      { name: 'C 初晶 → P → 继续到 E（穿过 P）', x: [0.3, 0.15, 0.55], note: 'P 点反应中 A 被耗尽，液相离开 P 继续沿共晶线降温，最终在 E 点 L → B + C + S。', final: 'B+C+S' },
      { name: 'A 初晶 → 转熔线 → U（过渡点）', x: [0.4, 0.35, 0.25], note: '转熔线上 A 被回溶、S 析出；到 U 点 L + A → B + S，液相耗尽，终态 A + B + S。', final: 'A+B+S' },
      { name: 'S 初晶 → E', x: [0.2, 0.35, 0.45], note: '成分点在 S 的初晶区，不经过转熔反应，直接沿共晶线到达 E。', final: 'B+C+S' },
    ],
    x0: [0.5, 0.05, 0.45],
    tunable: -1,
  },
  {
    id: 'ss-eutectic',
    name: '固溶体：有限固溶度的三元共晶（α、β、γ）',
    short: '有限固溶度三元共晶',
    description:
      '三个端际固溶体 α（A 基）、β（B 基）、γ（C 基），固相均为正规溶液。连结线不再指向固定的顶点：液相与固相的共轭成分都随温度变化，等温截面由自由能面的下凸包得到；结晶路径弯曲，凝固后还会发生固态脱溶（溶解度线）。',
    points: [
      '固相成分不是定点：初晶阶段液相路径不再是直线（背向线规则失效）。',
      '三元共晶 E：L → α + β + γ，三个固相成分都在三角形内部（有固溶度）。',
      '等温截面 = 下凸包：单相区、两相区（连结线族）、三相连结三角形。',
      '凝固结束后继续降温，溶解度下降，第二相从 α 中析出（固态两相区 / 三相区）。',
    ],
    params: {
      components: comps(),
      omega: { AB: 0, AC: 0, BC: 0 },
      compounds: [],
      Cp: 30,
      solutions: [
        ssPhase(0, 'α', [0, 6000, 5200], { AB: 12500, AC: 11500, BC: 14000 }),
        ssPhase(1, 'β', [6800, 0, 5800], { AB: 12500, AC: 14000, BC: 11800 }),
        ssPhase(2, 'γ', [6400, 5600, 0], { AB: 14000, AC: 11500, BC: 11800 }),
      ],
    },
    examples: [
      { name: 'α 初晶 → α/β 共晶线 → E', x: [0.6, 0.25, 0.15], note: '初晶 α 的成分随温度变化，液相路径略弯；到达 α/β 界线后 L → α + β，最终在 E 点 L → α + β + γ。', final: 'α+β+γ' },
      { name: '单相 α 凝固 → 固态脱溶', x: [0.86, 0.09, 0.05], note: '液相在固相线处耗尽，得到单相 α；继续降温穿过溶解度面，β 从 α 中析出。', final: 'α+β' },
      { name: '体系中部：β 初晶 → E', x: [0.25, 0.5, 0.25], note: '', final: 'α+β+γ' },
    ],
    x0: [0.6, 0.25, 0.15],
    tunable: -1,
  },
  {
    id: 'ss-isomorphous',
    name: '固溶体：三元匀晶（连续固溶体 α）',
    short: '三元匀晶',
    description:
      '液相与固相 α 在全成分范围内互溶（均为理想溶液）。没有界线和不变点；液相面与固相面之间是 L + α 两相区，连结线方向只能由化学势相等确定 —— 对此有 Rachford–Rice 型解析解，用作求解器的参照。',
    points: [
      '只有一个初晶区，无界线、无不变点。',
      '连结线方向由 xᵢˢ / xᵢᴸ = kᵢ(T) 决定，几何上无法预先画出。',
      '平衡冷却：液相与固相成分沿两条弯曲路径同时变化，总成分始终在连结线上。',
    ],
    params: {
      components: comps(),
      omega: { AB: 0, AC: 0, BC: 0 },
      compounds: [],
      Cp: 30,
      solutions: [{ id: 'α', label: 'α', formula: '(A,B,C)', n: [1 / 3, 1 / 3, 1 / 3], g0: [[0, 0], [0, 0], [0, 0]], omega: { AB: 0, AC: 0, BC: 0 } }],
    },
    examples: [
      { name: '体系中部', x: [0.4, 0.3, 0.3], note: '液相线处析出富 A 的 α；冷却时两相成分同时移动，固相线处液相耗尽。', final: 'α' },
      { name: '靠近 B 角', x: [0.15, 0.7, 0.15], note: '', final: 'α' },
    ],
    x0: [0.4, 0.3, 0.3],
    tunable: -1,
  },
];

export function getPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
