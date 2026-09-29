// 管理画面から本体への問い合わせ

import { useEffect, useRef, useState } from 'react';
import type { ConsoleLine } from '../server/actions/minecraft/serverProcess.ts';
import type { AppState, DisplayEvent, RuleRunNotice } from '../server/app.ts';
import type { LogEntry } from '../server/core/logger.ts';

export type { AppState, ConsoleLine, DisplayEvent, LogEntry, RuleRunNotice };
export type Settings = AppState['settings'];

/** 本体のAPIを呼ぶ。失敗したら日本語のエラーを投げる */
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('本体とつながりません。本体が起動しているか確認してください');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string[] };
  if (!res.ok) throw new Error(data.error ? `${data.error}${data.detail ? `（${data.detail.join(' / ')}）` : ''}` : `エラー（HTTP ${res.status}）`);
  return data as T;
}

export interface LiveData {
  state: AppState | null;
  events: DisplayEvent[];
  /** Minecraftサーバーのコンソール（要件 M-3） */
  consoleLines: ConsoleLine[];
  connected: boolean;
}

const CONSOLE_LIMIT = 1000;

/** 手元の行に、新しい行を足す（同じ行を二重に足さない） */
function mergeConsole(prev: ConsoleLine[], next: ConsoleLine[]): ConsoleLine[] {
  const lastId = prev.length > 0 ? prev[prev.length - 1].id : 0;
  const added = next.filter((line) => line.id > lastId);
  return added.length === 0 ? prev : [...prev, ...added].slice(-CONSOLE_LIMIT);
}

/**
 * 本体とWebSocketでつないで、状態を受け取り続ける。
 * 切れたら自動でつなぎ直す。
 */
export function useLiveData(): LiveData {
  const [state, setState] = useState<AppState | null>(null);
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let stopped = false;

    const open = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
      socket.onopen = () => {
        retry.current = 0;
        setConnected(true);
        // つながるたびに、それまでのコンソールの行を取り直す（本体が再起動していると番号が振り直されるため）。
        // 取っている間に届いた行は、取った行のうしろに足す
        setConsoleLines([]);
        api<{ lines: ConsoleLine[] }>('GET', '/api/minecraft/server/console')
          .then((r) => setConsoleLines((prev) => mergeConsole(r.lines, prev)))
          .catch(() => {});
      };
      socket.onmessage = (e) => {
        const message = JSON.parse(String(e.data)) as
          | { type: 'state'; state: AppState }
          | { type: 'event'; event: DisplayEvent }
          | { type: 'ruleRun'; run: RuleRunNotice }
          | { type: 'log'; entry: LogEntry }
          | { type: 'console'; lines: ConsoleLine[] };
        if (message.type === 'state') {
          setState(message.state);
          setEvents((prev) => (prev.length === 0 ? message.state.events : prev));
        } else if (message.type === 'event') {
          setEvents((prev) => [message.event, ...prev].slice(0, 200));
        } else if (message.type === 'ruleRun') {
          setState((prev) => (prev ? { ...prev, ruleRuns: [message.run, ...prev.ruleRuns].slice(0, 30) } : prev));
        } else if (message.type === 'console') {
          setConsoleLines((prev) => mergeConsole(prev, message.lines));
        } else if (message.type === 'log') {
          setState((prev) => (prev ? { ...prev, problems: [message.entry, ...prev.problems].slice(0, 20) } : prev));
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        const delay = [1000, 2000, 5000][Math.min(retry.current, 2)];
        retry.current += 1;
        timer = window.setTimeout(open, delay);
      };
    };
    open();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { state, events, consoleLines, connected };
}

// ───────── 表示の道具 ─────────

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** 日本時間の「時:分:秒」 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '―';
  return timeFormat.format(new Date(iso));
}

/** 日本時間の「年/月/日(曜) 時:分」 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '―';
  return dateTimeFormat.format(new Date(iso));
}

/** 秒 → 「1時間23分」 */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '―';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? '―' : n.toLocaleString('ja-JP');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
