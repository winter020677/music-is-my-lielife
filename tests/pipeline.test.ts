// TikTokのデータを本体のイベントにするまで（normalize と pipeline）のテスト
// ここで使うデータは、tiktok-live-connector（v2）が渡してくる形をまねたもの。
import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../src/server/core/events.ts';
import { DailyCounters } from '../src/server/db/counters.ts';
import { Recorder } from '../src/server/db/recorder.ts';
import { normalize, viewerFrom } from '../src/server/tiktok/normalize.ts';
import { EventPipeline } from '../src/server/tiktok/pipeline.ts';
import { log, memoryDb, row } from './helpers.ts';

const NOW = Date.parse('2026-09-29T10:00:00Z');

function user(id: string, nickname = 'たろう') {
  return {
    id,
    idStr: id,
    displayId: `taro_${id}`,
    nickname,
    avatarThumb: { urlList: ['https://p16.example/img~tplv-100x100.webp', 'https://p16.example/img.jpeg'] },
    followInfo: { followStatus: '1' },
  };
}

function common(msgId: string, createdMs = NOW) {
  return { msgId, createTime: String(createdMs), roomId: 'R1' };
}

function giftMsg(msgId: string, repeatCount: number, repeatEnd: number, extra: Record<string, unknown> = {}) {
  return {
    common: common(msgId),
    user: user('111'),
    giftId: '5655',
    groupId: '1700000000123',
    repeatCount,
    repeatEnd,
    gift: { id: '5655', name: 'Rose', diamondCount: 1, type: 1, image: { urlList: ['https://p16.example/rose.png'] } },
    ...extra,
  };
}

describe('TikTokのデータの形をそろえる', () => {
  it('視聴者：数字のID・ユーザー名・表示名・アイコン・フォロー状態', () => {
    expect(viewerFrom(user('123'))).toEqual({
      id: '123',
      uniqueId: 'taro_123',
      nickname: 'たろう',
      avatarUrl: 'https://p16.example/img~tplv-100x100.webp',
      followStatus: 1,
    });
    expect(viewerFrom({ nickname: 'IDなし' })).toBeNull();
  });

  it('名前の改行や見えない文字は取り除く', () => {
    expect(viewerFrom(user('1', 'あ\nい​う'))?.nickname).toBe('あ い う');
  });

  it('コメント・いいね・入室・視聴者数', () => {
    const opts = { nowMs: NOW, initialBatch: false, lateMs: 60_000 };
    const chat = normalize('chat', { common: common('c1'), user: user('1'), content: 'こんにちは' }, opts);
    expect(chat).toMatchObject({ type: 'event', event: { kind: 'comment', text: 'こんにちは', msgId: 'c1' } });
    const like = normalize('like', { common: common('l1'), user: user('1'), count: 15, total: '1234' }, opts);
    expect(like).toMatchObject({ type: 'event', event: { kind: 'like', count: 15, roomTotal: 1234 } });
    const join = normalize('member', { common: common('j1'), user: user('1'), action: 1 }, opts);
    expect(join).toMatchObject({ type: 'event', event: { kind: 'join' } });
    const notJoin = normalize('member', { common: common('j2'), user: user('1'), action: 3 }, opts);
    expect(notJoin.type).toBe('ignore');
    const viewers = normalize('roomUser', { common: common('v1'), total: '87', totalUser: '532' }, opts);
    expect(viewers).toMatchObject({ type: 'event', event: { kind: 'viewers', count: 87, roomTotal: 532 } });
  });

  it('時刻はTikTokの作成時刻（UTC）を使う', () => {
    const chat = normalize('chat', { common: common('c1', NOW - 5000), user: user('1'), content: 'x' }, {
      nowMs: NOW,
      initialBatch: false,
      lateMs: 60_000,
    });
    expect(chat.type === 'event' && chat.event.at).toBe(new Date(NOW - 5000).toISOString());
  });

  it('接続直後にまとめて届いた古いデータだけ「遅れて届いた」になる', () => {
    const old = { common: common('c1', NOW - 5 * 60_000), user: user('1'), content: 'x' };
    const initial = normalize('chat', old, { nowMs: NOW, initialBatch: true, lateMs: 60_000 });
    const live = normalize('chat', old, { nowMs: NOW, initialBatch: false, lateMs: 60_000 });
    expect(initial.type === 'event' && initial.event.late).toBe(true);
    expect(live.type === 'event' && live.event.late).toBe(false);
  });
});

describe('イベントの道筋（二重処理の防止・連打）', () => {
  function setup() {
    const db = memoryDb();
    const recorder = new Recorder(db, log, () => NOW);
    const emitted: LiveEvent[] = [];
    const pipeline = new EventPipeline({
      recorder,
      emit: (e) => {
        emitted.push(e);
        recorder.handle(e);
      },
      counters: new DailyCounters(db, () => NOW),
      log,
      getLateSec: () => 60,
      now: () => NOW,
    });
    pipeline.beginConnect({ roomId: 'R1', startedAtMs: null, title: null });
    pipeline.connected({ roomId: 'R1', startedAtMs: null, title: null });
    return { db, recorder, pipeline, emitted };
  }

  it('同じメッセージIDは1回しか処理しない（接続し直した時の再送対策）', () => {
    const { pipeline, emitted } = setup();
    const msg = { common: common('dup'), user: user('1'), content: 'x' };
    pipeline.handleRaw('chat', msg);
    pipeline.handleRaw('chat', msg);
    expect(emitted).toHaveLength(1);
  });

  it('バラ10連打：演出の合計はちょうど10、記録は1行・10個', () => {
    const { db, recorder, pipeline, emitted } = setup();
    for (let i = 1; i <= 10; i++) pipeline.handleRaw('gift', giftMsg(`g${i}`, i, 0));
    pipeline.handleRaw('gift', giftMsg('gend', 10, 1));
    const total = emitted.reduce((sum, e) => sum + (e.kind === 'gift' ? e.count : 0), 0);
    expect(total).toBe(10);
    recorder.flush();
    expect(row(db, 'SELECT count, coins, streak_ended FROM gifts')).toEqual({ count: 10, coins: 10, streak_ended: 1 });
    expect(row(db, 'SELECT name, coins, streakable FROM gift_catalog')).toEqual({ name: 'Rose', coins: 1, streakable: 1 });
  });

  it('本体を再起動しても、同じメッセージは二重に処理しない', () => {
    const first = setup();
    first.pipeline.handleRaw('chat', { common: common('persist'), user: user('1'), content: 'x' });
    first.recorder.flush();

    // 同じデータベースで作り直す（再起動のかわり）
    const recorder = new Recorder(first.db, log, () => NOW);
    const emitted: LiveEvent[] = [];
    const pipeline = new EventPipeline({
      recorder,
      emit: (e) => emitted.push(e),
      counters: new DailyCounters(first.db, () => NOW),
      log,
      getLateSec: () => 60,
      now: () => NOW,
    });
    pipeline.beginConnect({ roomId: 'R1', startedAtMs: null, title: null });
    pipeline.handleRaw('chat', { common: common('persist'), user: user('1'), content: 'x' });
    expect(emitted).toHaveLength(0);
  });

  it('配信終了の知らせで、記録を終わらせる', () => {
    const { db, pipeline } = setup();
    pipeline.handleRaw('chat', { common: common('c'), user: user('1'), content: 'x' });
    pipeline.streamEnded();
    expect(row<{ ended_at: string | null }>(db, 'SELECT ended_at FROM streams').ended_at).not.toBeNull();
  });
});
