// オーバーレイ（OBSのブラウザソース）とのつながり
//
// ・オーバーレイは開くと ws://127.0.0.1:<ポート>/ws/overlay?name=<名前> につないでくる
// ・本体が再起動しても、オーバーレイ側が自動でつなぎ直す（要件 O-3）
// ・設定を変えたら、つながっているオーバーレイに新しい設定を送る（要件 O-4）
// ・管理画面から、全オーバーレイを一斉に再読み込みできる（要件 O-5）

export interface OverlaySocket {
  send(data: string): void;
  close(): void;
  readyState: number;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}

export type OverlayMessage = { type: string } & Record<string, unknown>;

const OPEN = 1;
export const OVERLAY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class OverlayHub {
  private readonly clients = new Map<string, Set<OverlaySocket>>();
  private readonly ackWaiters = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private readonly settingsFor: (name: string) => Record<string, unknown>;

  constructor(settingsFor: (name: string) => Record<string, unknown>) {
    this.settingsFor = settingsFor;
  }

  /** 新しくつながってきたオーバーレイを登録する */
  add(name: string, socket: OverlaySocket): void {
    let set = this.clients.get(name);
    if (!set) {
      set = new Set();
      this.clients.set(name, set);
    }
    set.add(socket);
    socket.on('message', (raw) => this.receive(raw));
    socket.on('close', () => {
      this.clients.get(name)?.delete(socket);
      this.changed();
    });
    this.sendTo(socket, { type: 'hello', name, settings: this.settingsFor(name) });
    this.changed();
  }

  /** 指定した名前のオーバーレイ全部に送る。受け取ったオーバーレイの数を返す */
  send(name: string, message: OverlayMessage): number {
    let count = 0;
    for (const socket of this.clients.get(name) ?? []) {
      if (this.sendTo(socket, message)) count += 1;
    }
    return count;
  }

  /** つながっている全部のオーバーレイに送る */
  broadcast(message: OverlayMessage): number {
    let count = 0;
    for (const name of this.clients.keys()) count += this.send(name, message);
    return count;
  }

  /** 全オーバーレイを再読み込みさせる */
  reloadAll(): number {
    return this.broadcast({ type: 'reload' });
  }

  /** 設定が変わったことを、全オーバーレイに知らせる */
  pushSettings(): void {
    for (const name of this.clients.keys()) {
      this.send(name, { type: 'settings', settings: this.settingsFor(name) });
    }
  }

  /** 名前ごとの、つながっている数 */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, set] of this.clients) {
      if (set.size > 0) out[name] = set.size;
    }
    return out;
  }

  connected(name: string): number {
    return this.clients.get(name)?.size ?? 0;
  }

  /** オーバーレイから「終わった」の返事（例：読み上げの再生終了）が来るまで待つ。来たら true */
  waitForAck(id: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (acked: boolean) => {
        clearTimeout(timer);
        this.ackWaiters.delete(id);
        signal?.removeEventListener('abort', onAbort);
        resolve(acked);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.ackWaiters.set(id, () => finish(true));
      if (signal?.aborted) finish(false);
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(raw: unknown): void {
    let message: { type?: unknown; id?: unknown };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === 'ended' && typeof message.id === 'string') {
      this.ackWaiters.get(message.id)?.();
    }
  }

  private sendTo(socket: OverlaySocket, message: OverlayMessage): boolean {
    if (socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
