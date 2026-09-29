// ダッシュボード：配信中に見る画面（要件 U-2）
// 接続状態・直近のイベント・順番待ちの操作・今日の集計を1画面にまとめる。

import { useState } from 'react';
import { api, formatDuration, formatNumber, formatTime, type AppState, type DisplayEvent } from '../api.ts';
import { tiktokTone } from '../App.tsx';
import { ActionButton, Card, Stat, StatusBadge, type Tone } from '../components/ui.tsx';

export function Dashboard({ state, events }: { state: AppState; events: DisplayEvent[] }) {
  return (
    <div className="dashboard">
      <StatusRow state={state} />
      <div className="dashboard-main">
        <EventsCard events={events} />
        <div className="dashboard-side">
          <ControlsCard state={state} />
          <QueueCard state={state} />
          <RuleRunCard state={state} />
          <TodayCard state={state} />
        </div>
      </div>
      {state.problems.length > 0 && <ProblemsCard state={state} />}
    </div>
  );
}

function StatusRow({ state }: { state: AppState }) {
  const tiktok = tiktokTone(state);
  const status = state.tiktok.status;
  const mc = minecraftTone(state);
  const speech = speechTone(state);
  const euler = state.euler;
  const percent = Math.min(100, Math.round((euler.used / Math.max(1, euler.limit)) * 100));

  return (
    <div className="status-row">
      <Card title="TikTok">
        <StatusBadge tone={tiktok.tone}>{tiktok.label}</StatusBadge>
        <p className="status-message">{status.message}</p>
        {status.state === 'error' && <p className="status-hint">{status.hint}</p>}
        {!state.secrets.EULER_API_KEY && status.state !== 'error' && (
          <p className="status-hint">Euler StreamのAPIキーが未設定です（「設定」→「秘密情報」）。配信が始まってもつなげません</p>
        )}
        <p className="muted small">
          {state.tiktok.username ? `@${state.tiktok.username.replace(/^@/, '')}` : 'ユーザー名：未設定'}
          {state.tiktok.viewers !== null && `　視聴者 ${formatNumber(state.tiktok.viewers)}人`}
        </p>
        <div className="button-row">
          {status.state === 'connected' || status.state === 'connecting' ? (
            <ActionButton kind="small" confirm="TikTokとの接続を切りますか？（記録も止まります）" onClick={() => api('POST', '/api/tiktok/disconnect')}>
              切断
            </ActionButton>
          ) : (
            <ActionButton kind="small" onClick={() => api('POST', '/api/tiktok/connect')}>
              接続
            </ActionButton>
          )}
        </div>
      </Card>

      <Card title="Minecraft">
        <StatusBadge tone={mc.tone}>{mc.label}</StatusBadge>
        <p className="status-message">{state.minecraft.status.message}</p>
        {'hint' in state.minecraft.status && <p className="status-hint">{state.minecraft.status.hint}</p>}
      </Card>

      <Card title="読み上げ（VOICEVOX）">
        <StatusBadge tone={speech.tone}>{speech.label}</StatusBadge>
        <p className="status-message">{state.speech.message}</p>
        {state.speech.state === 'error' && <p className="status-hint">{state.speech.hint}</p>}
      </Card>

      <Card title="オーバーレイ">
        <OverlayCount name="alert" label="アラート" state={state} />
        <OverlayCount name="speech" label="読み上げ" state={state} />
        <div className="button-row">
          <ActionButton kind="small" onClick={() => api('POST', '/api/overlays/reload')}>
            全部を再読み込み
          </ActionButton>
        </div>
      </Card>

      <Card title="Euler Stream（今日の使用）">
        <div className={`meter ${euler.warning ? 'meter-warn' : ''}`}>
          <div className="meter-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="status-message">
          {formatNumber(euler.used)} / {formatNumber(euler.limit)} 回（{percent}%）
        </p>
        {euler.remote?.day && (
          <p className="muted small">Euler Streamによると残り {formatNumber(euler.remote.day.remaining)} 回</p>
        )}
        {euler.warning && <p className="status-hint">8割を超えました。配信待ちの確認では使わないようにしています</p>}
      </Card>
    </div>
  );
}

function OverlayCount({ name, label, state }: { name: string; label: string; state: AppState }) {
  const count = state.overlays[name] ?? 0;
  return (
    <p className="status-message">
      <StatusBadge tone={count > 0 ? 'green' : 'gray'}>
        {label}：{count > 0 ? `${count}つ表示中` : 'OBSにありません'}
      </StatusBadge>
    </p>
  );
}

export function minecraftTone(state: AppState): { tone: Tone; label: string } {
  switch (state.minecraft.status.state) {
    case 'connected':
      return { tone: 'green', label: '接続中' };
    case 'connecting':
      return { tone: 'yellow', label: 'つないでいます' };
    case 'no-password':
      return { tone: 'yellow', label: '未設定' };
    case 'error':
      return { tone: 'red', label: 'エラー' };
    default:
      return { tone: 'gray', label: '使わない' };
  }
}

export function speechTone(state: AppState): { tone: Tone; label: string } {
  switch (state.speech.state) {
    case 'ok':
      return { tone: 'green', label: '接続中' };
    case 'error':
      return { tone: 'red', label: 'エラー' };
    default:
      return { tone: 'gray', label: '使わない' };
  }
}

const KIND_TONE: Record<string, string> = {
  gift: 'kind-gift',
  like: 'kind-like',
  comment: 'kind-comment',
  follow: 'kind-follow',
  share: 'kind-share',
  join: 'kind-join',
  subscribe: 'kind-subscribe',
  streamEnd: 'kind-end',
};

/** いいね・入室は数が多いので、表示するかを選べるようにする（選んだものは覚えておく） */
function EventsCard({ events }: { events: DisplayEvent[] }) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('hiddenKinds') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (kind: string) => {
    const next = hidden.includes(kind) ? hidden.filter((k) => k !== kind) : [...hidden, kind];
    setHidden(next);
    localStorage.setItem('hiddenKinds', JSON.stringify(next));
  };
  return (
    <Card
      title="直近のイベント"
      className="events-card"
      actions={
        <>
          {[
            ['like', 'いいね'],
            ['join', '入室'],
          ].map(([kind, label]) => (
            <label key={kind} className="inline-check">
              <input type="checkbox" checked={!hidden.includes(kind)} onChange={() => toggle(kind)} />
              {label}
            </label>
          ))}
        </>
      }
    >
      <EventList events={events.filter((e) => !hidden.includes(e.kind))} />
    </Card>
  );
}

function EventList({ events }: { events: DisplayEvent[] }) {
  if (events.length === 0) {
    return <p className="muted">まだイベントはありません。配信につながるか、「テスト」画面で試すと、ここに出ます。</p>;
  }
  return (
    <ul className="event-list">
      {events.map((e) => (
        <li key={e.id} className="event">
          <span className="event-time">{formatTime(e.at)}</span>
          <span className={`event-kind ${KIND_TONE[e.kind] ?? ''}`}>{e.label}</span>
          {e.imageUrl && <img className="event-image" src={e.imageUrl} alt="" />}
          <span className="event-name">{e.name}</span>
          <span className="event-detail">{e.detail}</span>
          {e.isTest && <span className="tag tag-test">テスト</span>}
          {e.late && <span className="tag tag-late">遅れて届いた</span>}
        </li>
      ))}
    </ul>
  );
}

/** 配信中によく使う操作をまとめたところ（要件 U-2） */
function ControlsCard({ state }: { state: AppState }) {
  const sets = state.settings.rules.sets;
  const activeId = sets.find((s) => s.id === state.settings.rules.activeSetId)?.id ?? sets[0]?.id ?? '';

  return (
    <Card title="操作">
      {sets.length > 0 && (
        <div className="control-row">
          <span className="control-label">ルールのセット</span>
          <select
            value={activeId}
            onChange={(e) => void api('POST', '/api/rules/active-set', { id: e.target.value })}
          >
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.rules.length}）
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="control-row">
        <span className="control-label">スピナー</span>
        <ActionButton kind="small" disabled={!state.spinner.ready} onClick={() => api('POST', '/api/spinner/spin')}>
          回す
        </ActionButton>
        {state.spinner.lastResult ? (
          <span className="muted small">前回：{state.spinner.lastResult.name}</span>
        ) : (
          !state.spinner.ready && <span className="muted small">「スピナー」画面で使う設定にしてください</span>
        )}
      </div>
      <div className="control-row">
        <span className="control-label">オーバーレイ</span>
        <ActionButton kind="small" onClick={() => api('POST', '/api/overlays/reload')}>
          全部を再読み込み
        </ActionButton>
      </div>
    </Card>
  );
}

function QueueCard({ state }: { state: AppState }) {
  return (
    <Card title="順番待ち">
      <table className="queue-table">
        <tbody>
          {state.queues.map((q) => (
            <tr key={q.name}>
              <th>{q.label}</th>
              <td>
                {q.paused ? <StatusBadge tone="yellow">一時停止中</StatusBadge> : q.running ? '処理中' : '待機'}
                <div className="muted small">
                  待ち {q.pending}件{q.running ? `・今：${q.running}` : ''}
                </div>
              </td>
              <td className="queue-buttons">
                {q.paused ? (
                  <ActionButton kind="small" onClick={() => api('POST', `/api/queues/${q.name}/resume`)}>
                    再開
                  </ActionButton>
                ) : (
                  <ActionButton kind="small" onClick={() => api('POST', `/api/queues/${q.name}/pause`)}>
                    一時停止
                  </ActionButton>
                )}
                <ActionButton kind="small" onClick={() => api('POST', `/api/queues/${q.name}/skip`)}>
                  スキップ
                </ActionButton>
                <ActionButton kind="small" confirm={`${q.label}の順番待ちを全部消しますか？`} onClick={() => api('POST', `/api/queues/${q.name}/clear`)}>
                  全消去
                </ActionButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const RESULT_LABEL: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: 'green', label: '成功' },
  partial: { tone: 'yellow', label: '一部失敗' },
  error: { tone: 'red', label: '失敗' },
  skipped: { tone: 'gray', label: '何もしない' },
};

function RuleRunCard({ state }: { state: AppState }) {
  return (
    <Card title="ルールの発動">
      {state.ruleRuns.length === 0 ? (
        <p className="muted small">まだありません</p>
      ) : (
        <ul className="run-list">
          {state.ruleRuns.slice(0, 8).map((run, i) => {
            const result = RESULT_LABEL[run.result] ?? { tone: 'gray' as Tone, label: run.result };
            return (
              <li key={`${run.at}-${i}`}>
                <span className="event-time">{formatTime(run.at)}</span>
                <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                <span>
                  {run.triggerViewer ?? ''} {run.triggerDetail ?? ''}
                </span>
                {run.isTest && <span className="tag tag-test">テスト</span>}
                {run.message && <div className="run-message">{run.message}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TodayCard({ state }: { state: AppState }) {
  const t = state.today;
  return (
    <Card title="今日の集計（日本時間・テストを除く）">
      {!t ? (
        <p className="muted small">読めませんでした</p>
      ) : (
        <div className="stats">
          <Stat label="配信" value={`${t.streams}回`} />
          <Stat label="配信時間" value={formatDuration(t.durationSec)} />
          <Stat label="コイン" value={formatNumber(t.coins)} />
          <Stat label="いいね" value={formatNumber(t.likes)} />
          <Stat label="コメント" value={formatNumber(t.comments)} />
          <Stat label="新規フォロー" value={formatNumber(t.follows)} />
          <Stat label="来場者" value={formatNumber(t.visitors)} note="何か届いた人の数" />
          <Stat label="最大視聴者" value={formatNumber(t.maxViewers)} />
        </div>
      )}
    </Card>
  );
}

function ProblemsCard({ state }: { state: AppState }) {
  return (
    <Card title="最近の注意・エラー">
      <ul className="problem-list">
        {state.problems.map((p, i) => (
          <li key={`${p.at}-${i}`} className={p.level === 'error' ? 'problem-error' : 'problem-warn'}>
            <span className="event-time">{formatTime(p.at)}</span>
            <span className="problem-area">[{p.area}]</span> {p.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}
