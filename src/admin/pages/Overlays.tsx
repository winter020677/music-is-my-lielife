// オーバーレイの画面：OBSに入れるURLと、入れ方（要件 O-1〜O-5）と、見た目の設定（要件 O-6）

import { useEffect, useState } from 'react';
import { api, type AppState, type Settings } from '../api.ts';
import { ActionButton, Card, CopyText, Field, StatusBadge } from '../components/ui.tsx';
import { NumberInput } from '../components/actions.tsx';

type OverlayLook = Settings['overlays'][string];

const OVERLAYS = [
  {
    name: 'alert',
    title: 'アラート',
    description: 'ギフトなどが来た時に、名前とギフトを画面の上に出します。',
    size: '幅 1920 × 高さ 1080（配信の画面と同じ大きさ）',
    audio: false,
    columns: false,
  },
  {
    name: 'media',
    title: 'メディア演出',
    description: 'ルールの「動画・画像・音を出す」で決めた動画・GIF・画像・効果音を出します。',
    size: '幅 1920 × 高さ 1080（配信の画面と同じ大きさ）',
    audio: true,
    columns: false,
  },
  {
    name: 'spinner',
    title: 'スピナー',
    description: 'ルーレットが回って、当たりが決まるところを見せます。「スピナー」の画面で中身を決めます。',
    size: '幅 1920 × 高さ 1080（配信の画面と同じ大きさ）',
    audio: false,
    columns: false,
  },
  {
    name: 'speech',
    title: '読み上げ（音だけ）',
    description: 'VOICEVOXで作った読み上げの音を鳴らします。画面には何も出ません。',
    size: '幅 300 × 高さ 100（小さくてよい）',
    audio: true,
    columns: false,
  },
];

const DEFAULT_LOOK: OverlayLook = {
  scale: 100,
  fontScale: 100,
  padding: -1,
  textColor: '',
  backgroundColor: '',
  accentColor: '',
  columns: 0,
  extraCss: '',
};

export function OverlaysPage({ state }: { state: AppState }) {
  return (
    <div className="page-stack">
      <Card
        title="OBSに入れるオーバーレイ"
        actions={
          <ActionButton kind="small" onClick={() => api('POST', '/api/overlays/reload')}>
            全部を再読み込み
          </ActionButton>
        }
      >
        <ol className="steps">
          <li>OBSの「ソース」の＋ボタン →「ブラウザ」を選んで、名前を付けて「OK」</li>
          <li>「URL」に下のURLを貼り付け、「幅」「高さ」を下の大きさにする</li>
          <li>音を出すもの（メディア演出・読み上げ）は「OBSで音声を制御する」にチェックを入れる</li>
          <li>「OK」を押す。この画面の表示が「表示中」になれば、つながっています</li>
        </ol>
        <p className="muted small">
          背景は透明なので、配信の画面の上に重ねて使えます。本体を再起動しても、オーバーレイは自動でつなぎ直します（URLを貼り直す必要はありません）。
        </p>
      </Card>

      {OVERLAYS.map((o) => (
        <OverlayCard key={o.name} overlay={o} state={state} />
      ))}

      <Card title="もっと細かく変えるには">
        <p className="small">
          プロジェクトの <code>overlays</code> フォルダの中の <code>style.css</code> を、メモ帳などで開いて書き換えます（色や大きさは、値を直接書いてあります）。
          書き換えたら「全部を再読み込み」を押すと反映されます。新しい演出が欲しい時は、Claude Codeに頼めば <code>overlays/_template</code> をもとに作れます。
        </p>
        <p className="small muted">
          ※ 上の「見た目」で決めたものは、<code>style.css</code> より後から効きます。<code>style.css</code> を書き換えても変わらない時は、
          「見た目」の欄が空（または「そのまま」）になっているか確かめてください。
        </p>
      </Card>
    </div>
  );
}

function OverlayCard({ overlay, state }: { overlay: (typeof OVERLAYS)[number]; state: AppState }) {
  const stored = state.settings.overlays[overlay.name] ?? DEFAULT_LOOK;
  const [draft, setDraft] = useState<OverlayLook>(stored);
  const [open, setOpen] = useState(false);
  const count = state.overlays[overlay.name] ?? 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  // 保存していない変更がなければ、本体の設定に合わせる
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [JSON.stringify(stored)]);

  const set = <K extends keyof OverlayLook>(key: K, value: OverlayLook[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const put = (look: OverlayLook) =>
    api('PUT', '/api/settings', {
      ...state.settings,
      overlays: { ...state.settings.overlays, [overlay.name]: look },
    });

  return (
    <Card
      title={overlay.title}
      actions={
        <>
          <StatusBadge tone={count > 0 ? 'green' : 'gray'}>
            {count > 0 ? `${count}つ表示中` : 'OBSにありません'}
          </StatusBadge>
          <button type="button" className="button button-small" onClick={() => setOpen((v) => !v)}>
            {open ? '見た目を閉じる' : '見た目'}
          </button>
        </>
      }
    >
      <p>{overlay.description}</p>
      <p>
        URL：<CopyText text={`${state.app.overlayBaseUrl}${overlay.name}/`} />
      </p>
      <p className="small">おすすめの大きさ：{overlay.size}</p>
      {overlay.audio && <p className="small">「OBSで音声を制御する」にチェックを入れてください。</p>}

      {open && (
        <div className="look-box">
          <p className="muted small">
            ここで決めたものだけが、<code>style.css</code> の上から効きます。空（または「そのまま」）にしておけば、
            <code>style.css</code> に書いてある見た目のままです。保存すると、OBSを触らなくてもすぐ変わります。
          </p>
          <div className="field-row">
            <Field label="全体の大きさ（％）" hint="100でそのまま">
              <NumberInput value={draft.scale} min={10} max={400} step={5} onChange={(v) => set('scale', v)} />
            </Field>
            <Field label="文字の大きさ（％）" hint="100でそのまま">
              <NumberInput value={draft.fontScale} min={10} max={400} step={5} onChange={(v) => set('fontScale', v)} />
            </Field>
            <Field label="余白（px）" hint="-1 なら style.css のまま">
              <NumberInput value={draft.padding} min={-1} max={200} step={1} onChange={(v) => set('padding', v)} />
            </Field>
            {overlay.columns && (
              <Field label="列数" hint="0 なら style.css のまま">
                <NumberInput value={draft.columns} min={0} max={24} step={1} onChange={(v) => set('columns', v)} />
              </Field>
            )}
          </div>
          <div className="field-row">
            <ColorField label="文字の色" value={draft.textColor} onChange={(v) => set('textColor', v)} />
            <ColorField label="背景の色" value={draft.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
            <ColorField label="ふち・目立たせる色" value={draft.accentColor} onChange={(v) => set('accentColor', v)} />
          </div>
          <Field label="自分で足すCSS" hint="ここに書いたものが、いちばん最後に効きます">
            <textarea
              rows={4}
              value={draft.extraCss}
              onChange={(e) => set('extraCss', e.target.value)}
              placeholder={'例：\n.alert { border-radius: 0; }'}
            />
          </Field>
          <div className="button-row">
            <ActionButton kind="primary" disabled={!dirty} onClick={() => put(draft)}>
              見た目を保存
            </ActionButton>
            <ActionButton disabled={!dirty} onClick={() => setDraft(stored)}>
              元に戻す
            </ActionButton>
            <ActionButton
              confirm={`${overlay.title}の見た目を、style.css のままに戻しますか？`}
              onClick={async () => {
                setDraft(DEFAULT_LOOK);
                await put(DEFAULT_LOOK);
              }}
            >
              全部そのままに戻す
            </ActionButton>
            {dirty && <span className="muted small">保存していない変更があります</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

/** 色の欄。空にすると style.css のままになる */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint="空なら style.css のまま">
      <span className="color-field">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="そのまま" />
        {value && (
          <button type="button" className="button button-small" onClick={() => onChange('')}>
            空に
          </button>
        )}
      </span>
    </Field>
  );
}
