// ルールの「きっかけ」と「やること」の種類と、その日本語名
//
// 本体（rules.ts）と管理画面の両方から使う。
// 管理画面のバンドルに zod が混ざらないよう、形の定義（rules.ts）とは分けている。

/** きっかけの種類（要件 R-1） */
export const TRIGGER_KINDS = ['gift', 'giftCoins', 'like', 'follow', 'share', 'subscribe', 'comment'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  gift: '特定のギフト',
  giftCoins: '◯コイン以上のギフト',
  like: 'いいね◯回ごと',
  follow: 'フォロー',
  share: 'シェア',
  subscribe: 'サブスク',
  comment: 'コメント（キーワード）',
};

/** やることの種類（要件 6.3。スピナー（A-5）はこの後で足す） */
export const ACTION_TYPES = ['alert', 'media', 'minecraft', 'speech'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  alert: 'アラートを出す',
  media: '動画・画像・音を出す',
  minecraft: 'Minecraftのコマンド',
  speech: '読み上げ',
};

/** 置き換え記号の早見表（管理画面の説明用。要件 A-3） */
export const TEMPLATE_HINTS = [
  '{nickname}',
  '{giftname}',
  '{giftcount}',
  '{coins}',
  '{comment}',
  '{playername}',
  '{index}',
  '{repetition}',
  '{random:X Y}',
  '{mult:X Y}',
  '{plus:X Y}',
] as const;
