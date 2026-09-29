// 配信の記録（要件 6.11）のテスト
import { describe, expect, it } from 'vitest';
import { Recorder } from '../src/server/db/recorder.ts';
import { event, log, memoryDb, row, rows, viewer } from './helpers.ts';

function setup(nowMs = Date.parse('2026-09-29T10:00:00Z')) {
  const db = memoryDb();
  let now = nowMs;
  const recorder = new Recorder(db, log, () => now);
  return { db, recorder, advance: (ms: number) => (now += ms), now: () => now };
}

describe('配信の記録', () => {
  it('最初のイベントで配信の行を作り、開始時刻が分からなければ「推定」の印を付ける', () => {
    const { db, recorder } = setup();
    recorder.expectStream({ roomId: 'R1', startedAtMs: null, title: null });
    expect(row(db, 'SELECT COUNT(*) AS n FROM streams')).toEqual({ n: 0 });
    recorder.handle(event('comment'));
    recorder.flush();
    const s = row<{ room_id: string; started_at_estimated: number }>(db, 'SELECT * FROM streams');
    expect(s.room_id).toBe('R1');
    expect(s.started_at_estimated).toBe(1);
  });

  it('TikTokから開始時刻が分かったら、推定を本当の時刻に直す', () => {
    const { db, recorder } = setup();
    recorder.expectStream({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment'));
    recorder.streamConnected({ roomId: 'R1', startedAtMs: Date.parse('2026-09-29T09:30:00Z'), title: '歌枠' });
    const s = row<{ started_at: string; started_at_estimated: number; title: string }>(db, 'SELECT * FROM streams');
    expect(s.started_at).toBe('2026-09-29T09:30:00.000Z');
    expect(s.started_at_estimated).toBe(0);
    expect(s.title).toBe('歌枠');
  });

  it('同じルームIDなら、接続し直しても1つの配信として記録する（要件 D-1）', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment'));
    recorder.streamOffline();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment'));
    recorder.flush();
    expect(row(db, 'SELECT COUNT(*) AS n FROM streams')).toEqual({ n: 1 });
    expect(row(db, 'SELECT ended_at FROM streams')).toEqual({ ended_at: null });
    expect(row(db, 'SELECT COUNT(*) AS n FROM comments')).toEqual({ n: 2 });
  });

  it('配信終了で、終了時刻と配信時間を記録する', () => {
    const { db, recorder, advance, now } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: now(), title: null });
    advance(90 * 60 * 1000);
    recorder.streamEnded(now());
    const s = row<{ duration_sec: number; ended_at_estimated: number }>(db, 'SELECT * FROM streams');
    expect(s.duration_sec).toBe(90 * 60);
    expect(s.ended_at_estimated).toBe(0);
  });

  it('前回終わっていない配信は、最後にデータが届いた時刻で終了（推定）にする（要件 D-2）', () => {
    const { db, recorder, advance } = setup();
    recorder.streamConnected({ roomId: 'OLD', startedAtMs: null, title: null });
    recorder.handle(event('comment'));
    recorder.flush();
    const last = row<{ last_seen_at: string }>(db, 'SELECT last_seen_at FROM streams').last_seen_at;

    // 本体が止まって、新しく起動した
    advance(3 * 60 * 60 * 1000);
    const recorder2 = new Recorder(db, log);
    recorder2.reconcileOpenStreams(null);
    const s = row<{ ended_at: string; ended_at_estimated: number }>(db, 'SELECT * FROM streams');
    expect(s.ended_at).toBe(last);
    expect(s.ended_at_estimated).toBe(1);
  });

  it('連打ギフトは1行にまとめ、最終的な個数とコインを入れる', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    for (const total of [1, 2, 3]) {
      recorder.handle(event('gift', { streakKey: 'S', streakTotal: total, count: 1, coinsEach: 5, streakEnded: false }));
    }
    recorder.handle(event('gift', { streakKey: 'S', streakTotal: 3, count: 0, coinsEach: 5, streakEnded: true }));
    recorder.flush();
    const gifts = rows<{ count: number; coins: number; streak_ended: number }>(db, 'SELECT count, coins, streak_ended FROM gifts');
    expect(gifts).toEqual([{ count: 3, coins: 15, streak_ended: 1 }]);
    expect(recorder.giftStreakBaseline('S')).toEqual({ count: 3, ended: true });
  });

  it('いいねは人ごと・1分ごとの合計で保存する（要件 D-7）', () => {
    const { db, recorder, advance } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    const at1 = '2026-09-29T10:00:05.000Z';
    const at2 = '2026-09-29T10:00:50.000Z';
    const at3 = '2026-09-29T10:01:10.000Z';
    recorder.handle(event('like', { at: at1, count: 15 }));
    recorder.handle(event('like', { at: at2, count: 5 }));
    recorder.handle(event('like', { at: at3, count: 7 }));
    advance(1000);
    recorder.flush();
    expect(rows(db, 'SELECT minute, count FROM likes ORDER BY minute')).toEqual([
      { minute: '2026-09-29T10:00:00.000Z', count: 20 },
      { minute: '2026-09-29T10:01:00.000Z', count: 7 },
    ]);
  });

  it('入室は人ごと・配信ごとに、初回の時刻と回数で保存する', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('join', { at: '2026-09-29T10:00:00.000Z' }));
    recorder.handle(event('join', { at: '2026-09-29T10:05:00.000Z' }));
    recorder.flush();
    expect(rows(db, 'SELECT first_join_at, join_count FROM visits')).toEqual([
      { first_join_at: '2026-09-29T10:00:00.000Z', join_count: 2 },
    ]);
  });

  it('名前が変わっても同じ人として扱い、名前の履歴を残す（要件 D-3）', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment', { viewer: viewer('42', 'たろう') }));
    recorder.handle(event('comment', { viewer: viewer('42', 'タロウ🎤') }));
    recorder.flush();
    expect(row(db, 'SELECT nickname FROM viewers WHERE viewer_id = ?', '42')).toEqual({ nickname: 'タロウ🎤' });
    expect(rows(db, 'SELECT nickname FROM viewer_names WHERE viewer_id = ? ORDER BY rowid', '42')).toEqual([
      { nickname: 'たろう' },
      { nickname: 'タロウ🎤' },
    ]);
    expect(row(db, 'SELECT COUNT(*) AS n FROM viewers')).toEqual({ n: 1 });
  });

  it('来た配信の数は、配信ごとに1回だけ増える', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment', { viewer: viewer('7') }));
    recorder.handle(event('like', { viewer: viewer('7') }));
    recorder.streamEnded(Date.now());
    recorder.streamConnected({ roomId: 'R2', startedAtMs: null, title: null });
    recorder.handle(event('comment', { viewer: viewer('7') }));
    recorder.flush();
    expect(row(db, 'SELECT stream_count FROM viewers WHERE viewer_id = ?', '7')).toEqual({ stream_count: 2 });
  });

  it('同じTikTokメッセージIDのコメントは二重に保存しない', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('comment', { msgId: 'same' }));
    recorder.handle(event('comment', { msgId: 'same' }));
    recorder.flush();
    expect(row(db, 'SELECT COUNT(*) AS n FROM comments')).toEqual({ n: 1 });
  });

  it('合計を数え直す：テストのイベントは本番の集計に混ぜない（要件 D-8）', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('gift', { viewer: viewer('1'), streakTotal: 10, count: 10, coinsEach: 1 }));
    recorder.handle(event('gift', { viewer: viewer('2'), streakTotal: 1, count: 1, coinsEach: 100 }));
    recorder.handle(event('like', { viewer: viewer('1'), count: 30 }));
    recorder.handle(event('comment', { viewer: viewer('3') }));
    recorder.handle(event('follow', { viewer: viewer('3') }));
    recorder.handle(event('follow', { viewer: viewer('3') }));
    recorder.handle(event('viewers', { count: 55, roomTotal: 300 }));
    // テスト（テスト用の配信に入る）
    recorder.handle(event('gift', { isTest: true, viewer: viewer('test-a'), streakTotal: 99, count: 99, coinsEach: 99 }));
    recorder.flush();
    const live = row<{ id: number }>(db, 'SELECT id FROM streams WHERE is_test = 0');
    recorder.recomputeTotals(live.id);
    const s = row(
      db,
      'SELECT visitor_count, gift_count, coin_total, like_count, comment_count, follow_count, max_viewers, tiktok_total_viewers FROM streams WHERE id = ?',
      live.id,
    );
    expect(s).toEqual({
      visitor_count: 3,
      gift_count: 11,
      coin_total: 110,
      like_count: 30,
      comment_count: 1,
      follow_count: 1,
      max_viewers: 55,
      tiktok_total_viewers: 300,
    });
    const test = row<{ is_test: number; room_id: string }>(db, 'SELECT is_test, room_id FROM streams WHERE is_test = 1');
    expect(test.room_id).toMatch(/^test-\d{4}-\d{2}-\d{2}$/);
    expect(row(db, 'SELECT is_test FROM gifts WHERE viewer_id = ?', 'test-a')).toEqual({ is_test: 1 });
  });

  it('配信の情報がない時のイベントは記録しない（落ちない）', () => {
    const { db, recorder } = setup();
    recorder.handle(event('comment'));
    recorder.flush();
    expect(row(db, 'SELECT COUNT(*) AS n FROM comments')).toEqual({ n: 0 });
  });

  it('ルールの発動を記録する（要件 D-5）', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.recordRuleRun({
      at: new Date().toISOString(),
      isTest: false,
      ruleId: 'r1',
      ruleName: 'バラで花火',
      triggerKind: 'gift',
      triggerViewer: viewer('5'),
      triggerDetail: 'Rose ×1',
      actions: ['overlay', 'minecraft'],
      result: 'partial',
      message: 'minecraft: つながっていません',
    });
    recorder.flush();
    expect(row(db, 'SELECT rule_name, trigger_viewer_id, actions, result FROM rule_runs')).toEqual({
      rule_name: 'バラで花火',
      trigger_viewer_id: '5',
      actions: 'overlay,minecraft',
      result: 'partial',
    });
  });

  it('特定の視聴者のデータを削除できる（要件 N-9）', () => {
    const { db, recorder } = setup();
    recorder.streamConnected({ roomId: 'R1', startedAtMs: null, title: null });
    recorder.handle(event('gift', { viewer: viewer('9'), streakTotal: 3, count: 3, coinsEach: 10 }));
    recorder.handle(event('comment', { viewer: viewer('9') }));
    recorder.handle(event('comment', { viewer: viewer('8') }));
    recorder.flush();
    const result = recorder.deleteViewer('9');
    expect(result.deleted).toBe(true);
    expect(row(db, 'SELECT COUNT(*) AS n FROM viewers WHERE viewer_id = ?', '9')).toEqual({ n: 0 });
    expect(row(db, 'SELECT COUNT(*) AS n FROM gifts')).toEqual({ n: 0 });
    expect(row(db, 'SELECT COUNT(*) AS n FROM comments')).toEqual({ n: 1 });
    expect(row(db, 'SELECT coin_total, visitor_count FROM streams')).toEqual({ coin_total: 0, visitor_count: 1 });
  });

  it('処理済みのメッセージIDを覚えておき、再起動後に読み出せる', () => {
    const { recorder } = setup();
    recorder.rememberMessage('abc', new Date().toISOString());
    recorder.flush();
    expect(recorder.recentMessageIds(Date.now() - 60_000)).toContain('abc');
  });
});
