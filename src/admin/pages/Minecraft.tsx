// Minecraftの画面（要件 M-3。STEの起動ボタンの代わり）
// サーバーの起動・停止と、コンソール（サーバーの出力の表示と、コマンドの入力）。

import { useEffect, useRef, useState } from 'react';
import { api, formatTime, type AppState, type ConsoleLine } from '../api.ts';
import { ActionButton, Card, StatusBadge, type Tone } from '../components/ui.tsx';
import { minecraftTone } from './Dashboard.tsx';

export function MinecraftPage({ state, consoleLines }: { state: AppState; consoleLines: ConsoleLine[] }) {
  return (
    <div className="page-stack">
      <ServerCard state={state} />
      <ConsoleCard state={state} lines={consoleLines} />
    </div>
  );
}

/** サーバーの状態の、色と言葉 */
export function serverTone(state: AppState): { tone: Tone; label: string } {
  switch (state.minecraft.server.state) {
    case 'running':
      return { tone: 'green', label: '動いています' };
    case 'starting':
      return { tone: 'yellow', label: '起動中' };
    case 'stopping':
      return { tone: 'yellow', label: '停止中' };
    default:
      return { tone: 'gray', label: '止まっています' };
  }
}

/** 起動・停止のボタン（ダッシュボードでも使う） */
export function ServerButtons({ state }: { state: AppState }) {
  const server = state.minecraft.server;
  if (server.state === 'stopped') {
    return (
      <ActionButton kind="small" disabled={!server.configured} onClick={() => api('POST', '/api/minecraft/server/start')}>
        サーバーを起動
      </ActionButton>
    );
  }
  return (
    <>
      <ActionButton
        kind="small"
        disabled={server.state === 'stopping'}
        confirm="Minecraftサーバーを止めますか？（ワールドを保存してから止めます）"
        onClick={() => api('POST', '/api/minecraft/server/stop')}
      >
        サーバーを停止
      </ActionButton>
      {server.state === 'stopping' && (
        <ActionButton
          kind="danger"
          confirm="保存を待たずに、すぐ止めますか？（最後に保存してからの変更は失われます。固まって止まらない時だけ使ってください）"
          onClick={() => api('POST', '/api/minecraft/server/kill')}
        >
          強制終了
        </ActionButton>
      )}
    </>
  );
}

function ServerCard({ state }: { state: AppState }) {
  const server = state.minecraft.server;
  const tone = serverTone(state);
  const rcon = minecraftTone(state);
  const settings = state.settings.minecraft;
  return (
    <Card title="Minecraftサーバー">
      <div className="button-row">
        <StatusBadge tone={tone.tone}>サーバー：{tone.label}</StatusBadge>
        <StatusBadge tone={rcon.tone}>RCON：{rcon.label}</StatusBadge>
      </div>
      <p className="status-message">
        {server.message}
        {server.startedAt && server.state !== 'stopped' && <span className="muted small">（{formatTime(server.startedAt)} に起動）</span>}
      </p>
      {server.hint && <p className="status-hint">{server.hint}</p>}
      {!server.configured && (
        <p className="status-hint">「設定」→「Minecraft」の「サーバーのフォルダ」を入力すると、ここから起動できるようになります</p>
      )}
      {server.configured && (
        <p className="muted small">
          フォルダ：<code>{settings.serverFolder}</code>　メモリ：{settings.memoryGb}GB
        </p>
      )}
      <div className="button-row">
        <ServerButtons state={state} />
      </div>
      <p className="muted small">
        本体を終了すると、サーバーも止まります（先にワールドを保存します）。本体の外で起動したサーバーは、ここからは止められません。
      </p>
    </Card>
  );
}

function ConsoleCard({ state, lines }: { state: AppState; lines: ConsoleLine[] }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const running = state.minecraft.server.state !== 'stopped';

  // いちばん下を見ている時だけ、新しい行に合わせて下へ送る（上を読んでいる時は動かさない）
  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const send = async () => {
    const line = input.trim();
    if (!line) return;
    setError(null);
    try {
      await api('POST', '/api/minecraft/server/console', { line });
      setHistory((prev) => [line, ...prev.filter((h) => h !== line)].slice(0, 50));
      setHistoryIndex(-1);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card title="コンソール">
      <div
        ref={box}
        className="console"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
      >
        {lines.length === 0 ? (
          <div className="console-empty">まだ何も出ていません。サーバーを起動すると、ここに出力が流れます</div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`console-line console-${line.kind}`}>
              {line.kind === 'in' ? `> ${line.text}` : line.text}
            </div>
          ))
        )}
      </div>
      <form
        className="console-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          disabled={!running}
          maxLength={1000}
          placeholder={running ? 'コマンドを入力して Enter（例：list、time set day）。↑↓で前のコマンド' : 'サーバーが動いている時に使えます'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // ↑↓で、前に送ったコマンドを呼び出す
            if (e.key === 'ArrowUp' && history.length > 0) {
              e.preventDefault();
              const next = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(next);
              setInput(history[next]);
            } else if (e.key === 'ArrowDown' && historyIndex >= 0) {
              e.preventDefault();
              const next = historyIndex - 1;
              setHistoryIndex(next);
              setInput(next >= 0 ? history[next] : '');
            }
          }}
        />
        <button type="submit" className="button button-primary" disabled={!running || !input.trim()}>
          送る
        </button>
      </form>
      {error && <p className="action-error">{error}</p>}
      <p className="muted small">
        ここはサーバーのコンソールと同じです（先頭の / は要りません）。配信のルールから送るコマンドはRCONを通るので、ここには出ません。
      </p>
    </Card>
  );
}
