// 連打ギフトの数え方（要件 C-3）のテスト
import { describe, expect, it } from 'vitest';
import { GiftStreakTracker, type GiftStreakInput } from '../src/server/tiktok/giftStreaks.ts';

const rose = (repeatCount: number, repeatEnd = false, extra: Partial<GiftStreakInput> = {}): GiftStreakInput => ({
  viewerId: '111',
  giftId: '5655',
  groupId: '1700000000000',
  msgId: null,
  repeatCount,
  repeatEnd,
  streakable: true,
  ...extra,
});

describe('連打ギフト', () => {
  it('バラ10連打 → ちょうど10回分（途中の知らせ＋終了の知らせ）', () => {
    const t = new GiftStreakTracker();
    let total = 0;
    for (let i = 1; i <= 10; i++) total += t.update(rose(i)).delta;
    const end = t.update(rose(10, true));
    total += end.delta;
    expect(total).toBe(10);
    expect(end.ended).toBe(true);
    expect(end.total).toBe(10);
  });

  it('知らせが飛び飛びでも、増えた分だけ数える', () => {
    const t = new GiftStreakTracker();
    expect(t.update(rose(1)).delta).toBe(1);
    expect(t.update(rose(4)).delta).toBe(3);
    expect(t.update(rose(9, true)).delta).toBe(5);
  });

  it('同じ個数の知らせが2回来ても、二重に数えない', () => {
    const t = new GiftStreakTracker();
    t.update(rose(3));
    expect(t.update(rose(3)).delta).toBe(0);
  });

  it('順番が前後しても、減った分は数えない', () => {
    const t = new GiftStreakTracker();
    t.update(rose(5));
    expect(t.update(rose(4)).delta).toBe(0);
    expect(t.update(rose(6)).delta).toBe(1);
  });

  it('連打が終わった後の新しい連打は、また1から数える', () => {
    const t = new GiftStreakTracker();
    t.update(rose(2, true));
    const next = t.update(rose(1, false, { groupId: '1700000009999' }));
    expect(next.delta).toBe(1);
  });

  it('人が違えば別の連打', () => {
    const t = new GiftStreakTracker();
    t.update(rose(5));
    expect(t.update(rose(2, false, { viewerId: '222' })).delta).toBe(2);
  });

  it('連打できないギフトは、知らせ1つ＝1回の送信', () => {
    const t = new GiftStreakTracker();
    const a = t.update(rose(1, true, { streakable: false, msgId: 'm1' }));
    const b = t.update(rose(1, true, { streakable: false, msgId: 'm2' }));
    expect(a.delta + b.delta).toBe(2);
    expect(a.key).not.toBe(b.key);
  });

  it('連打IDが分からない時も、連打ごとに別の記録になる', () => {
    const t = new GiftStreakTracker();
    const first = t.update(rose(1, false, { groupId: '' }));
    t.update(rose(2, true, { groupId: '' }));
    const second = t.update(rose(1, false, { groupId: '' }));
    expect(second.delta).toBe(1);
    expect(second.key).not.toBe(first.key);
  });

  it('再起動の直後に連打の途中から届いたら、記録済みの個数から続ける', () => {
    const t = new GiftStreakTracker({ baseline: () => ({ count: 6, ended: false }) });
    expect(t.update(rose(8)).delta).toBe(2);
  });

  it('再起動の直後に、終わった連打の古い知らせが来ても数えない', () => {
    const t = new GiftStreakTracker({ baseline: () => ({ count: 10, ended: true }) });
    expect(t.update(rose(10, true)).delta).toBe(0);
  });

  it('連打の途中で長く止まったものは忘れる', () => {
    let now = 0;
    const t = new GiftStreakTracker({ now: () => now, expireMs: 1000 });
    t.update(rose(3, false, { groupId: '' }));
    now = 5000;
    expect(t.update(rose(1, false, { groupId: '' })).delta).toBe(1);
  });
});
