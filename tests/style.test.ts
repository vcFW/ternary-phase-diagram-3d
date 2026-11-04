import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokensCss } from '../src/ui/tokens';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk('src');
const HEX = /#[0-9a-fA-F]{3,6}\b/;
const HEX_NUM = /\b0x[0-9a-fA-F]{6}\b/;

describe('设计令牌', () => {
  it('业务代码（除 tokens.ts）不含十六进制颜色字面量', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\.tsx?$/.test(x) && !x.endsWith('ui/tokens.ts'))) {
      const s = readFileSync(f, 'utf8');
      if (HEX.test(s) || HEX_NUM.test(s)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it('样式表（除 tokens.css）不含十六进制颜色，字号只用 --fs-* 阶梯', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x.endsWith('.css') && !x.endsWith('tokens.css'))) {
      const s = readFileSync(f, 'utf8');
      if (HEX.test(s)) bad.push(`${f}: hex`);
      for (const m of s.matchAll(/font-size:\s*([^;]+);/g)) if (!/^var\(--fs-(xs|sm|md|lg|xl)\)$/.test(m[1].trim())) bad.push(`${f}: font-size ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('tokens.css 与 tokens.ts 同步', () => {
    expect(readFileSync('src/styles/tokens.css', 'utf8')).toBe(tokensCss());
  });

  it('不再存在旧样式文件', () => {
    expect(files.filter((f) => /src\/(styles|shell|workspace)\.css$/.test(f))).toEqual([]);
  });

  it('术语只在 core/terms.ts 中以完整字面量出现', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\.tsx?$/.test(x) && !x.endsWith('core/terms.ts'))) {
      const s = readFileSync(f, 'utf8');
      for (const lit of ['过渡点（单转熔点）', '三元包晶点（双转熔点）', '三元共晶点（低共熔点）']) if (s.includes(lit)) bad.push(`${f}: ${lit}`);
    }
    expect(bad).toEqual([]);
  });

  it('canvasDraw.ts 只保留填充底图：行数较旧版（844 行）减少 ≥ 50%', () => {
    const n = readFileSync('src/core/canvasDraw.ts', 'utf8').split('\n').length;
    expect(n).toBeLessThanOrEqual(422);
  });
});
