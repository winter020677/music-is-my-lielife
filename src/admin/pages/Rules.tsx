// ルールの画面（要件 6.2・6.3）
//
// 「きっかけ（何が起きたら）」→「やること（何をする）」の組を作る画面。
// 「保存」を押すまで本体には送らない（設定の画面と同じ）。

import { useEffect, useMemo, useState } from 'react';
import { api, type AppState, type Settings } from '../api.ts';
import { ActionButton, Card, Field } from '../components/ui.tsx';
import {
  ActionEditor,
  MediaLibraryCard,
  NumberInput,
  emptyAction,
  loadMedia,
  newId,
  type MediaFileRow,
} from '../components/actions.tsx';
import {
  ACTION_LABELS,
  ACTION_TYPES,
  TEMPLATE_HINTS,
  TRIGGER_KINDS,
  TRIGGER_LABELS,
  type TriggerKind,
} from '../../server/config/ruleLabels.ts';

type RulesConfig = Settings['rules'];
type RuleSet = RulesConfig['sets'][number];
type Rule = RuleSet['rules'][number];

export interface GiftRow {
  gift_id: string;
  name: string;
  display_name: string | null;
  coins: number;
  image_url: string | null;
  streakable: number | null;
}

function emptyRule(): Rule {
  return {
    id: newId('rule'),
    name: '新しいルール',
    enabled: true,
    imageUrl: '',
    tileVisible: true,
    tileColor: '',
    tileOrder: 0,
    trigger: { kind: 'gift', giftIds: [], minCoins: 1, likeEvery: 100, keywords: [] },
    repeatPerCount: false,
    cooldownSec: 0,
    perViewerCooldownSec: 0,
    actions: [emptyAction('alert')],
  };
}

export function RulesPage({ state }: { state: AppState }) {
  const [draft, setDraft] = useState<RulesConfig>(state.settings.rules);
  const [saved, setSaved] = useState<string | null>(null);
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [media, setMedia] = useState<MediaFileRow[]>([]);
  const [mediaFolder, setMediaFolder] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings.rules);

  // 保存していない変更がなければ、本体の設定に合わせる
  useEffect(() => {
    if (!dirty) setDraft(state.settings.rules);
  }, [state.settings.rules]);

  useEffect(() => {
    void api<{ gifts: GiftRow[] }>('GET', '/api/gifts/catalog')
      .then((res) => setGifts(res.gifts))
      .catch(() => setGifts([]));
    void loadMedia().then((res) => {
      setMedia(res.files);
      setMediaFolder(res.folder);
    });
  }, []);

  const set = draft.sets.find((s) => s.id === draft.activeSetId) ?? draft.sets[0] ?? null;

  const change = (next: RulesConfig) => {
    setDraft(next);
    setSaved(null);
  };

  const updateSet = (fn: (s: RuleSet) => RuleSet) => {
    if (!set) return;
    change({ ...draft, sets: draft.sets.map((s) => (s.id === set.id ? fn(s) : s)) });
  };

  const updateRule = (ruleId: string, fn: (r: Rule) => Rule) => {
    updateSet((s) => ({ ...s, rules: s.rules.map((r) => (r.id === ruleId ? fn(r) : r)) }));
  };

  const save = async () => {
    const res = await api<{ settings: Settings }>('PUT', '/api/settings', { ...state.settings, rules: draft });
    setDraft(res.settings.rules);
    setSaved('保存しました');
  };

  return (
    <div className="page-stack rules">
      <div className="save-bar">
        <ActionButton kind="primary" onClick={save} disabled={!dirty}>
          保存
        </ActionButton>
        <ActionButton onClick={() => change(state.settings.rules)} disabled={!dirty}>
          元に戻す
        </ActionButton>
        {dirty ? (
          <span className="muted">保存していない変更があります</span>
        ) : (
          saved && <span className="ok-text">{saved}</span>
        )}
      </div>

      <SetBar draft={draft} set={set} onChange={change} />

      {!set ? (
        <Card title="セットがありません">
          <p className="muted">上の「新しいセット」を押すと、ルールを作れるようになります。</p>
        </Card>
      ) : set.rules.length === 0 ? (
        <Card title="ルールがありません">
          <p className="muted small">
            「きっかけ」（ギフトが来た・フォローされた など）と、「やること」（アラート・Minecraftのコマンド・読み上げ）を
            組み合わせて作ります。
          </p>
          <ActionButton kind="primary" onClick={() => updateSet((s) => ({ ...s, rules: [emptyRule()] }))}>
            最初のルールを作る
          </ActionButton>
        </Card>
      ) : (
        <>
          {set.rules.map((rule, i) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              gifts={gifts}
              media={media}
              saved={!dirty}
              position={i + 1}
              total={set.rules.length}
              onChange={(fn) => updateRule(rule.id, fn)}
              onMove={(delta) =>
                updateSet((s) => {
                  const rules = [...s.rules];
                  const to = i + delta;
                  if (to < 0 || to >= rules.length) return s;
                  [rules[i], rules[to]] = [rules[to], rules[i]];
                  return { ...s, rules };
                })
              }
              onDuplicate={() =>
                updateSet((s) => {
                  const copy = { ...rule, id: newId('rule'), name: `${rule.name}のコピー` };
                  const rules = [...s.rules];
                  rules.splice(i + 1, 0, copy);
                  return { ...s, rules };
                })
              }
              onDelete={() => updateSet((s) => ({ ...s, rules: s.rules.filter((r) => r.id !== rule.id) }))}
            />
          ))}
          <div className="button-row">
            <ActionButton kind="primary" onClick={() => updateSet((s) => ({ ...s, rules: [...s.rules, emptyRule()] }))}>
              ルールを追加
            </ActionButton>
          </div>
        </>
      )}

      <MediaLibraryCard files={media} folder={mediaFolder} onChange={setMedia} />

      <Card title="置き換え記号">
        <p className="muted small">
          コマンドや読み上げ文の中に書くと、実際の値に変わります。Minecraftのコマンドは、STEからそのままコピーして貼れます。
        </p>
        <p className="template-hints">
          {TEMPLATE_HINTS.map((hint) => (
            <code key={hint}>{hint}</code>
          ))}
        </p>
      </Card>
    </div>
  );
}

/** セットの選択と、作る・名前を変える・複製・消す（要件 R-7） */
function SetBar({
  draft,
  set,
  onChange,
}: {
  draft: RulesConfig;
  set: RuleSet | null;
  onChange: (next: RulesConfig) => void;
}) {
  return (
    <Card title="セット">
      <p className="muted small">
        ルールのまとまりです。配信の内容ごとに作っておくと、ここを選ぶだけで、使うルールをまとめて切り替えられます。
      </p>
      <div className="set-bar">
        <select
          value={set?.id ?? ''}
          disabled={draft.sets.length === 0}
          onChange={(e) => onChange({ ...draft, activeSetId: e.target.value })}
        >
          {draft.sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（ルール {s.rules.length} 個）
            </option>
          ))}
        </select>
        <ActionButton
          kind="small"
          onClick={() => {
            const id = newId('set');
            onChange({ ...draft, activeSetId: id, sets: [...draft.sets, { id, name: '新しいセット', rules: [] }] });
          }}
        >
          新しいセット
        </ActionButton>
        <ActionButton
          kind="small"
          disabled={!set}
          onClick={() => {
            if (!set) return;
            const name = window.prompt('セットの名前', set.name);
            if (name === null) return;
            onChange({ ...draft, sets: draft.sets.map((s) => (s.id === set.id ? { ...s, name: name.trim() || s.name } : s)) });
          }}
        >
          名前を変える
        </ActionButton>
        <ActionButton
          kind="small"
          disabled={!set}
          onClick={() => {
            if (!set) return;
            const id = newId('set');
            const copy: RuleSet = {
              id,
              name: `${set.name}のコピー`,
              rules: set.rules.map((r) => ({ ...r, id: newId('rule') })),
            };
            onChange({ ...draft, activeSetId: id, sets: [...draft.sets, copy] });
          }}
        >
          複製
        </ActionButton>
        <ActionButton
          kind="danger"
          disabled={!set || draft.sets.length <= 1}
          confirm={set ? `セット「${set.name}」と、その中のルールを全部消します。よろしいですか？` : undefined}
          onClick={() => {
            if (!set) return;
            const sets = draft.sets.filter((s) => s.id !== set.id);
            onChange({ ...draft, activeSetId: sets[0]?.id ?? '', sets });
          }}
        >
          このセットを消す
        </ActionButton>
      </div>
    </Card>
  );
}

function RuleCard({
  rule,
  gifts,
  media,
  saved,
  position,
  total,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  rule: Rule;
  gifts: GiftRow[];
  media: MediaFileRow[];
  /** 保存済みか。保存していないと、本体はまだ新しい中身を知らないのでテストできない */
  saved: boolean;
  position: number;
  total: number;
  onChange: (fn: (r: Rule) => Rule) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isGiftTrigger = rule.trigger.kind === 'gift' || rule.trigger.kind === 'giftCoins';

  const setTrigger = <K extends keyof Rule['trigger']>(key: K, value: Rule['trigger'][K]) =>
    onChange((r) => ({ ...r, trigger: { ...r.trigger, [key]: value } }));

  return (
    <Card
      className={rule.enabled ? '' : 'rule-off'}
      title={
        <span className="rule-title">
          <input
            type="checkbox"
            checked={rule.enabled}
            title={rule.enabled ? '有効' : '無効'}
            onChange={(e) => onChange((r) => ({ ...r, enabled: e.target.checked }))}
          />
          <input
            className="rule-name"
            value={rule.name}
            onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }))}
            placeholder="ルールの名前"
          />
          <span className="muted small">
            {TRIGGER_LABELS[rule.trigger.kind as TriggerKind]} → やること {rule.actions.length} 個
          </span>
        </span>
      }
      actions={
        <>
          <button type="button" className="button button-small" disabled={position === 1} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="button button-small" disabled={position === total} onClick={() => onMove(1)}>
            ↓
          </button>
          <ActionButton
            kind="small"
            disabled={!saved || rule.actions.length === 0}
            onClick={() => api('POST', '/api/rules/test', { kind: 'rule', id: rule.id, actionIndex: null })}
          >
            試す
          </ActionButton>
          <button type="button" className="button button-small" onClick={() => setOpen((v) => !v)}>
            {open ? '閉じる' : '開く'}
          </button>
        </>
      }
    >
      {!open ? null : (
        <>
          <div className="field-row">
            <Field label="きっかけ" hint="これが起きたら、下の「やること」が動きます">
              <select value={rule.trigger.kind} onChange={(e) => setTrigger('kind', e.target.value as TriggerKind)}>
                {TRIGGER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {TRIGGER_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
            {rule.trigger.kind === 'giftCoins' && (
              <Field label="何コイン以上か" hint="1個あたりのコイン数 × 個数 で見ます">
                <NumberInput value={rule.trigger.minCoins} min={1} max={1_000_000} onChange={(v) => setTrigger('minCoins', v)} />
              </Field>
            )}
            {rule.trigger.kind === 'like' && (
              <Field label="いいね何回ごとか" hint="まとめて届いた時は、またいだ回数だけ動きます">
                <NumberInput value={rule.trigger.likeEvery} min={1} max={1_000_000} onChange={(v) => setTrigger('likeEvery', v)} />
              </Field>
            )}
          </div>

          {rule.trigger.kind === 'gift' && (
            <GiftPicker
              gifts={gifts}
              selected={rule.trigger.giftIds}
              onChange={(ids) => setTrigger('giftIds', ids)}
            />
          )}

          {rule.trigger.kind === 'comment' && (
            <Field label="反応する言葉（1行に1つ。空ならどのコメントでも反応）" hint="大文字と小文字は区別しません">
              <textarea
                rows={3}
                value={rule.trigger.keywords.join('\n')}
                onChange={(e) =>
                  setTrigger(
                    'keywords',
                    e.target.value
                      .split('\n')
                      .map((w) => w.trim())
                      .filter((w) => w.length > 0),
                  )
                }
                placeholder={'例：\nおはよう\nこんばんは'}
              />
            </Field>
          )}

          <div className="field-row">
            <Field label="このルールのクールダウン（秒）" hint="0なら制限なし。1回動いたら、この秒数は動きません">
              <NumberInput
                value={rule.cooldownSec}
                min={0}
                max={86400}
                step={0.5}
                onChange={(v) => onChange((r) => ({ ...r, cooldownSec: v }))}
              />
            </Field>
            <Field label="同じ人へのクールダウン（秒）" hint="0なら制限なし。連投してくる人がいる時に使います">
              <NumberInput
                value={rule.perViewerCooldownSec}
                min={0}
                max={86400}
                step={0.5}
                onChange={(v) => onChange((r) => ({ ...r, perViewerCooldownSec: v }))}
              />
            </Field>
          </div>

          {isGiftTrigger && (
            <label className="check">
              <input
                type="checkbox"
                checked={rule.repeatPerCount}
                onChange={(e) => onChange((r) => ({ ...r, repeatPerCount: e.target.checked }))}
              />
              ギフトの個数の分だけくり返す（例：バラ5個 → 5回）
            </label>
          )}

          <h3 className="rule-section">イベント一覧のタイル</h3>
          <p className="muted small">
            「イベント一覧」オーバーレイに出すタイルの設定です（視聴者に「何をするとどうなるか」を見せるもの）。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={rule.tileVisible}
              onChange={(e) => onChange((r) => ({ ...r, tileVisible: e.target.checked }))}
            />
            イベント一覧に出す
          </label>
          {rule.tileVisible && (
            <div className="field-row">
              <Field label="並び順" hint="小さいほど先。同じなら、このルールの並びの順">
                <NumberInput
                  value={rule.tileOrder}
                  min={-9999}
                  max={9999}
                  step={1}
                  onChange={(v) => onChange((r) => ({ ...r, tileOrder: v }))}
                />
              </Field>
              <Field label="タイルの背景色" hint="空なら style.css のまま">
                <span className="color-field">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(rule.tileColor) ? rule.tileColor : '#141420'}
                    onChange={(e) => onChange((r) => ({ ...r, tileColor: e.target.value }))}
                  />
                  <input
                    value={rule.tileColor}
                    onChange={(e) => onChange((r) => ({ ...r, tileColor: e.target.value }))}
                    placeholder="そのまま"
                  />
                  {rule.tileColor && (
                    <button type="button" className="button button-small" onClick={() => onChange((r) => ({ ...r, tileColor: '' }))}>
                      空に
                    </button>
                  )}
                </span>
              </Field>
              <Field label="タイルに出す画像" hint="メディアのファイル名か、http... のURL">
                <select value={rule.imageUrl} onChange={(e) => onChange((r) => ({ ...r, imageUrl: e.target.value }))}>
                  <option value="">（なし）</option>
                  {media
                    .filter((f) => f.kind === 'image')
                    .map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  {rule.imageUrl && !media.some((f) => f.name === rule.imageUrl) && (
                    <option value={rule.imageUrl}>{rule.imageUrl}</option>
                  )}
                </select>
              </Field>
            </div>
          )}

          <h3 className="rule-section">やること</h3>
          {!saved && <p className="muted small">※「試す」は、保存してから押せます。</p>}
          {rule.actions.length === 0 && <p className="muted small">まだ何もありません。下のボタンで追加してください。</p>}
          {rule.actions.map((action, i) => (
            <ActionEditor
              key={i}
              action={action}
              media={media}
              position={i + 1}
              test={saved ? { kind: 'rule', id: rule.id, index: i } : null}
              onChange={(fn) =>
                onChange((r) => ({ ...r, actions: r.actions.map((a, j) => (j === i ? fn(a) : a)) }))
              }
              onDelete={() => onChange((r) => ({ ...r, actions: r.actions.filter((_, j) => j !== i) }))}
            />
          ))}
          <div className="button-row">
            {ACTION_TYPES.map((type) => (
              <ActionButton
                key={type}
                kind="small"
                onClick={() => onChange((r) => ({ ...r, actions: [...r.actions, emptyAction(type)] }))}
              >
                ＋ {ACTION_LABELS[type]}
              </ActionButton>
            ))}
          </div>

          <div className="button-row rule-footer">
            <ActionButton kind="small" onClick={onDuplicate}>
              このルールを複製
            </ActionButton>
            <ActionButton kind="danger" confirm={`ルール「${rule.name}」を消します。よろしいですか？`} onClick={onDelete}>
              このルールを消す
            </ActionButton>
          </div>
        </>
      )}
    </Card>
  );
}

/** ギフトを一覧から選ぶ（要件 R-4）。表示名はその場で変えられる */
function GiftPicker({
  gifts,
  selected,
  onChange,
}: {
  gifts: GiftRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(gifts);

  useEffect(() => setRows(gifts), [gifts]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((g) => `${g.display_name ?? ''} ${g.name} ${g.gift_id}`.toLowerCase().includes(q));
  }, [rows, search]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const rename = async (gift: GiftRow) => {
    const name = window.prompt(`「${gift.name}」の表示名（空にすると元の名前に戻ります）`, gift.display_name ?? '');
    if (name === null) return;
    const res = await api<{ gifts: GiftRow[] }>('PUT', '/api/gifts/display-name', { giftId: gift.gift_id, displayName: name });
    setRows(res.gifts);
  };

  return (
    <Field
      label="反応するギフト"
      hint={
        selected.length === 0
          ? 'ひとつも選ばないと、どのギフトでも反応します'
          : `${selected.length} 個 選んでいます`
      }
    >
      <div className="gift-picker">
        <div className="gift-picker-head">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ギフト名で探す" />
          {selected.length > 0 && (
            <button type="button" className="button button-small" onClick={() => onChange([])}>
              選択を全部外す
            </button>
          )}
        </div>
        {gifts.length === 0 ? (
          <p className="muted small">
            まだギフトの一覧がありません。配信で1回でもギフトが届くと、ここに出てきます（テストのギフトでも増えます）。
          </p>
        ) : (
          <div className="gift-grid">
            {shown.map((gift) => (
              <div key={gift.gift_id} className={`gift-item ${selected.includes(gift.gift_id) ? 'gift-item-on' : ''}`}>
                <button type="button" className="gift-pick" onClick={() => toggle(gift.gift_id)}>
                  {gift.image_url ? <img src={gift.image_url} alt="" /> : <span className="gift-noimage">?</span>}
                  <span className="gift-name">{gift.display_name || gift.name}</span>
                  <span className="gift-coins">{gift.coins} コイン</span>
                </button>
                <button type="button" className="gift-rename" title="表示名を変える" onClick={() => void rename(gift)}>
                  名前
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
