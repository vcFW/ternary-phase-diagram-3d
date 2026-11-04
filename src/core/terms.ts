/**
 * 术语表（单一来源）：反应 / 不变点 / 界线 / 化合物的名称、别名与符号。
 * 兼顾国内教材的别名；界面与文档一律从这里取，首次出现处用 termFull() 展示"名称 · 别名"。
 */
export interface Term {
  /** 规范名称 */
  name: string;
  /** 简称（图例、紧凑处） */
  short: string;
  /** 教材别名 */
  aliases: string[];
  symbol?: string;
  /** 代表性反应式（降温方向） */
  reaction?: string;
}

export const TERMS = {
  eutectic: { name: '三元共晶点', short: '共晶点', aliases: ['低共熔点'], symbol: 'E', reaction: 'L → α + β + γ' },
  transition: { name: '过渡点（单转熔点）', short: '过渡点', aliases: ['双升点', '包共晶点'], symbol: 'U', reaction: 'L + α ⇌ β + γ' },
  peritectic: { name: '三元包晶点（双转熔点）', short: '包晶点', aliases: ['双降点'], symbol: 'P', reaction: 'L + α + β ⇌ γ' },
  eutecticLine: { name: '共晶线', short: '共晶线', aliases: ['单变共晶线', '界线（共晶型）'], reaction: 'L → α + β' },
  peritecticLine: { name: '转熔线', short: '转熔线', aliases: ['包晶线'], reaction: 'L + α → β' },
  congruent: { name: '一致熔融化合物', short: '稳定化合物', aliases: ['稳定化合物'] },
  incongruent: { name: '不一致熔融化合物', short: '不稳定化合物', aliases: ['不稳定化合物'] },
  primaryField: { name: '初晶区', short: '初晶区', aliases: ['初晶面', '结晶区'] },
  tieLine: { name: '连结线', short: '连结线', aliases: ['共轭线'] },
  tieTriangle: { name: '连结三角形', short: '连结三角形', aliases: ['共轭三角形'] },
  subTriangle: { name: '副三角形', short: '副三角形', aliases: ['相容三角形', '分三角形'] },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

/** 首次出现处的完整展示：名称 · 别名 */
export function termFull(t: Term): string {
  return t.aliases.length ? `${t.name} · 别名：${t.aliases.join('、')}` : t.name;
}

/** 不变点类型 → 术语 */
export const INVARIANT_TERM = { eutectic: TERMS.eutectic, transition: TERMS.transition, peritectic: TERMS.peritectic } as const;
