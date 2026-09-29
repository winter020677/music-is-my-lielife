// 置き換え記号（要件 A-3）のテスト
import { describe, expect, it } from 'vitest';
import { renderTemplate, splitLines } from '../src/server/core/template.ts';

/** 決まった順に値を返す、にせのランダム */
function fixedRandom(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('置き換え記号', () => {
  it('基本の記号を置き換える', () => {
    const out = renderTemplate('{nickname}さん、{giftname}×{giftcount}（{coins}コイン）ありがとう', {
      nickname: 'たろう',
      giftname: 'バラ',
      giftcount: 5,
      coins: 1,
    });
    expect(out).toBe('たろうさん、バラ×5（1コイン）ありがとう');
  });

  it('要件の確認例：プレイヤーの周り±3にゾンビ', () => {
    const cmd = 'execute at {playername} run summon zombie ~{random:-3 3} ~ ~{random:-3 3}';
    // random() が 0 → 最小値 -3、0.9999 → 最大値 3
    expect(renderTemplate(cmd, { playername: 'Steve' }, fixedRandom(0, 0.9999))).toBe(
      'execute at Steve run summon zombie ~-3 ~ ~3',
    );
    for (let i = 0; i < 200; i++) {
      const out = renderTemplate(cmd, { playername: 'Steve' });
      const m = /~(-?\d+) ~ ~(-?\d+)$/.exec(out);
      expect(m).not.toBeNull();
      const [x, z] = [Number(m![1]), Number(m![2])];
      expect(x).toBeGreaterThanOrEqual(-3);
      expect(x).toBeLessThanOrEqual(3);
      expect(z).toBeGreaterThanOrEqual(-3);
      expect(z).toBeLessThanOrEqual(3);
    }
  });

  it('{random:N X Y} は N にランダムを足す', () => {
    expect(renderTemplate('{random:10 1 3}', {}, fixedRandom(0))).toBe('11');
    expect(renderTemplate('{random:10 1 3}', {}, fixedRandom(0.9999))).toBe('13');
  });

  it('X と Y が逆でも動く', () => {
    expect(renderTemplate('{random:5 1}', {}, fixedRandom(0))).toBe('1');
  });

  it('{mult:X Y} と {plus:X Y}', () => {
    expect(renderTemplate('{mult:3 4}', {})).toBe('12');
    expect(renderTemplate('{plus:3 4}', {})).toBe('7');
    expect(renderTemplate('{mult:0.1 3}', {})).toBe('0.3');
    expect(renderTemplate('{plus:-2 5}', {})).toBe('3');
  });

  it('関数の中に記号を入れられる', () => {
    expect(renderTemplate('give {playername} diamond {mult:{giftcount} 10}', { playername: 'Steve', giftcount: 3 })).toBe(
      'give Steve diamond 30',
    );
  });

  it('Minecraftの波かっこ（NBTやJSON）はそのまま残す', () => {
    const cmd = `summon zombie ~ ~ ~ {CustomName:'"{nickname}"',Health:{plus:10 5}f}`;
    expect(renderTemplate(cmd, { nickname: 'Taro' })).toBe(`summon zombie ~ ~ ~ {CustomName:'"Taro"',Health:15f}`);
    expect(renderTemplate('tellraw @a {"text":"{nickname}","color":"gold"}', { nickname: 'Hana' })).toBe(
      'tellraw @a {"text":"Hana","color":"gold"}',
    );
  });

  it('知らない記号や、閉じていない記号はそのまま残す', () => {
    expect(renderTemplate('{unknown} {random:1 2', {})).toBe('{unknown} {random:1 2');
  });

  it('数字でない値の計算は置き換えずに残す（テストで気づけるように）', () => {
    expect(renderTemplate('{mult:{nickname} 2}', { nickname: 'abc' })).toBe('{mult:abc 2}');
  });

  it('視聴者の名前に書かれた記号は、読み直さない', () => {
    const out = renderTemplate('say {nickname}', { nickname: '{random:1 100}{playername}' });
    expect(out).toBe('say {random:1 100}{playername}');
  });

  it('値がない記号は空になる', () => {
    expect(renderTemplate('[{comment}]', {})).toBe('[]');
  });

  it('複数行は1行ずつに分け、空行は捨てる', () => {
    expect(splitLines('say a\n\n  say b  \r\n')).toEqual(['say a', 'say b']);
  });
});
