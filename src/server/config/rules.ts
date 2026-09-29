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

export const ruleSchema = z.object({
  /** ルールを見分けるID。これがない項目は読み込みのときに捨てる */
  id: z.string().min(1).max(60),
  name: str('新しいルール', 100),
  enabled: flag(true),
  /** 管理画面でルールを見分けるための画像（要件 R-3） */
  imageUrl: str('', 500),
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
