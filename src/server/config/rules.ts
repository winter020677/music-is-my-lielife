// ルール（要件 6.2・6.3）
//
// 「きっかけ」→「やること」の組を、利用者が自由に作れるようにする仕組みの、形の定義。
// 実際に動かすのは src/server/rules/engine.ts。
//
//  ・R-1 きっかけ：特定のギフト／◯コイン以上のギフト／いいね◯回ごと／フォロー／シェア／サブスク／コメント
//  ・R-2 1つのきっかけに複数のやることを割り当てられる
//  ・R-3 ルールごとに名前・画像・有効/無効・クールダウン（全体／人ごと）
//  ・R-4 ギフトはIDで指定し、表示名（日本語名）は giftNames で自分で決められる
//  ・R-5 ギフトの個数分くり返すか
//  ・R-6 同じ人のフォローは、1回の配信で1回だけ（engine.ts 側で見る）
//  ・R-7 セットを複数作れて、切り替えられる
//
// 壊れた値の扱いは設定ファイル全体と同じ考え方：
// 項目1つがおかしくても、その項目だけ初期値に戻して、他は残す。
// ただし id のない項目は、どのルールか分からないので、その項目ごと捨てる。

import { z } from 'zod';
import { ACTION_TYPES, TRIGGER_KINDS } from './ruleLabels.ts';

export { ACTION_LABELS, ACTION_TYPES, TRIGGER_KINDS, TRIGGER_LABELS } from './ruleLabels.ts';
export type { ActionType, TriggerKind } from './ruleLabels.ts';

const str = (def: string, max = 2000) => z.string().max(max).catch(def);
const flag = (def: boolean) => z.boolean().catch(def);
const int = (def: number, min: number, max: number) => z.number().int().min(min).max(max).catch(def);
const decimal = (def: number, min: number, max: number) => z.number().min(min).max(max).catch(def);

/** 配列。中の1つが読めなくても、その項目だけ捨てて残りは生かす */
function listOf<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((entry) => item.safeParse(entry).success).slice(0, max) : []),
    z.array(item),
  );
}

export const triggerSchema = z.object({
  kind: z.enum(TRIGGER_KINDS).catch('gift'),
  /** kind が gift の時：反応するギフトのID。空なら、どのギフトでも反応する */
  giftIds: listOf(z.string().min(1).max(60), 200),
  /** kind が giftCoins の時：このコイン数以上で反応する（1個あたり × 個数） */
  minCoins: int(1, 1, 1_000_000),
  /** kind が like の時：いいねが何回たまるごとに1回反応するか */
  likeEvery: int(100, 1, 1_000_000),
  /** kind が comment の時：反応する言葉。空なら、どのコメントでも反応する */
  keywords: listOf(z.string().min(1).max(100), 100),
});
export type Trigger = z.infer<typeof triggerSchema>;

export const actionSchema = z.object({
  type: z.enum(ACTION_TYPES).catch('alert'),
  /** 順番待ちを追い越して、最優先で出す（要件 A-6） */
  priority: flag(false),

  /** alert：オーバーレイに出す文字（置き換え記号が使える） */
  alertTitle: str('{nickname}', 200),
  alertMessage: str('{giftname} ×{giftcount}', 200),

  /** media：出すファイルの名前（media フォルダの中。要件 A-1） */
  mediaFile: str('', 200),
  /** media：画面の左からの位置（％。真ん中が50） */
  mediaX: decimal(50, 0, 100),
  /** media：画面の上からの位置（％。真ん中が50） */
  mediaY: decimal(50, 0, 100),
  /** media：大きさ（画面の幅に対する％） */
  mediaWidth: decimal(40, 1, 100),
  /** media：音量（0〜1） */
  mediaVolume: decimal(0.8, 0, 1),
  /** media：表示する秒数。0なら、動画と音は最後まで／画像は5秒 */
  mediaDurationSec: decimal(0, 0, 600),

  /** minecraft：送るコマンド。複数行書ける（要件 A-2） */
  command: str('', 5000),
  /** minecraft：くり返し回数。{repetition} に入る値でもある */
  repeat: int(1, 1, 1000),
  /** minecraft：きっかけから送り始めるまでの待ち時間（秒） */
  delaySec: decimal(0, 0, 600),
  /** minecraft：くり返しの間隔（秒） */
  intervalSec: decimal(0, 0, 600),

  /** speech：読み上げる文（置き換え記号が使える） */
  text: str('', 500),
});
export type RuleAction = z.infer<typeof actionSchema>;

/** スピナーの項目1つ（要件 S-1・S-2） */
export const spinnerItemSchema = z.object({
  id: z.string().min(1).max(60),
  name: str('新しい項目', 60),
  /** media フォルダの画像ファイル名（空なら色だけで出す） */
  image: str('', 200),
  /** 色（#rrggbb） */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#4a7cf7'),
  /** 当たりやすさ。大きいほど当たりやすい */
  weight: decimal(1, 0, 10_000),
  /** レア度（1〜5）。オーバーレイの見せ方が変わる */
  rarity: int(1, 1, 5),
  /** 当たった時にすること（要件 S-2） */
  actions: listOf(actionSchema, 20),
});
export type SpinnerItem = z.infer<typeof spinnerItemSchema>;

export const spinnerShape = {
  enabled: flag(false),
  name: str('スピナー', 60),
  /** 回っている時間（秒） */
  spinSec: decimal(4, 0.5, 60),
  /** 当たりを見せておく時間（秒） */
  resultSec: decimal(3, 0.5, 60),
  items: listOf(spinnerItemSchema, 100),
};

/** 当たりやすさ（重み）に従って1つ選ぶ（要件 S-1） */
export function pickSpinnerItem(items: SpinnerItem[], random: () => number = Math.random): SpinnerItem | null {
  const usable = items.filter((item) => item.weight > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  let point = random() * total;
  for (const item of usable) {
    point -= item.weight;
    if (point < 0) return item;
  }
  // 小数の誤差で最後まで残った時のため
  return usable[usable.length - 1];
}

export const ruleSchema = z.object({
  /** ルールを見分けるID。これがない項目は読み込みのときに捨てる */
  id: z.string().min(1).max(60),
  name: str('新しいルール', 100),
  enabled: flag(true),
  /**
   * ルールの画像（要件 R-3）。イベント一覧のタイルにも出す（要件 O-10）。
   * media フォルダのファイル名か、http... / で始まるURL。
   */
  imageUrl: str('', 500),
  /** イベント一覧のタイルに出すか（要件 O-10） */
  tileVisible: flag(true),
  /** タイル全体の背景色（空なら style.css のまま）（要件 O-10） */
  tileColor: str('', 40),
  /** タイルの並び順。小さいほど先。同じなら、このリストの順（要件 O-10） */
  tileOrder: int(0, -9999, 9999),
  trigger: z.preprocess((v) => (isPlainObject(v) ? v : {}), triggerSchema),
  /** ギフトの個数の分だけ、やることをくり返す（例：バラ5個 → 5回）（要件 R-5） */
  repeatPerCount: flag(false),
  /** 1回動いたら、次に動けるまでの秒数（全体）（要件 R-3） */
  cooldownSec: decimal(0, 0, 86400),
  /** 同じ人に対して、次に動けるまでの秒数（要件 R-3） */
  perViewerCooldownSec: decimal(0, 0, 86400),
  actions: listOf(actionSchema, 20),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetSchema = z.object({
  id: z.string().min(1).max(60),
  name: str('セット', 100),
  rules: listOf(ruleSchema, 500),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ギフトの表示名（要件 R-4）は、設定ではなくデータベースの gift_catalog.display_name に持つ。
// ギフトの名前・アイコン・コイン数と同じ場所にまとまっていた方が探しやすいため。

/**
 * オーバーレイの見た目（要件 O-6）。
 *
 * それぞれの style.css には、読んで分かるように値を直接書いてある（要件 O-7）。
 * ここで決めた値は、その上から重ねる形で効かせる（overlay-client.js が style を足す）。
 * 何も変えていなければ、style.css に書いてある値のまま。
 */
export const overlayLookShape = {
  /** 全体の大きさ（％）。100 がそのまま */
  scale: decimal(100, 10, 400),
  /** 文字の大きさ（％）。100 がそのまま */
  fontScale: decimal(100, 10, 400),
  /** 余白（px）。-1 なら style.css のまま */
  padding: decimal(-1, -1, 200),
  /** 文字の色。空なら style.css のまま */
  textColor: str('', 40),
  /** 箱の背景の色。空なら style.css のまま */
  backgroundColor: str('', 40),
  /** ふちや目立たせる色。空なら style.css のまま */
  accentColor: str('', 40),
  /** 何列に並べるか（イベント一覧用）。0 なら style.css のまま */
  columns: int(0, 0, 24),
  /** 自分で足すCSS（要件 O-6） */
  extraCss: str('', 10_000),
};

export const overlaysShape = z.preprocess(
  (v) => (isPlainObject(v) ? v : {}),
  z.record(z.string().max(40), z.object(overlayLookShape)),
);

export type OverlayLook = z.infer<z.ZodObject<typeof overlayLookShape>>;

/** 何も決めていない時の見た目 */
export function defaultOverlayLook(): OverlayLook {
  return z.object(overlayLookShape).parse({});
}

export const rulesShape = {
  /** 今使っているセットのID（要件 R-7） */
  activeSetId: str('', 60),
  sets: listOf(ruleSetSchema, 50),
};

export type RulesConfig = z.infer<z.ZodObject<typeof rulesShape>>;

/** 今使うセットを返す。指定のIDがなければ最初のセット */
export function activeSet(config: RulesConfig): RuleSet | null {
  if (config.sets.length === 0) return null;
  return config.sets.find((set) => set.id === config.activeSetId) ?? config.sets[0];
}

/** 新しいIDを作る（ルール・セット・やること共通） */
export function newId(prefix: string, random: () => number = Math.random): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
}
