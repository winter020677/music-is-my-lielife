// 視聴者の文字の無害化（要件 N-4）のテスト
import { describe, expect, it } from 'vitest';
import { cleanText, forDisplay, forMinecraft, forSpeech, truncate } from '../src/server/core/sanitize.ts';

describe('無害化', () => {
  it('改行・制御文字・見えない文字を消す', () => {
    expect(cleanText('a\nb\r\nc\td\u0000e\u200bf\u202eg', 100)).toBe('a b c d e f g');
  });

  it('長すぎる文字を切る（絵文字を途中で割らない）', () => {
    expect(truncate('あいうえお', 3)).toBe('あいう');
    expect(truncate('👍🏽👍🏽👍🏽', 2)).toBe('👍🏽👍🏽');
    expect(cleanText('あいうえお', 3, '…')).toBe('あいう…');
  });

  it('null や数字も扱える', () => {
    expect(cleanText(null, 10)).toBe('');
    expect(cleanText(undefined, 10)).toBe('');
    expect(cleanText(123, 10)).toBe('123');
  });

  it('Minecraft用：引用符・バックスラッシュ・色コードを消し、@ を全角にする', () => {
    expect(forMinecraft('Evil"} \\n\'§c@e[type=player]', 100)).toBe('Evil} nc＠e[type=player]');
  });

  it('Minecraft用：改行でコマンドを分けられない', () => {
    expect(forMinecraft('a\nop someone')).toBe('a op someone');
  });

  it('読み上げ用：URLと、同じ文字のくり返しを短くする', () => {
    expect(forSpeech('見て https://example.com/abc すごいwwwwwwwwww', 100)).toBe('見て URL すごいwwww');
  });

  it('表示用：長い名前は … で切る', () => {
    expect(forDisplay('あ'.repeat(50), 5)).toBe('あああああ…');
  });
});
