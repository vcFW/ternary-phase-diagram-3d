import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ReactNode } from 'react';

/**
 * 公式排版（KaTeX，同步渲染、离线、字体随构建打包）。
 * 只随分析页 chunk 加载（工作台首屏不引入）。用法：<TeX>{String.raw`x_0 = \sum_i f_i c_i`}</TeX>
 */
function render(src: string, display: boolean): string {
  return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, output: 'html', trust: false });
}

/** 行内公式 */
export function TeX({ children }: { children: string }) {
  return <span className="tex" dangerouslySetInnerHTML={{ __html: render(children, false) }} />;
}

/** 独立成行的公式；note 为公式后的说明文字（中文说明放在公式之外，避免混排字体问题） */
export function TeXBlock({ children, tag, note }: { children: string; tag?: string; note?: ReactNode }) {
  return (
    <div className="eqn tex-block">
      <span className="tex" dangerouslySetInnerHTML={{ __html: render(children, true) }} />
      {tag && <span className="eqn-tag">({tag})</span>}
      {note && <span className="eqn-note">{note}</span>}
    </div>
  );
}
