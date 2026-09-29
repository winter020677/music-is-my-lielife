// 順番待ち（要件 6.4）
//
// やること（演出・Minecraftのコマンド・読み上げ）を1つずつ順番に処理する。
// ・種類ごとに別の順番待ちにするので、お互いを待たせない（要件 Q-1）
// ・一時停止・再開・スキップ・全消去ができる（要件 Q-2）
// ・次を始めるまでの最短の間隔を決められる（Minecraftへ送る速さの上限。要件 Q-3）
// ・「割り込み」は列の先頭に入れる（要件 A-6）

import { describeError, type AreaLogger } from './logger.ts';

export interface QueueSnapshot {
  name: string;
  label: string;
  paused: boolean;
  running: string | null;
  pending: number;
  next: string[];
}

interface Job<T> {
  data: T;
  label: string;
  onDone?: (error: unknown) => void;
}

const MAX_PENDING = 5000;

export class ActionQueue<T> {
  readonly name: string;
  readonly label: string;
  private readonly runJob: (data: T, signal: AbortSignal) => Promise<void>;
  private readonly minIntervalMs: () => number;
  private readonly log: AreaLogger;
  private readonly jobs: Job<T>[] = [];
  private paused = false;
  private running: { job: Job<T>; abort: AbortController } | null = null;
  private loopActive = false;
  private lastStartMs = 0;
  private readonly listeners = new Set<() => void>();

  constructor(options: {
    name: string;
    label: string;
    run: (data: T, signal: AbortSignal) => Promise<void>;
    minIntervalMs?: () => number;
    log: AreaLogger;
  }) {
    this.name = options.name;
    this.label = options.label;
    this.runJob = options.run;
    this.minIntervalMs = options.minIntervalMs ?? (() => 0);
    this.log = options.log;
  }

  /** 順番待ちに入れる。priority なら先頭に入れる（割り込み） */
  push(data: T, label: string, options: { priority?: boolean; onDone?: (error: unknown) => void } = {}): void {
    const job: Job<T> = { data, label, onDone: options.onDone };
    if (options.priority) this.jobs.unshift(job);
    else this.jobs.push(job);
    if (this.jobs.length > MAX_PENDING) {
      const dropped = this.jobs.splice(MAX_PENDING);
      for (const d of dropped) d.onDone?.(new Error('順番待ちがいっぱいのため捨てました'));
      this.log.warn(`${this.label}の順番待ちが多すぎるため、${dropped.length}件を捨てました`);
    }
    this.changed();
    void this.loop();
  }

  pause(): void {
    this.paused = true;
    this.changed();
  }

  resume(): void {
    this.paused = false;
    this.changed();
    void this.loop();
  }

  /** 今やっているものを止めて、次へ進む */
  skip(): void {
    this.running?.abort.abort();
  }

  /** 待っているものを全部消す（今やっているものも止める） */
  clear(): void {
    const dropped = this.jobs.splice(0);
    for (const d of dropped) d.onDone?.(new Error('全消去しました'));
    this.running?.abort.abort();
    this.changed();
  }

  snapshot(): QueueSnapshot {
    return {
      name: this.name,
      label: this.label,
      paused: this.paused,
      running: this.running?.job.label ?? null,
      pending: this.jobs.length,
      next: this.jobs.slice(0, 5).map((j) => j.label),
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async loop(): Promise<void> {
    if (this.loopActive) return;
    this.loopActive = true;
    try {
      while (!this.paused && this.jobs.length > 0) {
        const wait = this.lastStartMs + this.minIntervalMs() - Date.now();
        if (wait > 0) await sleep(wait);
        if (this.paused) break;
        const job = this.jobs.shift();
        if (!job) break;
        const abort = new AbortController();
        this.running = { job, abort };
        this.lastStartMs = Date.now();
        this.changed();
        let error: unknown = null;
        try {
          await this.runJob(job.data, abort.signal);
        } catch (err) {
          error = err;
          if (!abort.signal.aborted) this.log.warn(`${this.label}「${job.label}」でエラー: ${describeError(err)}`);
        }
        this.running = null;
        job.onDone?.(abort.signal.aborted && !error ? new Error('スキップしました') : error);
        this.changed();
      }
    } finally {
      this.loopActive = false;
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 指定した時間待つ。signal で途中で止められる */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
