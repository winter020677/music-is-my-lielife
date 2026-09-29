// 設定の画面
// 「保存」を押すまで本体には送らない。秘密情報は別の欄で、値は表示しない（「設定済み」だけ出す）。

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, type AppState, type Settings } from '../api.ts';
import { ActionButton, Card, Field, StatusBadge } from '../components/ui.tsx';

type Section = keyof Omit<Settings, 'schemaVersion'>;

export function SettingsPage({ state }: { state: AppState }) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  const [saved, setSaved] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings);

  // 保存していない変更がなければ、本体の設定に合わせる
  useEffect(() => {
    if (!dirty) setDraft(state.settings);
  }, [state.settings]);

  const set = <S extends Section, K extends keyof Settings[S]>(section: S, key: K, value: Settings[S][K]) => {
    setDraft((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    setSaved(null);
  };
  const setGift = <K extends keyof Settings['phase0']['giftReaction']>(key: K, value: Settings['phase0']['giftReaction'][K]) => {
    setDraft((prev) => ({ ...prev, phase0: { ...prev.phase0, giftReaction: { ...prev.phase0.giftReaction, [key]: value } } }));
    setSaved(null);
  };

  const save = async () => {
    const res = await api<{ settings: Settings }>('PUT', '/api/settings', draft);
    setDraft(res.settings);
    setSaved('保存しました');
  };

  return (
    <div className="page-stack settings">
      <div className="save-bar">
        <ActionButton kind="primary" onClick={save} disabled={!dirty}>
          保存
        </ActionButton>
        <ActionButton onClick={() => setDraft(state.settings)} disabled={!dirty}>
          元に戻す
        </ActionButton>
        {dirty ? <span className="muted">保存していない変更があります</span> : saved && <span className="ok-text">{saved}</span>}
      </div>

      <Card title="TikTok">
        <Field label="TikTokのユーザー名" hint="@の後ろの部分（例：@abc なら abc）">
          <input value={draft.tiktok.username} onChange={(e) => set('tiktok', 'username', e.target.value)} placeholder="例：my_account" />
        </Field>
        <Check
          label="本体を起動したら、自動で配信待ちに入る（配信が始まったら自動でつなぐ）"
          checked={draft.tiktok.autoConnect}
          onChange={(v) => set('tiktok', 'autoConnect', v)}
        />
        <div className="field-row">
          <Field label="配信が始まったかを確かめる間隔（秒）" hint="30秒以上。ふだんはEuler Streamの回数を使いません">
            <NumberInput value={draft.tiktok.liveCheckIntervalSec} min={30} max={3600} onChange={(v) => set('tiktok', 'liveCheckIntervalSec', v)} />
          </Field>
          <Field label="Euler Streamの1日の上限（回）" hint="無料のCommunityプランは 2,500">
            <NumberInput value={draft.tiktok.eulerDailyLimit} min={1} max={10_000_000} onChange={(v) => set('tiktok', 'eulerDailyLimit', v)} />
          </Field>
        </div>
        <Check
          label="TikTokに直接確かめられない時は、Euler Streamで確かめてよい"
          checked={draft.tiktok.eulerFallbackForLiveCheck}
          onChange={(v) => set('tiktok', 'eulerFallbackForLiveCheck', v)}
        />
        <Field label="↑でEuler Streamを使う時の、最短の間隔（秒）" hint="600秒なら、多くても1日144回">
          <NumberInput
            value={draft.tiktok.eulerFallbackMinIntervalSec}
            min={60}
            max={86400}
            onChange={(v) => set('tiktok', 'eulerFallbackMinIntervalSec', v)}
          />
        </Field>
      </Card>

      <SecretsCard state={state} />

      <Card title="Minecraft">
        <Check label="Minecraftを使う" checked={draft.minecraft.enabled} onChange={(v) => set('minecraft', 'enabled', v)} />
        <div className="field-row">
          <Field label="サーバーのアドレス" hint="同じPCなら 127.0.0.1">
            <input value={draft.minecraft.host} onChange={(e) => set('minecraft', 'host', e.target.value)} />
          </Field>
          <Field label="RCONのポート" hint="server.properties の rcon.port（通常 25575）">
            <NumberInput value={draft.minecraft.port} min={1} max={65535} onChange={(v) => set('minecraft', 'port', v)} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="プレイヤー名" hint="コマンドの {playername} に入ります">
            <input value={draft.minecraft.playerName} onChange={(e) => set('minecraft', 'playerName', e.target.value)} />
          </Field>
          <Field label="1秒あたりに送るコマンドの上限" hint="多すぎるとサーバーが重くなります">
            <NumberInput
              value={draft.minecraft.maxCommandsPerSecond}
              min={1}
              max={100}
              onChange={(v) => set('minecraft', 'maxCommandsPerSecond', v)}
            />
          </Field>
        </div>
      </Card>

      <VoicevoxCard draft={draft} set={set} />

      <Card title="ギフトの反応（フェーズ0の試作）">
        <p className="muted small">
          ギフトが届いたら、ここで決めた反応をします。フェーズ1で、きっかけ・やることを自由に組める「ルール」に置き換えます。
          置き換え記号：{'{nickname}'} {'{giftname}'} {'{giftcount}'} {'{coins}'} {'{playername}'} {'{random:X Y}'} {'{mult:X Y}'} {'{plus:X Y}'}
        </p>
        <Check label="ギフトに反応する" checked={draft.phase0.giftReaction.enabled} onChange={(v) => setGift('enabled', v)} />
        <Check
          label="アラート用オーバーレイに表示する"
          checked={draft.phase0.giftReaction.showOnOverlay}
          onChange={(v) => setGift('showOnOverlay', v)}
        />
        <Field label="Minecraftに送るコマンド（1行に1つ。空なら送らない）">
          <textarea
            rows={4}
            value={draft.phase0.giftReaction.minecraftCommand}
            onChange={(e) => setGift('minecraftCommand', e.target.value)}
            placeholder="例：execute at {playername} run summon zombie ~{random:-3 3} ~ ~{random:-3 3}"
          />
        </Field>
        <Field label="読み上げる文（空なら読まない）">
          <input value={draft.phase0.giftReaction.speechText} onChange={(e) => setGift('speechText', e.target.value)} />
        </Field>
        <Field label="アラートを表示する秒数">
          <NumberInput value={draft.alert.displaySec} min={1} max={60} step={0.5} onChange={(v) => set('alert', 'displaySec', v)} />
        </Field>
      </Card>

      <Card title="記録">
        <Field label="データベースのバックアップ先フォルダ" hint="空ならデータフォルダの backups。Googleドライブの同期フォルダも指定できます">
          <input
            value={draft.records.backupFolder}
            onChange={(e) => set('records', 'backupFolder', e.target.value)}
            placeholder="例：G:\マイドライブ\配信のバックアップ"
          />
        </Field>
        <div className="field-row">
          <Field label="毎日のバックアップを残す日数">
            <NumberInput value={draft.records.backupKeep} min={1} max={365} onChange={(v) => set('records', 'backupKeep', v)} />
          </Field>
          <Field label="「遅れて届いた」とみなす秒数" hint="接続した直後にまとめて届く古いデータは、記録だけして演出しない">
            <NumberInput value={draft.records.lateEventSec} min={5} max={3600} onChange={(v) => set('records', 'lateEventSec', v)} />
          </Field>
        </div>
      </Card>

      <ImportExportCard />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function NumberInput({
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
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

const SECRET_FIELDS = [
  { key: 'EULER_API_KEY', label: 'Euler StreamのAPIキー', hint: 'Euler Streamの無料アカウントで作ったキー' },
  { key: 'MINECRAFT_RCON_PASSWORD', label: 'RCONのパスワード', hint: 'server.properties の rcon.password と同じもの' },
  { key: 'OBS_WEBSOCKET_PASSWORD', label: 'OBS WebSocketのパスワード', hint: 'フェーズ2で使います（今は入れなくてよい）' },
] as const;

function SecretsCard({ state }: { state: AppState }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card title="秘密情報（プロジェクトの .env に保存）">
      <p className="muted small">
        入力した値は、このPCの .env ファイルだけに保存されます。画面には表示されず、Gitや設定の書き出しにも含まれません。変えない欄は空のままでOKです。
      </p>
      {SECRET_FIELDS.map((f) => (
        <Field
          key={f.key}
          label={
            <>
              {f.label}{' '}
              <StatusBadge tone={state.secrets[f.key] ? 'green' : 'gray'}>{state.secrets[f.key] ? '設定済み' : '未設定'}</StatusBadge>
            </>
          }
          hint={f.hint}
        >
          <input
            type="password"
            autoComplete="off"
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={state.secrets[f.key] ? '（変える時だけ入力）' : ''}
          />
        </Field>
      ))}
      <div className="button-row">
        <ActionButton
          kind="primary"
          disabled={Object.values(values).every((v) => !v)}
          onClick={async () => {
            const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
            const res = await api<{ changed: string[] }>('PUT', '/api/secrets', body);
            setValues({});
            setMessage(res.changed.length > 0 ? '保存しました' : '変更はありませんでした');
          }}
        >
          秘密情報を保存
        </ActionButton>
        {message && <span className="ok-text">{message}</span>}
      </div>
    </Card>
  );
}

interface Speaker {
  name: string;
  styles: Array<{ name: string; id: number }>;
}

function VoicevoxCard({
  draft,
  set,
}: {
  draft: Settings;
  set: <S extends Section, K extends keyof Settings[S]>(section: S, key: K, value: Settings[S][K]) => void;
}) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<{ ok: boolean; speakers: Speaker[]; error?: string }>('GET', '/api/voicevox/speakers');
    setSpeakers(res.speakers);
    setError(res.ok ? null : (res.error ?? '読み込めませんでした'));
  };

  useEffect(() => {
    if (draft.voicevox.enabled) void load();
  }, []);

  return (
    <Card title="読み上げ（VOICEVOX）">
      <Check label="読み上げを使う" checked={draft.voicevox.enabled} onChange={(v) => set('voicevox', 'enabled', v)} />
      <Field label="VOICEVOXのアドレス" hint="ふつうは http://127.0.0.1:50021 のまま">
        <input value={draft.voicevox.url} onChange={(e) => set('voicevox', 'url', e.target.value)} />
      </Field>
      <div className="field-row">
        <Field label="話者" hint="VOICEVOXを起動してから「一覧を読み込む」を押す">
          {speakers.length > 0 ? (
            <select value={draft.voicevox.speakerId} onChange={(e) => set('voicevox', 'speakerId', Number(e.target.value))}>
              {speakers.flatMap((s) =>
                s.styles.map((st) => (
                  <option key={st.id} value={st.id}>
                    {s.name}（{st.name}）
                  </option>
                )),
              )}
            </select>
          ) : (
            <NumberInput value={draft.voicevox.speakerId} min={0} max={1_000_000} onChange={(v) => set('voicevox', 'speakerId', v)} />
          )}
        </Field>
        <div className="field-button">
          <ActionButton kind="small" onClick={load}>
            一覧を読み込む
          </ActionButton>
        </div>
      </div>
      {error && <p className="action-error">{error}</p>}
      <div className="field-row">
        <Field label="速さ" hint="1 がふつう（0.5〜2）">
          <NumberInput value={draft.voicevox.speed} min={0.5} max={2} step={0.1} onChange={(v) => set('voicevox', 'speed', v)} />
        </Field>
        <Field label="音量" hint="1 がふつう（0〜2）">
          <NumberInput value={draft.voicevox.volume} min={0} max={2} step={0.1} onChange={(v) => set('voicevox', 'volume', v)} />
        </Field>
        <Field label="読み上げる最大の文字数">
          <NumberInput value={draft.voicevox.maxChars} min={10} max={300} onChange={(v) => set('voicevox', 'maxChars', v)} />
        </Field>
      </div>
      <p className="muted small">
        配信で使う時は、キャラクターごとの利用規約に従い、概要欄などにクレジット（例：「VOICEVOX:ずんだもん」）を書いてください。
      </p>
    </Card>
  );
}

function ImportExportCard() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card title="設定の書き出し・読み込み">
      <p className="muted small">
        設定は毎日自動でバックアップされます（データフォルダの backups）。書き出したファイルには秘密情報は含まれません。
      </p>
      <div className="button-row">
        <a className="button button-normal" href="/api/settings/export">
          設定を書き出す
        </a>
        <ActionButton onClick={() => fileInput.current?.click()}>設定を読み込む</ActionButton>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (!window.confirm('今の設定を、このファイルの内容で置き換えますか？')) return;
            try {
              await api('POST', '/api/settings/import', JSON.parse(await file.text()));
              setMessage('読み込みました');
            } catch (err) {
              setMessage(`読み込めませんでした：${err instanceof Error ? err.message : String(err)}`);
            }
          }}
        />
        {message && <span className="ok-text">{message}</span>}
      </div>
    </Card>
  );
}
