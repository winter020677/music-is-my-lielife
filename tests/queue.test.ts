// 順番待ち（要件 6.4）のテスト
import { describe, expect, it } from 'vitest';
import { ActionQueue, sleep } from '../src/server/core/queue.ts';
import { log } from './helpers.ts';

function makeQueue(runMs = 0, minIntervalMs = 0) {
  const done: string[] = [];
  const queue = new ActionQueue<string>({
    name: 'test',
    label: 'テスト',
    log,
    minIntervalMs: () => minIntervalMs,
    run: async (item, signal) => {
      if (runMs > 0) await sleep(runMs, signal);
      if (!signal.aborted) done.push(item);
    },
  });
  return { queue, done };
}

async function until(check: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('時間切れ');
    await sleep(5);
  }
}

describe('順番待ち', () => {
  it('入れた順に1つずつ処理する', async () => {
    const { queue, done } = makeQueue(5);
    for (const x of ['a', 'b', 'c']) queue.push(x, x);
    await until(() => done.length === 3);
    expect(done).toEqual(['a', 'b', 'c']);
  });

  it('割り込みは先頭に入る（要件 A-6）', async () => {
    const { queue, done } = makeQueue(20);
    queue.push('a', 'a');
    queue.push('b', 'b');
    queue.push('急ぎ', '急ぎ', { priority: true });
    await until(() => done.length === 3);
    expect(done).toEqual(['a', '急ぎ', 'b']);
  });

  it('一時停止・再開（要件 Q-2）', async () => {
    const { queue, done } = makeQueue();
    queue.pause();
    queue.push('a', 'a');
    await sleep(30);
    expect(done).toEqual([]);
    expect(queue.snapshot()).toMatchObject({ paused: true, pending: 1 });
    queue.resume();
    await until(() => done.length === 1);
  });

  it('スキップで今のものを止めて次へ', async () => {
    const { queue, done } = makeQueue(500);
    let skippedError: unknown = null;
    queue.push('長い', '長い', { onDone: (e) => (skippedError = e) });
    queue.push('次', '次');
    await sleep(20);
    queue.skip();
    await until(() => done.includes('次'));
    expect(done).toEqual(['次']);
    expect(String(skippedError)).toMatch(/スキップ/);
  });

  it('全消去', async () => {
    const { queue, done } = makeQueue(50);
    for (const x of ['a', 'b', 'c']) queue.push(x, x);
    await sleep(10);
    queue.clear();
    await sleep(100);
    expect(done).toEqual([]);
    expect(queue.snapshot().pending).toBe(0);
  });

  it('次を始めるまでの最短の間隔を守る（要件 Q-3）', async () => {
    const { queue, done } = makeQueue(0, 40);
    const start = Date.now();
    for (const x of ['a', 'b', 'c', 'd']) queue.push(x, x);
    await until(() => done.length === 4);
    expect(Date.now() - start).toBeGreaterThanOrEqual(115);
  });

  it('エラーが起きても、次へ進む', async () => {
    const done: string[] = [];
    const queue = new ActionQueue<string>({
      name: 't',
      label: 't',
      log,
      run: async (x) => {
        if (x === 'bad') throw new Error('だめ');
        done.push(x);
      },
    });
    let error: unknown = null;
    queue.push('bad', 'bad', { onDone: (e) => (error = e) });
    queue.push('good', 'good');
    await until(() => done.length === 1);
    expect(String(error)).toMatch(/だめ/);
  });
});
