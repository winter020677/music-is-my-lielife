// スピナーの画面（要件 6.5）
//
// 回した時に当たる項目を決める。当たった項目の「やること」も、ここで決める。
// 「保存」を押すまで本体には送らない（設定・ルールの画面と同じ）。

import { useEffect, useState } from 'react';
import { api, type AppState, type Settings } from '../api.ts';
import { ActionButton, Card, Field } from '../components/ui.tsx';
import {
  ActionEditor,
  NumberInput,
  emptyAction,
  loadMedia,
  newId,
  type MediaFileRow,
} from '../components/actions.tsx';
import { ACTION_LABELS, ACTION_TYPES, RARITY_LABELS } from '../../server/config/ruleLabels.ts';

type SpinnerConfig = Settings['spinner'];
type SpinnerItem = SpinnerConfig['items'][number];

/** 新しい項目の色は、順ぐりに選ぶ（毎回同じ色にならないように） */
const COLORS = ['#4a7cf7', '#f7674a', '#3fb98a', '#f7b84a', '#a86ff7', '#f74a9c', '#4ac5f7', '#8ab23f'];

function emptyItem(index: number): SpinnerItem {
  return {
    id: newId('item'),
    name: '新しい項目',
    image: '',
    color: COLORS[index % COLORS.length],
    weight: 1,
    rarity: 1,
    actions: [],
  };
}

export function SpinnerPage({ state }: { state: AppState }) {
  const [draft, setDraft] = useState<SpinnerConfig>(state.settings.spinner);
  const [saved, setSaved] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaFileRow[]>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings.spinner);

  useEffect(() => {
    if (!dirty) setDraft(state.settings.spinner);
  }, [state.settings.spinner]);

  useEffect(() => {
    void loadMedia().then((res) => setMedia(res.files));
  }, []);

  const change = (next: SpinnerConfig) => {
    setDraft(next);
    setSaved(null);
  };
  const set = <K extends keyof SpinnerConfig>(key: K, value: SpinnerConfig[K]) => change({ ...draft, [key]: value });
  const updateItem = (id: string, fn: (item: SpinnerItem) => SpinnerItem) =>
    change({ ...draft, items: draft.items.map((item) => (item.id === id ? fn(item) : item)) });

  const save = async () => {
    const res = await api<{ settings: Settings }>('PUT', '/api/settings', { ...state.settings, spinner: draft });
    setDraft(res.settings.spinner);
    setSaved('保存しました');
  };

  // 当たりやすさの合計（各項目の割合を出すため）
  const totalWeight = draft.items.reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 0), 0);

  return (
    <div className="page-stack">
      <div className="save-bar">
        <ActionButton kind="primary" onClick={save} disabled={!dirty}>
          保存
        </ActionButton>
        <ActionButton onClick={() => change(state.settings.spinner)} disabled={!dirty}>
          元に戻す
        </ActionButton>
        {dirty ? (
          <span className="muted">保存していない変更があります</span>
        ) : (
          saved && <span className="ok-text">{saved}</span>
        )}
      </div>

      <Card
        title="スピナー"
        actions={
          <ActionButton
            kind="small"
            disabled={dirty || !state.spinner.ready}
            onClick={() => api('POST', '/api/spinner/spin')}
          >
            試しに回す
          </ActionButton>
        }
      >
        <p className="muted small">
          ルールの「やること」に <strong>スピナーを回す</strong> を足すと、そのきっかけで回ります。
          回っている間に次が来たら、順番待ちに入って1つずつ回ります。
          <br />
          OBSには「スピナー」オーバーレイを入れてください（「オーバーレイ」の画面にURLがあります）。
        </p>
        <label className="check">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          スピナーを使う
        </label>
        <div className="field-row">
          <Field label="名前" hint="管理画面で見分けるための名前です">
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="回っている時間（秒）">
            <NumberInput value={draft.spinSec} min={0.5} max={60} step={0.5} onChange={(v) => set('spinSec', v)} />
          </Field>
          <Field label="当たりを見せる時間（秒）">
            <NumberInput value={draft.resultSec} min={0.5} max={60} step={0.5} onChange={(v) => set('resultSec', v)} />
          </Field>
        </div>
        {dirty && <p className="muted small">※「試しに回す」は、保存してから押せます。</p>}
        {!dirty && !state.spinner.ready && (
          <p className="muted small">
            ※ 回すには「スピナーを使う」を入れて、当たりやすさが1以上の項目を1つ以上作ってから保存してください。
          </p>
        )}
        {state.spinner.lastResult && (
          <p className="muted small">
            最後に当たったもの：<strong>{state.spinner.lastResult.name}</strong>
          </p>
        )}
      </Card>

      {draft.items.length === 0 ? (
        <Card title="項目がありません">
          <p className="muted small">回した時に当たるものを作ります。名前・色・画像・当たりやすさ・レア度を決められます。</p>
          <ActionButton kind="primary" onClick={() => set('items', [emptyItem(0)])}>
            最初の項目を作る
          </ActionButton>
        </Card>
      ) : (
        <>
          {draft.items.map((item, i) => (
            <ItemCard
              key={item.id}
              item={item}
              media={media}
              position={i + 1}
              total={draft.items.length}
              share={totalWeight > 0 && item.weight > 0 ? (item.weight / totalWeight) * 100 : 0}
              onChange={(fn) => updateItem(item.id, fn)}
              onMove={(delta) => {
                const items = [...draft.items];
                const to = i + delta;
                if (to < 0 || to >= items.length) return;
                [items[i], items[to]] = [items[to], items[i]];
                set('items', items);
              }}
              onDuplicate={() => {
                const items = [...draft.items];
                items.splice(i + 1, 0, { ...item, id: newId('item'), name: `${item.name}のコピー` });
                set('items', items);
              }}
              onDelete={() => set('items', draft.items.filter((x) => x.id !== item.id))}
            />
          ))}
          <div className="button-row">
            <ActionButton kind="primary" onClick={() => set('items', [...draft.items, emptyItem(draft.items.length)])}>
              項目を追加
            </ActionButton>
          </div>
        </>
      )}
    </div>
  );
}

function ItemCard({
  item,
  media,
  position,
  total,
  share,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  item: SpinnerItem;
  media: MediaFileRow[];
  position: number;
  total: number;
  share: number;
  onChange: (fn: (item: SpinnerItem) => SpinnerItem) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof SpinnerItem>(key: K, value: SpinnerItem[K]) => onChange((x) => ({ ...x, [key]: value }));
  const images = media.filter((f) => f.kind === 'image');

  return (
    <Card
      title={
        <span className="rule-title">
          <span className="item-color" style={{ background: item.color }} />
          <input
            className="rule-name"
            value={item.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="項目の名前"
          />
          <span className="muted small">
            {item.weight > 0 ? `当たる割合 ${share.toFixed(1)}%` : '当たらない'} ／ {RARITY_LABELS[item.rarity]} ／ やること{' '}
            {item.actions.length} 個
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
          <button type="button" className="button button-small" onClick={() => setOpen((v) => !v)}>
            {open ? '閉じる' : '開く'}
          </button>
        </>
      }
    >
      {!open ? null : (
        <>
          <div className="field-row">
            <Field label="当たりやすさ" hint="大きいほど当たりやすい。0にすると当たらない（輪には出ます）">
              <NumberInput value={item.weight} min={0} max={10000} step={1} onChange={(v) => set('weight', v)} />
            </Field>
            <Field label="レア度" hint="高いほど、当たった時の見せ方が派手になります">
              <select value={item.rarity} onChange={(e) => set('rarity', Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {r}：{RARITY_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="色">
              <input type="color" value={item.color} onChange={(e) => set('color', e.target.value)} />
            </Field>
          </div>

          <Field label="画像（なくてもよい）" hint="「ルール」画面の「メディアのファイル」に入れた画像から選べます">
            <select value={item.image} onChange={(e) => set('image', e.target.value)}>
              <option value="">（なし）</option>
              {images.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
              {item.image && !images.some((f) => f.name === item.image) && (
                <option value={item.image}>{item.image}（見つかりません）</option>
              )}
            </select>
          </Field>

          <h3 className="rule-section">当たった時にすること</h3>
          {item.actions.length === 0 && <p className="muted small">まだ何もありません。下のボタンで追加してください。</p>}
          {item.actions.map((action, i) => (
            <ActionEditor
              key={i}
              action={action}
              media={media}
              position={i + 1}
              onChange={(fn) => onChange((x) => ({ ...x, actions: x.actions.map((a, j) => (j === i ? fn(a) : a)) }))}
              onDelete={() => onChange((x) => ({ ...x, actions: x.actions.filter((_, j) => j !== i) }))}
            />
          ))}
          <div className="button-row">
            {ACTION_TYPES.filter((type) => type !== 'spinner').map((type) => (
              <ActionButton
                key={type}
                kind="small"
                onClick={() => onChange((x) => ({ ...x, actions: [...x.actions, emptyAction(type)] }))}
              >
                ＋ {ACTION_LABELS[type]}
              </ActionButton>
            ))}
          </div>
          <p className="muted small">※ 当たった項目の中では、スピナーは回せません（回り続けてしまうため）。</p>

          <div className="button-row rule-footer">
            <ActionButton kind="small" onClick={onDuplicate}>
              この項目を複製
            </ActionButton>
            <ActionButton kind="danger" confirm={`項目「${item.name}」を消します。よろしいですか？`} onClick={onDelete}>
              この項目を消す
            </ActionButton>
          </div>
        </>
      )}
    </Card>
  );
}
