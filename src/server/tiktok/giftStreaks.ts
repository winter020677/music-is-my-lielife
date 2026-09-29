// 連打ギフトの数え方（要件 C-3）
//
// TikTokの連打ギフト（バラなど）は、連打の途中で何度もメッセージが届く。
// 例：バラを10連打 → 「1個」「2個」「3個」…「10個」「10個（連打終了）」のように届く。
// ここでは「前回から増えた個数」だけを返すので、演出はちょうど10回分になる（二重に数えない）。
//
// ・連打の区別：視聴者ID＋ギフトID＋TikTokの連打ID（groupId）
// ・連打できないギフトは、メッセージ1つ＝1回の送信
// ・本体を再起動した直後に連打の途中から届いた時は、記録済みの個数（baseline）から続ける

export interface GiftStreakInput {
  viewerId: string;
  giftId: string;
  /** TikTokの連打ID。分からない時は '' */
  groupId: string;
  msgId: string | null;
  repeatCount: number;
  repeatEnd: boolean;
  streakable: boolean;
}

export interface GiftStreakResult {
  /** 記録用の連打の識別 */
  key: string;
  /** 今回新しく増えた個数（演出はこの数で動かす） */
  delta: number;
  /** ここまでの個数 */
  total: number;
  ended: boolean;
}

interface ActiveStreak {
  key: string;
  total: number;
  lastMs: number;
}

export type StreakBaseline = (key: string) => { count: number; ended: boolean } | null;

export class GiftStreakTracker {
  private readonly active = new Map<string, ActiveStreak>();
  private readonly now: () => number;
  private readonly expireMs: number;
  private readonly baseline: StreakBaseline | null;
  private serial = 0;

  constructor(options: { now?: () => number; expireMs?: number; baseline?: StreakBaseline } = {}) {
    this.now = options.now ?? Date.now;
    this.expireMs = options.expireMs ?? 2 * 60 * 1000;
    this.baseline = options.baseline ?? null;
  }

  update(input: GiftStreakInput): GiftStreakResult {
    const nowMs = this.now();
    this.expire(nowMs);
    const count = Math.max(1, Math.floor(Number(input.repeatCount) || 1));

    if (!input.streakable) {
      const key = `msg:${input.msgId ?? `${input.viewerId}:${input.giftId}:${nowMs}:${this.nextSerial()}`}`;
      return { key, delta: count, total: count, ended: true };
    }

    const hasGroup = input.groupId !== '' && input.groupId !== '0';
    const trackKey = hasGroup ? `${input.viewerId}:${input.giftId}:${input.groupId}` : `${input.viewerId}:${input.giftId}`;
    let streak = this.active.get(trackKey);
    if (!streak) {
      // 連打IDが分からない時は、連打ごとに別の記録になるよう、印を足す
      const key = hasGroup ? trackKey : `${trackKey}:${nowMs.toString(36)}${this.nextSerial()}`;
      let base = 0;
      // 途中（2個目以降）から届いた連打は、再起動前に記録した分があるかもしれない
      if (hasGroup && count > 1 && this.baseline) {
        const known = this.baseline(key);
        if (known) {
          if (known.ended && count <= known.count) return { key, delta: 0, total: known.count, ended: true };
          base = known.count;
        }
      }
      streak = { key, total: base, lastMs: nowMs };
      this.active.set(trackKey, streak);
    }

    const delta = Math.max(0, count - streak.total);
    streak.total = Math.max(streak.total, count);
    streak.lastMs = nowMs;
    if (input.repeatEnd) this.active.delete(trackKey);
    return { key: streak.key, delta, total: streak.total, ended: input.repeatEnd };
  }

  /** 連打の途中で長く止まったものは忘れる（連打終了の知らせが来なかった時のため） */
  private expire(nowMs: number): void {
    for (const [trackKey, streak] of this.active) {
      if (nowMs - streak.lastMs > this.expireMs) this.active.delete(trackKey);
    }
  }

  private nextSerial(): string {
    this.serial += 1;
    return this.serial.toString(36);
  }
}
