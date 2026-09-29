// 管理画面の外枠（上のバーと、画面の切り替え）

import { useState } from 'react';
import { api, useLiveData, type AppState } from './api.ts';
import { ActionButton, StatusBadge, type Tone } from './components/ui.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { OverlaysPage } from './pages/Overlays.tsx';
import { RecordsPage } from './pages/Records.tsx';
import { RulesPage } from './pages/Rules.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { SpinnerPage } from './pages/Spinner.tsx';
import { TestPanel } from './pages/TestPanel.tsx';

const PAGES = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'rules', label: 'ルール' },
  { id: 'spinner', label: 'スピナー' },
  { id: 'test', label: 'テスト' },
  { id: 'records', label: '記録' },
  { id: 'overlays', label: 'オーバーレイ' },
  { id: 'settings', label: '設定' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export function App() {
  const { state, events, connected } = useLiveData();
  const [page, setPage] = useState<PageId>(() => (localStorage.getItem('page') as PageId | null) ?? 'dashboard');
  const [quit, setQuit] = useState(false);

  const choose = (id: PageId) => {
    setPage(id);
    localStorage.setItem('page', id);
  };

  if (quit) {
    return (
      <div className="quit-screen">
        <h1>本体を終了しました</h1>
        <p>このウィンドウは閉じてかまいません。また使う時は、デスクトップの「TikTok LIVE ツール」をダブルクリックしてください。</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">{state?.app.name ?? 'TikTok LIVE ツール'}</div>
        <nav className="tabs">
          {PAGES.map((p) => (
            <button key={p.id} type="button" className={`tab ${page === p.id ? 'tab-active' : ''}`} onClick={() => choose(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {state && <TikTokBadge state={state} />}
          <ActionButton
            kind="small"
            confirm="本体を終了すると、配信の記録も止まります。終了しますか？"
            onClick={async () => {
              await api('POST', '/api/app/quit');
              setQuit(true);
              window.setTimeout(() => window.close(), 800);
            }}
          >
            終了
          </ActionButton>
        </div>
      </header>

      {!connected && (
        <div className="banner banner-red">本体とつながっていません。本体が起動しているか確認してください（自動でつなぎ直します）</div>
      )}

      <main className="content">
        {!state ? (
          <p className="muted">読み込み中…</p>
        ) : page === 'dashboard' ? (
          <Dashboard state={state} events={events} />
        ) : page === 'rules' ? (
          <RulesPage state={state} />
        ) : page === 'spinner' ? (
          <SpinnerPage state={state} />
        ) : page === 'test' ? (
          <TestPanel state={state} />
        ) : page === 'records' ? (
          <RecordsPage state={state} />
        ) : page === 'overlays' ? (
          <OverlaysPage state={state} />
        ) : (
          <SettingsPage state={state} />
        )}
      </main>
    </div>
  );
}

/** TikTokの接続状態の、色と言葉（要件 C-5） */
export function tiktokTone(state: AppState): { tone: Tone; label: string } {
  switch (state.tiktok.status.state) {
    case 'connected':
      return { tone: 'green', label: '接続中' };
    case 'connecting':
      return { tone: 'yellow', label: '接続中（つないでいます）' };
    case 'waiting':
      return { tone: 'blue', label: '配信待ち' };
    case 'error':
      return { tone: 'red', label: 'エラー' };
    default:
      return { tone: 'gray', label: '未接続' };
  }
}

function TikTokBadge({ state }: { state: AppState }) {
  const { tone, label } = tiktokTone(state);
  return <StatusBadge tone={tone}>TikTok：{label}</StatusBadge>;
}
