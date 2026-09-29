// Euler Streamのリクエスト数を数える（要件 C-7）
//
// TikTokにつなぐ時の「署名」は、Euler Stream（無料のCommunityプラン：1日2,500回まで）に頼んでいる。
// ・使うたびに日ごとの回数を数えて、管理画面に出す
// ・1日の上限の8割で注意を出す
// ・8割を超えたら「配信待ちの確認」には使わない（接続のために残す）
// ・98%を超えたら、自動の接続もやめる（翌日に戻る）
// 数える日付はUTC（日本時間の朝9時に切り替わる）。

import type { AreaLogger } from '../core/logger.ts';
import type { DailyCounters } from '../db/counters.ts';
import type { EulerRateLimits } from './client.ts';

const PREFIX = 'euler.';
export const WARN_RATIO = 0.8;
export const STOP_RATIO = 0.98;

export interface EulerUsageSnapshot {
  day: string;
  used: number;
  limit: number;
  byRoute: Record<string, number>;
  warning: boolean;
  stopped: boolean;
  remote: (EulerRateLimits & { fetchedAt: string }) | null;
}

export class EulerUsage {
  private readonly counters: DailyCounters;
  private readonly getLimit: () => number;
  private readonly log: AreaLogger;
  private readonly now: () => number;
  private warnedDay: string | null = null;
  private remote: (EulerRateLimits & { fetchedAt: string }) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(counters: DailyCounters, getLimit: () => number, log: AreaLogger, now: () => number = Date.now) {
    this.counters = counters;
    this.getLimit = getLimit;
    this.log = log;
    this.now = now;
  }

  /** Euler Streamに1回頼んだことを記録する */
  record(route: string): void {
    this.counters.increment(`${PREFIX}${route}`);
    const used = this.used();
    const limit = this.getLimit();
    const day = this.counters.today();
    if (used >= limit * WARN_RATIO && this.warnedDay !== day) {
      this.warnedDay = day;
      this.log.warn(
        `Euler Streamの今日の使用回数が ${used} 回になりました（上限 ${limit} 回の8割）。配信待ちの確認では使わないようにします`,
      );
    }
    this.notify();
  }

  used(): number {
    return this.counters.sum(PREFIX);
  }

  /** その目的で使ってよいか */
  allow(purpose: 'liveCheck' | 'connect'): boolean {
    const ratio = this.used() / Math.max(1, this.getLimit());
    const remoteLeft = this.remote?.day?.remaining;
    if (typeof remoteLeft === 'number' && remoteLeft <= 0) return false;
    return purpose === 'liveCheck' ? ratio < WARN_RATIO : ratio < STOP_RATIO;
  }

  setRemote(limits: EulerRateLimits): void {
    this.remote = { ...limits, fetchedAt: new Date(this.now()).toISOString() };
    this.notify();
  }

  snapshot(): EulerUsageSnapshot {
    const byRoute: Record<string, number> = {};
    for (const [key, count] of Object.entries(this.counters.forDay())) {
      if (key.startsWith(PREFIX)) byRoute[key.slice(PREFIX.length)] = count;
    }
    const used = Object.values(byRoute).reduce((a, b) => a + b, 0);
    const limit = this.getLimit();
    return {
      day: this.counters.today(),
      used,
      limit,
      byRoute,
      warning: used >= limit * WARN_RATIO,
      stopped: used >= limit * STOP_RATIO,
      remote: this.remote,
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
