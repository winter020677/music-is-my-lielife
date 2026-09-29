// 配信待ち・自動接続・自動再接続（要件 C-5, C-6, C-8）
//
//  起動 → 配信待ち（一定の間隔で「配信が始まったか」を確かめる）
//       → 配信が始まっていたら接続 → 接続中
//       → 切れたら、間隔を少しずつ延ばしながらつなぎ直す（10秒→30秒→1分→最大5分）
//       → 配信終了の知らせが来たら、配信待ちに戻る
//
// 「配信が始まったか」の確認は、ふだんはTikTokに直接聞くので、Euler Streamの回数を使わない。
// 直接の確認が失敗した時だけ、決めた間隔を空けて Euler Stream に聞く（無料枠を守るため）。

import { describeError, type AreaLogger } from '../core/logger.ts';
import type { Settings } from '../config/settings.ts';
import type { DailyCounters } from '../db/counters.ts';
import { OfflineError, RateLimitedError, type LiveCheckResult, type TikTokClient } from './client.ts';
import type { EulerUsage } from './eulerUsage.ts';
import type { EventPipeline } from './pipeline.ts';

export const RETRY_DELAYS_SEC = [10, 30, 60, 300];

export type WatcherStatus =
  | { state: 'idle'; reason: 'no-username' | 'manual' | 'auto-off'; message: string }
  | { state: 'waiting'; message: string; nextCheckAt: string | null; lastCheck: LastCheck | null }
  | { state: 'connecting'; message: string; roomId: string | null }
  | { state: 'connected'; message: string; roomId: string; since: string }
  | { state: 'error'; message: string; hint: string; nextRetryAt: string | null };

export interface LastCheck {
  at: string;
  live: boolean | null;
  source: LiveCheckResult['source'] | null;
  error: string | null;
}

type Timer = ReturnType<typeof setTimeout>;

export interface WatcherDeps {
  client: TikTokClient;
  pipeline: EventPipeline;
  euler: EulerUsage;
  counters: DailyCounters;
  log: AreaLogger;
  getSettings: () => Settings['tiktok'];
  getApiKey: () => string;
  /** 配信待ちの確認で、今の配信の状態が分かった時（前回終わっていない配信の片付けに使う） */
  onLiveState?: (liveRoomId: string | null) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

export class LiveWatcher {
  private readonly d: WatcherDeps;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  private status: WatcherStatus = { state: 'idle', reason: 'auto-off', message: '未接続' };
  private timer: Timer | null = null;
  private generation = 0;
  private failures = 0;
  private lastEulerCheckMs = 0;
  private lastCheck: LastCheck | null = null;
  private manualStop = false;
  private busy = false;
  private liveRoomId: string | null = null;
  private readonly listeners = new Set<(status: WatcherStatus) => void>();

  constructor(deps: WatcherDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  }

  getStatus(): WatcherStatus {
    return this.status;
  }

  onStatus(listener: (status: WatcherStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 起動時・設定を変えた時：設定に合わせて、配信待ちに入るか決める */
  async start(): Promise<void> {
    await this.stopConnection();
    this.failures = 0;
    const settings = this.d.getSettings();
    if (!settings.username.trim()) {
      this.setStatus({ state: 'idle', reason: 'no-username', message: 'TikTokのユーザー名が未設定です。設定画面で入力してください' });
      return;
    }
    if (this.manualStop) {
      this.setStatus({ state: 'idle', reason: 'manual', message: '手動で切断しました（「接続」ボタンで再開）' });
      return;
    }
    if (!settings.autoConnect) {
      this.setStatus({ state: 'idle', reason: 'auto-off', message: '自動接続はオフです（「接続」ボタンで接続）' });
      return;
    }
    this.schedule(0);
  }

  /** 「接続」ボタン：すぐに確認して、配信中ならつなぐ */
  async connectNow(): Promise<void> {
    this.manualStop = false;
    this.failures = 0;
    if (this.status.state === 'connected' || this.busy) return;
    if (!this.d.getSettings().username.trim()) {
      await this.start();
      return;
    }
    this.schedule(0);
  }

  /** 「切断」ボタン：切って、自動でもつながないようにする（「接続」を押すか、再起動で戻る） */
  async disconnectNow(): Promise<void> {
    this.manualStop = true;
    await this.stopConnection();
    this.setStatus({ state: 'idle', reason: 'manual', message: '手動で切断しました（「接続」ボタンで再開）' });
  }

  async shutdown(): Promise<void> {
    await this.stopConnection();
  }

  // ───────── 内部の動き ─────────

  private schedule(delayMs: number): void {
    if (this.timer) this.clearTimer(this.timer);
    const generation = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      void this.checkAndConnect(generation);
    }, delayMs);
  }

  private async checkAndConnect(generation: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.runCheck(generation);
    } finally {
      this.busy = false;
    }
  }

  private async runCheck(generation: number): Promise<void> {
    const settings = this.d.getSettings();
    const intervalMs = settings.liveCheckIntervalSec * 1000;
    const nowMs = this.now();
    const allowEuler =
      settings.eulerFallbackForLiveCheck &&
      this.d.getApiKey() !== '' &&
      this.d.euler.allow('liveCheck') &&
      nowMs - this.lastEulerCheckMs >= settings.eulerFallbackMinIntervalSec * 1000;

    if (this.status.state !== 'error') {
      this.setStatus({ state: 'waiting', message: '配信が始まったか確認しています…', nextCheckAt: null, lastCheck: this.lastCheck });
    }

    let result: LiveCheckResult;
    try {
      result = await this.d.client.checkLive(settings.username, allowEuler);
    } catch (err) {
      if (generation !== this.generation) return;
      this.d.counters.increment('liveCheck.failed');
      this.lastCheck = { at: new Date(this.now()).toISOString(), live: null, source: null, error: describeError(err) };
      this.d.log.warn(`配信中かの確認に失敗しました: ${describeError(err)}`);
      if (allowEuler) this.lastEulerCheckMs = this.now();
      this.wait(intervalMs, 'TikTokに配信の状態を確認できませんでした。インターネット接続を確認してください（自動で確認し直します）');
      return;
    }
    if (generation !== this.generation) return;

    this.d.counters.increment(`liveCheck.${result.source}`);
    if (result.source === 'euler') this.lastEulerCheckMs = this.now();
    this.lastCheck = { at: new Date(this.now()).toISOString(), live: result.live, source: result.source, error: null };

    const liveRoomId = result.live ? result.roomId : null;
    if (this.liveRoomId !== null && this.liveRoomId !== liveRoomId) {
      // 前につながっていた配信は、もう終わっている
      this.d.pipeline.streamOffline();
    }
    this.liveRoomId = liveRoomId;
    this.d.onLiveState?.(liveRoomId);

    if (!result.live || !result.roomId) {
      this.failures = 0;
      this.wait(intervalMs, '配信待ち（配信が始まったら自動でつなぎます）');
      return;
    }
    await this.connect(result, generation);
  }

  private async connect(check: LiveCheckResult, generation: number): Promise<void> {
    const settings = this.d.getSettings();
    const roomId = check.roomId as string;

    if (!this.d.getApiKey()) {
      this.fail(
        'Euler StreamのAPIキーが未設定のため、つなげません',
        '設定画面の「秘密情報」に、Euler StreamのAPIキーを入力してください',
        settings.liveCheckIntervalSec * 1000,
      );
      return;
    }
    if (!this.d.euler.allow('connect')) {
      this.fail(
        '今日のEuler Streamの無料枠を、ほぼ使い切りました',
        '日本時間の朝9時に回数が戻ります。それまで自動の接続を止めます',
        30 * 60 * 1000,
      );
      return;
    }

    this.setStatus({ state: 'connecting', message: 'TikTokにつないでいます…', roomId });
    this.d.pipeline.beginConnect({ roomId, startedAtMs: check.startedAtMs, title: check.title });
    const myGeneration = generation;
    try {
      const info = await this.d.client.connect(settings.username, roomId, {
        onEvent: (name, data) => {
          if (myGeneration === this.generation) this.d.pipeline.handleRaw(name, data);
        },
        onDisconnected: (info) => {
          if (myGeneration === this.generation) this.handleDisconnected(info);
        },
        onStreamEnd: () => {
          if (myGeneration === this.generation) this.handleStreamEnd();
        },
        onError: (message) => this.d.log.warn(`TikTok: ${message}`),
      });
      if (myGeneration !== this.generation) return;
      this.d.pipeline.connected({
        roomId: info.roomId,
        startedAtMs: info.startedAtMs ?? check.startedAtMs,
        title: info.title ?? check.title,
      });
      this.liveRoomId = info.roomId;
      this.failures = 0;
      this.d.counters.increment('connect.ok');
      this.d.log.info(`TikTokにつながりました（ルームID ${info.roomId}）`);
      this.setStatus({ state: 'connected', message: '接続中', roomId: info.roomId, since: new Date(this.now()).toISOString() });
      void this.refreshRateLimits();
    } catch (err) {
      this.d.pipeline.connectFailed();
      if (myGeneration !== this.generation) return;
      if (err instanceof OfflineError) {
        this.d.counters.increment('connect.offline');
        this.wait(settings.liveCheckIntervalSec * 1000, '配信待ち（配信が始まったら自動でつなぎます）');
        return;
      }
      this.d.counters.increment('connect.failed');
      if (err instanceof RateLimitedError) {
        const retryMs = Math.max(60, err.retryAfterSec ?? 600) * 1000;
        this.fail('Euler Streamの回数制限に達しました', '時間をおいて自動で再開します', retryMs);
        return;
      }
      this.failures += 1;
      this.fail(`TikTokにつながりませんでした（${describeError(err)}）`, '自動でつなぎ直します', this.retryDelayMs());
    }
  }

  private handleDisconnected(info: { code?: number; reason?: string }): void {
    if (this.status.state !== 'connected' && this.status.state !== 'connecting') return;
    this.generation += 1;
    this.failures += 1;
    const delay = this.retryDelayMs();
    this.d.counters.increment('connect.dropped');
    this.d.log.warn(`TikTokとの接続が切れました（コード ${info.code ?? '不明'}${info.reason ? `・${info.reason}` : ''}）`);
    this.fail('TikTokとの接続が切れました', `${Math.round(delay / 1000)}秒後につなぎ直します`, delay);
  }

  private handleStreamEnd(): void {
    this.generation += 1;
    this.d.pipeline.streamEnded();
    this.liveRoomId = null;
    this.failures = 0;
    this.d.log.info('配信終了の知らせが届きました');
    const settings = this.d.getSettings();
    void this.d.client.disconnect().catch(() => {});
    this.wait(Math.max(60_000, settings.liveCheckIntervalSec * 1000), '配信が終わりました。次の配信を待っています');
  }

  private wait(delayMs: number, message: string): void {
    this.schedule(delayMs);
    this.setStatus({
      state: 'waiting',
      message,
      nextCheckAt: new Date(this.now() + delayMs).toISOString(),
      lastCheck: this.lastCheck,
    });
  }

  private fail(message: string, hint: string, retryMs: number): void {
    this.schedule(retryMs);
    this.setStatus({ state: 'error', message, hint, nextRetryAt: new Date(this.now() + retryMs).toISOString() });
  }

  private retryDelayMs(): number {
    const index = Math.min(Math.max(this.failures - 1, 0), RETRY_DELAYS_SEC.length - 1);
    return RETRY_DELAYS_SEC[index] * 1000;
  }

  private async stopConnection(): Promise<void> {
    this.generation += 1;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    try {
      await this.d.client.disconnect();
    } catch (err) {
      this.d.log.warn(`切断中にエラー: ${describeError(err)}`);
    }
  }

  /** Euler Streamに、今日の残り回数を聞く（分かれば管理画面に出す） */
  async refreshRateLimits(): Promise<void> {
    try {
      const limits = await this.d.client.fetchRateLimits();
      if (limits) {
        // 残り回数の問い合わせは、使用回数（euler.〜）とは別に数える
        this.d.counters.increment('eulerInfo.rateLimits');
        this.d.euler.setRemote(limits);
      }
    } catch (err) {
      this.d.log.warn(`Euler Streamの残り回数を確認できませんでした: ${describeError(err)}`);
    }
  }

  private setStatus(status: WatcherStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
