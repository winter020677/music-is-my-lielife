// Minecraft（要件 6.7）
//
// ・RCONでPaperサーバーにつなぎ、状態を管理画面に出す。切れたら自動でつなぎ直す（要件 M-1）
// ・コマンドは順番待ちに入れて、1秒あたりの上限を守って送る（要件 Q-3）
//   ギフトが一度に100個来ても、サーバーが固まらないようにするため
// ・最近送ったコマンドと返事を覚えておき、管理画面に出す（テスト用。要件 M-2）

import { describeError, type AreaLogger } from '../../core/logger.ts';
import { ActionQueue } from '../../core/queue.ts';
import type { Settings } from '../../config/settings.ts';
import { RconAuthError, RconClient } from './rcon.ts';

export type MinecraftStatus =
  | { state: 'disabled'; message: string }
  | { state: 'no-password'; message: string; hint: string }
  | { state: 'connecting'; message: string }
  | { state: 'connected'; message: string }
  | { state: 'error'; message: string; hint: string; nextRetryAt: string | null };

export interface CommandResult {
  at: string;
  command: string;
  ok: boolean;
  response: string;
}

const RETRY_DELAYS_SEC = [5, 10, 30, 60];
const RECENT_LIMIT = 30;

export interface RconLike {
  connected: boolean;
  connect(): Promise<void>;
  send(command: string): Promise<string>;
  close(): void;
  onClose(listener: (reason: string) => void): void;
}

export class MinecraftService {
  readonly queue: ActionQueue<{ command: string }>;
  private readonly getSettings: () => Settings['minecraft'];
  private readonly getPassword: () => string;
  private readonly log: AreaLogger;
  private readonly createClient: (options: { host: string; port: number; password: string }) => RconLike;
  private client: RconLike | null = null;
  private status: MinecraftStatus = { state: 'disabled', message: '使わない設定です' };
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private generation = 0;
  private readonly recent: CommandResult[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(options: {
    getSettings: () => Settings['minecraft'];
    getPassword: () => string;
    log: AreaLogger;
    createClient?: (options: { host: string; port: number; password: string }) => RconLike;
  }) {
    this.getSettings = options.getSettings;
    this.getPassword = options.getPassword;
    this.log = options.log;
    this.createClient = options.createClient ?? ((o) => new RconClient(o));
    this.queue = new ActionQueue({
      name: 'minecraft',
      label: 'Minecraft',
      log: this.log,
      minIntervalMs: () => 1000 / Math.max(1, this.getSettings().maxCommandsPerSecond),
      run: async ({ command }) => {
        await this.execute(command);
      },
    });
  }

  getStatus(): MinecraftStatus {
    return this.status;
  }

  recentResults(): CommandResult[] {
    return [...this.recent].reverse();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 設定に合わせて、つなぎ直す（起動時・設定やパスワードを変えた時） */
  restart(): void {
    this.generation += 1;
    this.failures = 0;
    this.clearRetry();
    this.client?.close();
    this.client = null;
    const settings = this.getSettings();
    if (!settings.enabled) {
      this.setStatus({ state: 'disabled', message: '使わない設定です' });
      return;
    }
    if (!this.getPassword()) {
      this.setStatus({
        state: 'no-password',
        message: 'RCONのパスワードが未設定です',
        hint: '設定画面の「秘密情報」に、server.properties の rcon.password と同じものを入力してください',
      });
      return;
    }
    void this.connect(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.clearRetry();
    this.client?.close();
    this.client = null;
  }

  /** コマンドを1つ、すぐに送る（順番待ちを通さない。テストボタン用） */
  async execute(command: string): Promise<string> {
    const at = new Date().toISOString();
    try {
      if (!this.client?.connected) throw new Error('Minecraftにつながっていません。サーバーが起動しているか確認してください');
      const response = await this.client.send(command);
      this.remember({ at, command, ok: true, response });
      return response;
    } catch (err) {
      this.remember({ at, command, ok: false, response: describeError(err) });
      throw err;
    }
  }

  /** コマンドを順番待ちに入れる（上限の速さで送られる） */
  enqueue(commands: string[], label: string, onDone?: (error: unknown) => void): void {
    if (commands.length === 0) {
      onDone?.(null);
      return;
    }
    let remaining = commands.length;
    let firstError: unknown = null;
    commands.forEach((command, i) => {
      this.queue.push({ command }, commands.length > 1 ? `${label}（${i + 1}/${commands.length}）` : label, {
        onDone: (error) => {
          if (error && !firstError) firstError = error;
          remaining -= 1;
          if (remaining === 0) onDone?.(firstError);
        },
      });
    });
  }

  private async connect(generation: number): Promise<void> {
    const settings = this.getSettings();
    this.setStatus({ state: 'connecting', message: 'Minecraftにつないでいます…' });
    const client = this.createClient({ host: settings.host, port: settings.port, password: this.getPassword() });
    try {
      await client.connect();
    } catch (err) {
      client.close();
      if (generation !== this.generation) return;
      this.failures += 1;
      if (err instanceof RconAuthError) {
        this.scheduleRetry(generation, 60, 'RCONのパスワードが違います', 'server.properties の rcon.password と、設定画面の秘密情報が同じか確認してください');
      } else {
        const delay = RETRY_DELAYS_SEC[Math.min(this.failures - 1, RETRY_DELAYS_SEC.length - 1)];
        this.scheduleRetry(
          generation,
          delay,
          `Minecraftにつながりません（${describeError(err)}）`,
          'サーバーが起動しているか、server.properties で enable-rcon=true になっているか確認してください',
        );
      }
      return;
    }
    if (generation !== this.generation) {
      client.close();
      return;
    }
    this.client = client;
    this.failures = 0;
    client.onClose((reason) => {
      if (generation !== this.generation) return;
      this.client = null;
      this.log.warn(`Minecraftとの接続が切れました（${reason}）`);
      this.scheduleRetry(generation, RETRY_DELAYS_SEC[0], 'Minecraftとの接続が切れました', '自動でつなぎ直します');
    });
    this.log.info(`Minecraftにつながりました（${settings.host}:${settings.port}）`);
    this.setStatus({ state: 'connected', message: `接続中（${settings.host}:${settings.port}）` });
  }

  private scheduleRetry(generation: number, delaySec: number, message: string, hint: string): void {
    this.clearRetry();
    this.setStatus({ state: 'error', message, hint, nextRetryAt: new Date(Date.now() + delaySec * 1000).toISOString() });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation) void this.connect(generation);
    }, delaySec * 1000);
    this.retryTimer.unref();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private remember(result: CommandResult): void {
    this.recent.push(result);
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    this.changed();
  }

  private setStatus(status: MinecraftStatus): void {
    this.status = status;
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
