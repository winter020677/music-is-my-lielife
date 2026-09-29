// テスト画面（要件 U-3、M-2）
// ギフト・いいね・コメント・フォローなどを「にせもの」で起こして、本番と同じ流れで確かめる。
// テストで起きたことは記録に「テスト」の印が付き、本番の集計には入らない（要件 D-8）。

import { useEffect, useState } from 'react';
import { api, formatTime, type AppState } from '../api.ts';
import { ActionButton, Card, Field } from '../components/ui.tsx';

interface CatalogGift {
  gift_id: string;
  name: string;
  display_name: string | null;
  coins: number;
  image_url: string | null;
}

export function TestPanel({ state }: { state: AppState }) {
  const [name, setName] = useState('テスト視聴者');
  const [catalog, setCatalog] = useState<CatalogGift[]>([]);
  const [giftId, setGiftId] = useState('');
  const [giftName, setGiftName] = useState('バラ');
  const [coins, setCoins] = useState(1);
  const [count, setCount] = useState(1);
  const [comment, setComment] = useState('こんにちは！');
  const [likes, setLikes] = useState(10);

  useEffect(() => {
    api<{ gifts: CatalogGift[] }>('GET', '/api/gifts/catalog')
      .then((r) => setCatalog(r.gifts))
      .catch(() => setCatalog([]));
  }, []);

  const send = (body: Record<string, unknown>) => api('POST', '/api/test/event', { name, ...body });

  return (
    <div className="page-grid">
      <Card title="イベントを試す">
        <p className="muted small">ここで起こしたイベントは「テスト」の印が付き、本番の集計には入りません。</p>
        <Field label="送った人の名前">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>

        <h3>ギフト</h3>
        {catalog.length > 0 && (
          <Field label="ギフトを一覧から選ぶ" hint="一覧は、これまでに届いたギフトから自動で作られます">
            <select
              value={giftId}
              onChange={(e) => {
                const g = catalog.find((x) => x.gift_id === e.target.value);
                setGiftId(e.target.value);
                if (g) {
                  setGiftName(g.display_name || g.name);
                  setCoins(g.coins);
                }
              }}
            >
              <option value="">（自分で入力する）</option>
              {catalog.map((g) => (
                <option key={g.gift_id} value={g.gift_id}>
                  {g.display_name || g.name}（{g.coins}コイン）
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="field-row">
          <Field label="ギフト名">
            <input value={giftName} onChange={(e) => setGiftName(e.target.value)} maxLength={40} />
          </Field>
          <Field label="1個のコイン">
            <input type="number" min={0} value={coins} onChange={(e) => setCoins(Number(e.target.value))} />
          </Field>
          <Field label="個数">
            <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
        </div>
        <ActionButton kind="primary" onClick={() => send({ kind: 'gift', giftId: giftId || undefined, giftName, coins, count })}>
          ギフトを送る
        </ActionButton>

        <h3>その他</h3>
        <div className="field-row">
          <Field label="いいねの数">
            <input type="number" min={1} max={1000} value={likes} onChange={(e) => setLikes(Number(e.target.value))} />
          </Field>
          <div className="field-button">
            <ActionButton onClick={() => send({ kind: 'like', count: likes })}>いいね</ActionButton>
          </div>
        </div>
        <div className="field-row">
          <Field label="コメント">
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} />
          </Field>
          <div className="field-button">
            <ActionButton onClick={() => send({ kind: 'comment', text: comment })}>コメント</ActionButton>
          </div>
        </div>
        <div className="button-row">
          <ActionButton onClick={() => send({ kind: 'follow' })}>フォロー</ActionButton>
          <ActionButton onClick={() => send({ kind: 'share' })}>シェア</ActionButton>
          <ActionButton onClick={() => send({ kind: 'join' })}>入室</ActionButton>
          <ActionButton onClick={() => send({ kind: 'subscribe' })}>サブスク</ActionButton>
        </div>
      </Card>

      <div className="page-column">
        <MinecraftTest state={state} />
        <SpeechTest />
      </div>
    </div>
  );
}

function MinecraftTest({ state }: { state: AppState }) {
  const [command, setCommand] = useState('say テストです');
  const [message, setMessage] = useState<string | null>(null);

  const run = async (delaySec: number) => {
    setMessage(null);
    const res = await api<{ ok: boolean; response?: string; error?: string; message?: string }>('POST', '/api/minecraft/command', {
      command,
      delaySec,
    });
    if (!res.ok) throw new Error(res.error ?? '失敗しました');
    setMessage(res.message ?? (res.response ? `返事：${res.response}` : '送りました（返事なし）'));
  };

  return (
    <Card title="Minecraftのコマンドを試す">
      <p className="muted small">
        置き換え記号（{'{playername}'} など）は、ここでは置き換わりません。そのまま送られます。
      </p>
      <Field label="コマンド（先頭の / はなくてもよい）">
        <input value={command} onChange={(e) => setCommand(e.target.value)} maxLength={1000} />
      </Field>
      <div className="button-row">
        <ActionButton kind="primary" onClick={() => run(0)}>
          今すぐ実行
        </ActionButton>
        <ActionButton onClick={() => run(5)}>5秒後に実行</ActionButton>
      </div>
      {message && <p className="status-message">{message}</p>}
      <h3>最近送ったコマンド</h3>
      {state.minecraft.recent.length === 0 ? (
        <p className="muted small">まだありません</p>
      ) : (
        <ul className="command-list">
          {state.minecraft.recent.slice(0, 10).map((r, i) => (
            <li key={`${r.at}-${i}`} className={r.ok ? '' : 'command-error'}>
              <span className="event-time">{formatTime(r.at)}</span>
              <code>{r.command}</code>
              <div className="muted small">{r.response || '（返事なし）'}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SpeechTest() {
  const [text, setText] = useState('テストです。読み上げが聞こえたら成功です');
  return (
    <Card title="読み上げを試す">
      <p className="muted small">OBSに「読み上げ用オーバーレイ」を入れておくと、配信の音として聞こえます。</p>
      <Field label="読み上げる文">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
      </Field>
      <ActionButton kind="primary" onClick={() => api('POST', '/api/voicevox/test', { text })}>
        読み上げる
      </ActionButton>
    </Card>
  );
}
