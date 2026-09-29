// イベント一覧のタイル（要件 O-10）
//
// 「どのギフトを送ると何が起きるか」を、視聴者に見せるための一覧。
// STEのタイル表示の後継で、今のセットのルールから自動で作る。
//
// ・ルールごとに1枚のタイル。「タイルに出す」を外したルールは出さない
// ・きっかけがギフトなら、ギフトの絵とコイン数を出す
// ・並び順はルールの「並び順」→ ルールの並びの順

import type { Rule } from '../config/rules.ts';
import type { GiftCatalogRow } from '../db/queries.ts';
import { TRIGGER_LABELS } from '../config/ruleLabels.ts';

export interface TileGift {
  name: string;
  image: string | null;
  coins: number;
}

export interface Tile {
  id: string;
  name: string;
  /** ルールの画像（タイルの大きい絵） */
  image: string | null;
  /** タイル全体の背景色（空なら、オーバーレイの style.css のまま） */
  color: string;
  /** きっかけの説明（「いいね100回ごと」「フォロー」など） */
  triggerLabel: string;
  /** きっかけがギフトの時、そのギフトたち（絵とコイン数） */
  gifts: TileGift[];
  /** 何コイン以上か（◯コイン以上のギフトの時だけ） */
  minCoins: number | null;
  /** くり返し回数（Minecraftのコマンドに指定があれば） */
  repeat: number | null;
}

/**
 * 画像の指定を、オーバーレイから読めるURLにする。
 * http... や / で始まるものはそのまま、それ以外は media フォルダのファイル名として扱う。
 */
export function imageUrlOf(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || text.startsWith('/')) return text;
  return `/media/${encodeURIComponent(text)}`;
}

/** きっかけの説明を作る */
function triggerLabelOf(rule: Rule): string {
  const t = rule.trigger;
  switch (t.kind) {
    case 'gift':
      return t.giftIds.length === 0 ? 'どのギフトでも' : 'ギフト';
    case 'giftCoins':
      return `${t.minCoins}コイン以上`;
    case 'like':
      return `いいね${t.likeEvery}回ごと`;
    case 'comment':
      return t.keywords.length === 0 ? 'コメント' : `コメント：${t.keywords.slice(0, 3).join('・')}`;
    default:
      return TRIGGER_LABELS[t.kind];
  }
}

/** 今のセットのルールから、タイルの一覧を作る */
export function buildTiles(rules: Rule[], catalog: GiftCatalogRow[]): Tile[] {
  const byGiftId = new Map(catalog.map((gift) => [gift.gift_id, gift]));

  return rules
    .filter((rule) => rule.enabled && rule.tileVisible)
    .map((rule, index) => ({ rule, index }))
    // 並び順が同じものは、ルールの並びの順のまま（安定させるため index も見る）
    .sort((a, b) => a.rule.tileOrder - b.rule.tileOrder || a.index - b.index)
    .map(({ rule }) => {
      const gifts: TileGift[] =
        rule.trigger.kind === 'gift'
          ? rule.trigger.giftIds.map((id) => {
              const known = byGiftId.get(id);
              return {
                name: known?.display_name || known?.name || id,
                image: known?.image_url ?? null,
                coins: known?.coins ?? 0,
              };
            })
          : [];

      // Minecraftのコマンドに「くり返し回数」があれば、いちばん大きいものを出す
      const repeats = rule.actions.filter((a) => a.type === 'minecraft').map((a) => a.repeat);
      const repeat = repeats.length > 0 ? Math.max(...repeats) : 1;

      return {
        id: rule.id,
        name: rule.name,
        image: imageUrlOf(rule.imageUrl),
        color: rule.tileColor,
        triggerLabel: triggerLabelOf(rule),
        gifts,
        minCoins: rule.trigger.kind === 'giftCoins' ? rule.trigger.minCoins : null,
        repeat: repeat > 1 ? repeat : null,
      };
    });
}
