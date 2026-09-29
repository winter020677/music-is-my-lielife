// 配信待ち・自動接続・自動再接続（要件 C-5, C-6, C-8）と Euler Streamの回数（C-7）のテスト
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/server/config/settings.ts';
import { DailyCounters } from '../src/server/db/counters.ts';
import { Recorder } from '../src/server/db/recorder.ts';
import type { ClientHandlers, ConnectResult, LiveCheckResult, TikTokClient } from '../src/server/tiktok/client.ts';
import { OfflineError } from '../src/server/tiktok/client.ts';
import { EulerUsage } from '../src/server/tiktok/eulerUsage.ts';
import { LiveWatcher, RETRY_DELAYS_SEC } from '../src/server/tiktok/liveWatcher.ts';
import { EventPipeline } from '../src/server/tiktok/pipeline.ts';
import { log, memoryDb, row } from './helpers.ts';

/** にせのTikTok */
class FakeClient implements TikTokClient {
  live: LiveCheckResult = { live: false, roomId: null, startedAtMs: null, title: null, source: 'html' };
  checks: boolean[] = [];
  connects = 0;
  failConnect: Error | null = null;
  handlers: ClientHandlers | null = null;
  setApiKey(): void {}
  async checkLive(_username: string, allowEuler: boolean): Promise<LiveCheckResult> {
    this.checks.push(allowEuler);
    return this.live;
  }
  async connect(_username: string, roomId: string, handlers: ClientHandlers): Promise<ConnectResult> {
    this.connects += 1;
    if (this.failConnect) throw this.failConnect;
    this.handlers = handlers;
    return { roomId, startedAtMs: Date.parse('2026-09-29T09:00:00Z'), title: 'テスト配信' };
  }
  async disconnect(): Promise<void> {
    this.handlers = null;
  }
  async fetchRateLimits() {
    return null;
  }
}

/** 手で進める時計とタイマー */
function fakeTimers() {
  let now = Date.parse('2026-09-29T10:00:00Z');
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn, id: nextId++ };
      timers.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t: ReturnType<typeof setTimeout>) => {
      const i = timers.indexOf(t as unknown as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    /** 次のタイマーまで時間を進めて実行する。待った時間（ミリ秒）を返す */
    async next(): Promise<number> {
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift();
      if (!t) throw new Error('タイマーがありません');
      const waited = t.at - now;
      now = t.at;
      t.fn();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return waited;
    },
    pending: () => timers.length,
  };
}

function setup(options: { apiKey?: string; username?: string; limit?: number } = {}) {
  const db = memoryDb();
  const timers = fakeTimers();
  const settings = defaultSettings();
  settings.tiktok.username = options.username ?? 'my_account';
  settings.tiktok.eulerDailyLimit = options.limit ?? 2500;
  const counters = new DailyCounters(db, timers.now);
  const euler = new EulerUsage(counters, () => settings.tiktok.eulerDailyLimit, log, timers.now);
  const recorder = new Recorder(db, log, timers.now);
  const pipeline = new EventPipeline({ recorder, emit: (e) => recorder.handle(e), counters, log, getLateSec: () => 60, now: timers.now });
  const client = new FakeClient();
  const watcher = new LiveWatcher({
    client,
    pipeline,
    euler,
    counters,
    log,
    getSettings: () => settings.tiktok,
    getApiKey: () => options.apiKey ?? 'key',
    onLiveState: (roomId) => recorder.reconcileOpenStreams(roomId),
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { db, timers, settings, counters, euler, recorder, client, watcher };
}

const LIVE: LiveCheckResult = { live: true, roomId: 'ROOM1', startedAtMs: null, title: null, source: 'html' };

describe('配信待ちと自動接続', () => {
  it('ユーザー名がないと「未接続」のまま', async () => {
    const { watcher } = setup({ username: '' });
    await watcher.start();
    expect(watcher.getStatus()).toMatchObject({ state: 'idle', reason: 'no-username' });
  });

  it('起動したら配信待ちに入り、決めた間隔で確かめる（要件 C-8）', async () => {
    const { watcher, timers, client, counters } = setup();
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus().state).toBe('waiting');
    expect(await timers.next()).toBe(60_000);
    expect(client.checks).toHaveLength(2);
    expect(counters.forDay()['liveCheck.html']).toBe(2);
  });

  it('配信が始まったら自動でつなぎ、記録を始める', async () => {
    const { watcher, timers, client, db } = setup();
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus()).toMatchObject({ state: 'connected', roomId: 'ROOM1' });
    client.handlers?.onEvent('chat', { common: { msgId: 'x1', createTime: String(timers.now()) }, user: { id: '5', nickname: 'a' }, content: 'hi' });
    expect(row(db, 'SELECT room_id, title, started_at_estimated FROM streams')).toEqual({
      room_id: 'ROOM1',
      title: 'テスト配信',
      started_at_estimated: 0,
    });
  });

  it('切れたら、間隔を延ばしながらつなぎ直す（10秒→30秒→1分→5分）（要件 C-6）', async () => {
    const { watcher, timers, client } = setup();
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus().state).toBe('connected');

    client.failConnect = new Error('ネットワークエラー');
    client.handlers?.onDisconnected({ code: 1006 });
    expect(watcher.getStatus().state).toBe('error');
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) waits.push(await timers.next());
    expect(waits).toEqual([10_000, 30_000, 60_000, 300_000, 300_000]);
    expect(RETRY_DELAYS_SEC).toEqual([10, 30, 60, 300]);

    client.failConnect = null;
    await timers.next();
    expect(watcher.getStatus().state).toBe('connected');
  });

  it('切れた後、配信が終わっていたら、記録を「推定」で終える', async () => {
    const { watcher, timers, client, db } = setup();
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    client.handlers?.onEvent('chat', { common: { msgId: 'x1', createTime: String(timers.now()) }, user: { id: '5', nickname: 'a' }, content: 'hi' });
    client.handlers?.onDisconnected({ code: 1006 });
    client.live = { live: false, roomId: 'ROOM1', startedAtMs: null, title: null, source: 'html' };
    await timers.next();
    expect(watcher.getStatus().state).toBe('waiting');
    expect(row(db, 'SELECT ended_at IS NOT NULL AS ended, ended_at_estimated FROM streams')).toEqual({ ended: 1, ended_at_estimated: 1 });
  });

  it('配信終了の知らせで、記録を終えて配信待ちに戻る', async () => {
    const { watcher, timers, client, db } = setup();
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    client.handlers?.onStreamEnd();
    expect(watcher.getStatus().state).toBe('waiting');
    expect(row(db, 'SELECT ended_at_estimated FROM streams')).toEqual({ ended_at_estimated: 0 });
  });

  it('配信していない時の接続エラーは、配信待ちに戻るだけ', async () => {
    const { watcher, timers, client } = setup();
    client.live = LIVE;
    client.failConnect = new OfflineError('offline');
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus().state).toBe('waiting');
  });

  it('APIキーがないと、つながずにエラーで知らせる', async () => {
    const { watcher, timers, client } = setup({ apiKey: '' });
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus()).toMatchObject({ state: 'error' });
    expect(client.connects).toBe(0);
    expect(client.checks).toEqual([false]);
  });

  it('手動で切断したら、自動ではつながない。「接続」で戻る', async () => {
    const { watcher, timers, client } = setup();
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    await watcher.disconnectNow();
    expect(watcher.getStatus()).toMatchObject({ state: 'idle', reason: 'manual' });
    expect(timers.pending()).toBe(0);
    await watcher.connectNow();
    await timers.next();
    expect(watcher.getStatus().state).toBe('connected');
  });
});

describe('Euler Streamの回数（要件 C-7）', () => {
  it('日ごとに数え、8割で配信待ちの確認には使わない', () => {
    const { euler } = setup({ limit: 10 });
    for (let i = 0; i < 7; i++) euler.record('fetchSignedWebSocketFromProvider');
    expect(euler.allow('liveCheck')).toBe(true);
    euler.record('fetchRoomIdFromProvider');
    expect(euler.snapshot()).toMatchObject({ used: 8, limit: 10, warning: true, stopped: false });
    expect(euler.allow('liveCheck')).toBe(false);
    expect(euler.allow('connect')).toBe(true);
    euler.record('x');
    euler.record('x');
    expect(euler.allow('connect')).toBe(false);
    expect(euler.snapshot().byRoute).toEqual({ fetchSignedWebSocketFromProvider: 7, fetchRoomIdFromProvider: 1, x: 2 });
  });

  it('無料枠をほぼ使い切ったら、自動の接続を止める', async () => {
    const { watcher, timers, client, euler } = setup({ limit: 10 });
    for (let i = 0; i < 10; i++) euler.record('x');
    client.live = LIVE;
    await watcher.start();
    await timers.next();
    expect(watcher.getStatus().state).toBe('error');
    expect(client.connects).toBe(0);
    // 配信待ちの確認では Euler Stream を使わない
    expect(client.checks).toEqual([false]);
  });

  it('TikTokに直接確かめられない時の Euler Stream は、決めた間隔を空けてしか使わない', async () => {
    const { watcher, timers, client, settings } = setup();
    settings.tiktok.eulerFallbackMinIntervalSec = 600;
    client.checkLive = async (_u, allowEuler) => {
      client.checks.push(allowEuler);
      throw new Error('ブロックされた');
    };
    await watcher.start();
    for (let i = 0; i < 11; i++) await timers.next();
    // 60秒ごとに確認 → Euler Stream を許すのは最初と、600秒後だけ
    expect(client.checks.filter((x) => x).length).toBe(2);
  });
});
