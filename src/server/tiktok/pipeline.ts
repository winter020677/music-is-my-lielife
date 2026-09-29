// TikTokから届いたデータを、本体のイベントにして流すまでの道筋
//
//  届いたデータ → 同じメッセージは捨てる → 形をそろえる（normalize）→ 連打ギフトの差分計算 → イベントとして流す
//
// ・同じメッセージの二重処理を防ぐ：接続し直した時や、本体を再起動した時に、
//   TikTokが少し前のメッセージをもう一度送ってくることがあるため
// ・接続した直後にまとめて届く「少し前のデータ」は、記録はするが、古すぎるものは演出しない

import type { LiveEvent } from '../core/events.ts';
import type { AreaLogger } from '../core/logger.ts';
import { toIso } from '../core/time.ts';
import type { DailyCounters } from '../db/counters.ts';
import type { Recorder, StreamInfo } from '../db/recorder.ts';
import { GiftStreakTracker } from './giftStreaks.ts';
import { normalize } from './normalize.ts';

const SEEN_CAPACITY = 20_000;
const SEEN_PRELOAD_MS = 2 * 60 * 60 * 1000;

/** 最近見たIDを覚えておく（古いものから忘れる） */
export class RecentIds {
  private readonly ids = new Set<string>();
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }
}

export class EventPipeline {
  private readonly recorder: Recorder;
  private readonly emit: (event: LiveEvent) => void;
  private readonly counters: DailyCounters;
  private readonly log: AreaLogger;
  private readonly getLateSec: () => number;
  private readonly now: () => number;
  private readonly seen = new RecentIds(SEEN_CAPACITY);
  private readonly streaks: GiftStreakTracker;
  private initialBatch = false;
  private preloaded = false;

  constructor(options: {
    recorder: Recorder;
    emit: (event: LiveEvent) => void;
    counters: DailyCounters;
    log: AreaLogger;
    getLateSec: () => number;
    now?: () => number;
  }) {
    this.recorder = options.recorder;
    this.emit = options.emit;
    this.counters = options.counters;
    this.log = options.log;
    this.getLateSec = options.getLateSec;
    this.now = options.now ?? Date.now;
    this.streaks = new GiftStreakTracker({
      now: this.now,
      baseline: (key) => this.recorder.giftStreakBaseline(key),
    });
  }

  /** これから接続する（この後、接続が終わるまでに届くのは「少し前のデータ」） */
  beginConnect(info: StreamInfo): void {
    if (!this.preloaded) {
      this.preloaded = true;
      for (const id of this.recorder.recentMessageIds(this.now() - SEEN_PRELOAD_MS)) this.seen.add(id);
    }
    this.recorder.expectStream(info);
    this.initialBatch = true;
  }

  connected(info: StreamInfo): void {
    this.initialBatch = false;
    this.recorder.streamConnected(info);
  }

  connectFailed(): void {
    this.initialBatch = false;
  }

  /** TikTokから届いたデータ1つを処理する */
  handleRaw(name: string, data: unknown): void {
    const nowMs = this.now();
    const msgId = messageIdOf(data);
    if (msgId) {
      if (this.seen.has(msgId)) {
        this.counters.increment('tiktok.duplicate');
        return;
      }
      this.seen.add(msgId);
    }

    let normalized;
    try {
      normalized = normalize(name, data, {
        nowMs,
        initialBatch: this.initialBatch,
        lateMs: this.getLateSec() * 1000,
      });
    } catch (err) {
      this.log.error(`TikTokのデータ（${name}）を読めませんでした`, err);
      return;
    }

    if (normalized.type === 'ignore') {
      if (name === 'member') this.counters.increment(`tiktok.member.ignored`);
      return;
    }
    if (msgId) this.recorder.rememberMessage(msgId, toIso(nowMs));

    if (normalized.type === 'event') {
      this.emit(normalized.event);
      return;
    }

    const raw = normalized.gift;
    const streak = this.streaks.update({
      viewerId: raw.viewer?.id ?? '',
      giftId: raw.giftId,
      groupId: raw.groupId,
      msgId: raw.msgId,
      repeatCount: raw.repeatCount,
      repeatEnd: raw.repeatEnd,
      streakable: raw.streakable,
    });
    this.emit({
      kind: 'gift',
      at: raw.at,
      msgId: raw.msgId,
      isTest: false,
      late: raw.late,
      viewer: raw.viewer,
      giftId: raw.giftId,
      giftName: raw.giftName,
      coinsEach: raw.coinsEach,
      imageUrl: raw.imageUrl,
      count: streak.delta,
      streakTotal: streak.total,
      streakKey: streak.key,
      streakable: raw.streakable,
      streakEnded: streak.ended,
    });
  }

  /** TikTokから配信終了の知らせが来た */
  streamEnded(): void {
    const nowMs = this.now();
    this.recorder.streamEnded(nowMs);
    this.emit({ kind: 'streamEnd', at: toIso(nowMs), msgId: null, isTest: false, late: false });
  }

  /** 切れたあと、配信が終わっていると分かった */
  streamOffline(): void {
    this.recorder.streamOffline();
  }
}

function messageIdOf(data: unknown): string | null {
  const id = (data as { common?: { msgId?: unknown } } | null)?.common?.msgId;
  if (id === undefined || id === null) return null;
  const text = String(id);
  return text === '' || text === '0' ? null : text;
}
