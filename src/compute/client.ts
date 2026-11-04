import { wrap, type Remote } from 'comlink';
import type { SystemParams } from '../core/types';
import { computeApi, type ComputeApi } from './api';

/**
 * 计算客户端：主线程侧的封装。
 *   · 浏览器：含固溶体的体系（计算昂贵）走 Web Worker，主线程只做渲染；
 *   · 无 Worker 环境（Node 测试）或化学计量体系：回退为同步 / 微任务内联计算。
 * 每类请求走独立的"最新者优先"通道：同一通道同一时刻最多一个在途请求 + 一个待发请求，
 * 拖动中产生的过期请求会被丢弃而不是排队。
 */
export const workerAvailable = typeof Worker !== 'undefined' && typeof window !== 'undefined';

let remote: Remote<ComputeApi> | null = null;
function api(): Remote<ComputeApi> {
  if (!remote) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    remote = wrap<ComputeApi>(w);
  }
  return remote;
}

/** 该体系的重计算是否应放入 Worker */
export function useWorkerFor(params: SystemParams): boolean {
  return workerAvailable && !!params.solutions?.length;
}

/** 调用计算 API：按体系类型决定在 Worker 还是本线程执行（返回 Promise 以统一接口） */
export function call<K extends keyof ComputeApi>(params: SystemParams, name: K, ...args: Parameters<ComputeApi[K]> extends [unknown, ...infer R] ? R : never): Promise<Awaited<ReturnType<ComputeApi[K]>>> {
  if (useWorkerFor(params)) {
    const fn = api()[name] as unknown as (...a: unknown[]) => Promise<Awaited<ReturnType<ComputeApi[K]>>>;
    return fn(params, ...args);
  }
  const fn = computeApi[name] as unknown as (...a: unknown[]) => Awaited<ReturnType<ComputeApi[K]>>;
  return Promise.resolve().then(() => fn(params, ...args));
}

/** 最新者优先通道：同一时刻最多一个在途任务 + 一个待发任务（新任务顶替旧的待发任务） */
export class Channel {
  private busy = false;
  private pending: { key: string; task: () => Promise<void> } | null = null;

  /** 提交任务；返回被顶替掉的待发任务的 key（无则 null），调用方据此撤销"已请求"标记 */
  submit(key: string, task: () => Promise<void>): string | null {
    if (this.busy) {
      const dropped = this.pending?.key ?? null;
      this.pending = { key, task };
      return dropped;
    }
    this.busy = true;
    task()
      .catch((e) => console.error('计算任务失败', e))
      .finally(() => {
        this.busy = false;
        const next = this.pending;
        this.pending = null;
        if (next) this.submit(next.key, next.task);
      });
    return null;
  }
}
