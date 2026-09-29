// 「やること」（要件 6.3）の編集に使う部品
//
// ルールの画面と、スピナーの画面（当たった時のやること）の両方で使う。

import { useRef, useState } from 'react';
import { api, type Settings } from '../api.ts';
import { ActionButton, Card, Field } from './ui.tsx';
import { ACTION_LABELS, type ActionType } from '../../server/config/ruleLabels.ts';

type RuleAction = Settings['rules']['sets'][number]['rules'][number]['actions'][number];
export type { RuleAction };

export interface MediaFileRow {
  name: string;
  kind: 'video' | 'image' | 'audio';
  bytes: number;
  at: string;
}

export const MEDIA_KIND_LABELS: Record<MediaFileRow['kind'], string> = {
  video: '動画',
  image: '画像',
  audio: '音',
};

/** バイト数を読みやすくする */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 新しいIDを作る */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** まだ何も決めていない、やること1つ */
export function emptyAction(type: ActionType): RuleAction {
  return {
    type,
    priority: false,
    alertTitle: '{nickname}',
    alertMessage: '{giftname} ×{giftcount}',
    mediaFile: '',
    mediaX: 50,
    mediaY: 50,
    mediaWidth: 40,
    mediaVolume: 0.8,
    mediaDurationSec: 0,
    command: '',
    repeat: 1,
    delaySec: 0,
    intervalSec: 0,
    text: '',
  };
}

export function ActionEditor({
  action,
  media,
  position,
  onChange,
  onDelete,
}: {
  action: RuleAction;
  media: MediaFileRow[];
  position: number;
  onChange: (fn: (a: RuleAction) => RuleAction) => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof RuleAction>(key: K, value: RuleAction[K]) => onChange((a) => ({ ...a, [key]: value }));

  return (
    <div className="action-box">
      <div className="action-box-head">
        <strong>
          {position}. {ACTION_LABELS[action.type as ActionType]}
        </strong>
        <label className="check check-inline">
          <input type="checkbox" checked={action.priority} onChange={(e) => set('priority', e.target.checked)} />
          割り込み（順番待ちを追い越す）
        </label>
        <button type="button" className="button button-small" onClick={onDelete}>
          消す
        </button>
      </div>

      {action.type === 'alert' && (
        <div className="field-row">
          <Field label="大きい文字">
            <input value={action.alertTitle} onChange={(e) => set('alertTitle', e.target.value)} />
          </Field>
          <Field label="小さい文字">
            <input value={action.alertMessage} onChange={(e) => set('alertMessage', e.target.value)} />
          </Field>
        </div>
      )}

      {action.type === 'media' && (
        <>
          <Field
            label="出すファイル"
            hint={media.length === 0 ? '「ルール」画面の下の「メディアのファイル」で入れてください' : '動画・GIF・画像・効果音'}
          >
            <select value={action.mediaFile} onChange={(e) => set('mediaFile', e.target.value)}>
              <option value="">（選んでください）</option>
              {media.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}（{MEDIA_KIND_LABELS[f.kind]}）
                </option>
              ))}
              {/* 設定にあるのに一覧にないファイル（消したあとなど）も、消えてしまわないように出す */}
              {action.mediaFile && !media.some((f) => f.name === action.mediaFile) && (
                <option value={action.mediaFile}>{action.mediaFile}（見つかりません）</option>
              )}
            </select>
          </Field>
          <div className="field-row">
            <Field label="左からの位置（％）" hint="50で真ん中">
              <NumberInput value={action.mediaX} min={0} max={100} step={1} onChange={(v) => set('mediaX', v)} />
            </Field>
            <Field label="上からの位置（％）" hint="50で真ん中">
              <NumberInput value={action.mediaY} min={0} max={100} step={1} onChange={(v) => set('mediaY', v)} />
            </Field>
            <Field label="大きさ（画面の幅の％）">
              <NumberInput value={action.mediaWidth} min={1} max={100} step={1} onChange={(v) => set('mediaWidth', v)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="音量" hint="0〜1（0.8がふつう）">
              <NumberInput value={action.mediaVolume} min={0} max={1} step={0.1} onChange={(v) => set('mediaVolume', v)} />
            </Field>
            <Field label="表示する秒数" hint="0なら、動画と音は最後まで／画像は5秒">
              <NumberInput
                value={action.mediaDurationSec}
                min={0}
                max={600}
                step={0.5}
                onChange={(v) => set('mediaDurationSec', v)}
              />
            </Field>
          </div>
        </>
      )}

      {action.type === 'minecraft' && (
        <>
          <Field label="コマンド（1行に1つ）" hint="設定の「Minecraftを使う」が入っている時だけ動きます">
            <textarea
              rows={3}
              value={action.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="例：execute at {playername} run summon zombie ~{random:-3 3} ~ ~{random:-3 3}"
            />
          </Field>
          <div className="field-row">
            <Field label="くり返し回数" hint="{repetition} に入る値。何回目かは {index}">
              <NumberInput value={action.repeat} min={1} max={1000} onChange={(v) => set('repeat', v)} />
            </Field>
            <Field label="送り始めるまでの待ち時間（秒）">
              <NumberInput value={action.delaySec} min={0} max={600} step={0.5} onChange={(v) => set('delaySec', v)} />
            </Field>
            <Field label="くり返しの間隔（秒）">
              <NumberInput value={action.intervalSec} min={0} max={600} step={0.5} onChange={(v) => set('intervalSec', v)} />
            </Field>
          </div>
        </>
      )}

      {action.type === 'speech' && (
        <Field label="読み上げる文" hint="設定の「読み上げを使う」が入っている時だけ動きます">
          <input
            value={action.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="例：{nickname}さん、{giftname}ありがとう"
          />
        </Field>
      )}

      {action.type === 'spinner' && (
        <p className="muted small">
          「スピナー」画面で決めた項目から1つ当てます。当たった項目の「やること」も動きます。
          回っている間に次が来たら、順番待ちに入って1つずつ回ります。
        </p>
      )}
    </div>
  );
}

export function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** メディアのファイルを入れる・消す（要件 A-1） */
export function MediaLibraryCard({
  files,
  folder,
  onChange,
}: {
  files: MediaFileRow[];
  folder: string;
  onChange: (files: MediaFileRow[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (list: FileList) => {
    setBusy(true);
    setMessage(null);
    const added: string[] = [];
    const failed: string[] = [];
    for (const file of Array.from(list)) {
      try {
        // ファイルの中身をそのまま送る（名前は ? の後ろで渡す）
        const res = await fetch(`/api/media/upload?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; files?: MediaFileRow[] };
        if (!res.ok) {
          failed.push(`${file.name}：${data.error ?? `エラー（HTTP ${res.status}）`}`);
          continue;
        }
        added.push(file.name);
        if (data.files) onChange(data.files);
      } catch {
        failed.push(`${file.name}：本体とつながりません`);
      }
    }
    setBusy(false);
    setMessage(
      [added.length > 0 ? `${added.length}個 入れました` : '', ...failed].filter((t) => t).join(' / ') ||
        '入れるものがありませんでした',
    );
  };

  return (
    <Card
      title="メディアのファイル"
      actions={
        <ActionButton kind="small" disabled={busy} onClick={() => input.current?.click()}>
          ファイルを入れる
        </ActionButton>
      }
    >
      <p className="muted small">
        「動画・画像・音を出す」と、スピナーの項目の画像に使えます。使えるのは mp4 / webm / mov / gif / png / jpg / webp / mp3 / wav /
        ogg / m4a（1つ100MBまで）。
        <br />
        置き場所：<code>{folder}</code>
        （プロジェクトの外なので、<code>update.bat</code> で更新しても消えません。エクスプローラーで直接入れてもかまいません）
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept=".mp4,.webm,.mov,.gif,.png,.jpg,.jpeg,.webp,.apng,.mp3,.wav,.ogg,.m4a"
        hidden
        onChange={(e) => {
          const list = e.target.files;
          e.target.value = '';
          if (list && list.length > 0) void upload(list);
        }}
      />
      {busy && <p className="muted">入れています…</p>}
      {message && <p className="ok-text">{message}</p>}
      {files.length === 0 ? (
        <p className="muted small">まだ何も入っていません。</p>
      ) : (
        <table className="media-table">
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td>{MEDIA_KIND_LABELS[f.kind]}</td>
                <td className="media-name">{f.name}</td>
                <td className="muted">{formatBytes(f.bytes)}</td>
                <td>
                  <ActionButton
                    kind="small"
                    confirm={`${f.name} を消します。このファイルを使っているルールとスピナーの項目は動かなくなります。よろしいですか？`}
                    onClick={async () => {
                      const res = await api<{ files: MediaFileRow[] }>('POST', '/api/media/delete', { name: f.name });
                      onChange(res.files);
                    }}
                  >
                    消す
                  </ActionButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** メディアの一覧を読み込む（画面をまたいで同じ書き方にするため） */
export async function loadMedia(): Promise<{ files: MediaFileRow[]; folder: string }> {
  try {
    return await api<{ files: MediaFileRow[]; folder: string }>('GET', '/api/media');
  } catch {
    return { files: [], folder: '' };
  }
}
