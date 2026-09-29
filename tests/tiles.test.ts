// イベント一覧のタイル（要件 O-10）のテスト
import { describe, expect, it } from 'vitest';
import { buildTiles, imageUrlOf } from '../src/server/actions/tiles.ts';
import { activeSet } from '../src/server/config/rules.ts';
import { normalizeSettings } from '../src/server/config/settings.ts';
import type { GiftCatalogRow } from '../src/server/db/queries.ts';

/** ルールをいくつか持つ設定から、ルールの配列を作る */
function rules(list: Array<Record<string, unknown>>) {
  const settings = normalizeSettings({
    rules: { activeSetId: 's', sets: [{ id: 's', name: 'テスト', rules: list }] },
  });
  return activeSet(settings.rules)!.rules;
}

const catalog: GiftCatalogRow[] = [
  { gift_id: '5655', name: 'Rose', display_name: 'バラ', coins: 1, image_url: 'https://例/rose.png', streakable: 1 },
  { gift_id: '6247', name: 'Finger Heart', display_name: null, coins: 5, image_url: null, streakable: 0 },
];

describe('画像の指定', () => {
  it('URLはそのまま、それ以外は media フォルダのファイルとして扱う', () => {
    expect(imageUrlOf('https://例/a.png')).toBe('https://例/a.png');
    expect(imageUrlOf('/media/a.png')).toBe('/media/a.png');
    expect(imageUrlOf('ゾンビ.png')).toBe('/media/%E3%82%BE%E3%83%B3%E3%83%93.png');
    expect(imageUrlOf('   ')).toBe(null);
    expect(imageUrlOf('')).toBe(null);
  });
});

describe('タイルを作る', () => {
  it('無効なルールと、出さないルールは出さない', () => {
    const tiles = buildTiles(
      rules([
        { id: 'a', name: '出る' },
        { id: 'b', name: '無効', enabled: false },
        { id: 'c', name: '出さない', tileVisible: false },
      ]),
      catalog,
    );
    expect(tiles.map((t) => t.name)).toEqual(['出る']);
  });

  it('並び順で並べ、同じならルールの並びのまま', () => {
    const tiles = buildTiles(
      rules([
        { id: 'a', name: 'A', tileOrder: 0 },
        { id: 'b', name: 'B', tileOrder: -5 },
        { id: 'c', name: 'C', tileOrder: 0 },
        { id: 'd', name: 'D', tileOrder: 10 },
      ]),
      catalog,
    );
    expect(tiles.map((t) => t.name)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('ギフトのきっかけには、絵とコイン数が付く（表示名があればそちら）', () => {
    const tiles = buildTiles(
      rules([{ id: 'a', name: 'バラの反応', trigger: { kind: 'gift', giftIds: ['5655', '6247'] } }]),
      catalog,
    );
    expect(tiles[0].gifts).toEqual([
      { name: 'バラ', image: 'https://例/rose.png', coins: 1 },
      { name: 'Finger Heart', image: null, coins: 5 },
    ]);
  });

  it('一覧にないギフトIDでも、IDのまま出す（落ちない）', () => {
    const tiles = buildTiles(rules([{ id: 'a', trigger: { kind: 'gift', giftIds: ['9999'] } }]), catalog);
    expect(tiles[0].gifts).toEqual([{ name: '9999', image: null, coins: 0 }]);
  });

  it('きっかけの説明が、種類ごとに変わる', () => {
    const tiles = buildTiles(
      rules([
        { id: 'a', trigger: { kind: 'gift', giftIds: [] } },
        { id: 'b', trigger: { kind: 'giftCoins', minCoins: 500 } },
        { id: 'c', trigger: { kind: 'like', likeEvery: 250 } },
        { id: 'd', trigger: { kind: 'follow' } },
        { id: 'e', trigger: { kind: 'comment', keywords: ['おはよう', 'こんばんは'] } },
      ]),
      catalog,
    );
    expect(tiles.map((t) => t.triggerLabel)).toEqual([
      'どのギフトでも',
      '500コイン以上',
      'いいね250回ごと',
      'フォロー',
      'コメント：おはよう・こんばんは',
    ]);
    expect(tiles[1].minCoins).toBe(500);
    expect(tiles[0].minCoins).toBe(null);
  });

  it('Minecraftのくり返し回数が2以上なら出す', () => {
    const tiles = buildTiles(
      rules([
        { id: 'a', actions: [{ type: 'minecraft', command: 'say hi', repeat: 5 }] },
        { id: 'b', actions: [{ type: 'minecraft', command: 'say hi', repeat: 1 }] },
        { id: 'c', actions: [{ type: 'alert' }] },
      ]),
      catalog,
    );
    expect(tiles.map((t) => t.repeat)).toEqual([5, null, null]);
  });

  it('タイルの色と画像を渡す', () => {
    const tiles = buildTiles(rules([{ id: 'a', tileColor: '#ff0000', imageUrl: '絵.png' }]), catalog);
    expect(tiles[0].color).toBe('#ff0000');
    expect(tiles[0].image).toBe('/media/%E7%B5%B5.png');
  });
});
