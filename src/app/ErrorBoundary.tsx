import { Component, type ErrorInfo, type ReactNode } from 'react';

/** 页面级错误边界：任何页面中的异常都只影响该页面，并给出可复现的诊断信息，而不是让整个应用白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { err: Error | null }> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('页面渲染错误', err, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="page-error">
        <h3>本页面计算或渲染出错</h3>
        <p>其他页面不受影响。可以改变成分 / 温度后重试，或复制下面的信息与地址栏链接用于复现。</p>
        <pre>{String(this.state.err.stack ?? this.state.err.message).slice(0, 1200)}</pre>
        <p className="mono small">{location.href}</p>
        <button className="btn" onClick={() => this.setState({ err: null })}>
          重试
        </button>
      </div>
    );
  }
}
