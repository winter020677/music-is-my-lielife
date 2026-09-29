// 本体の組み立て
// 設定・記録・TikTok接続・演出・Minecraft・読み上げを作って、つなぎ合わせる。
//
// イベントの流れ：
//   TikTok（またはテストパネル）→ emit() → ① ルール（演出・コマンド・読み上げ）
//                                        → ② 記録（データベース）
//                                        → ③ 管理画面への表示
// ルールを先に動かすのは、演出をなるべく早く始めるため（要件 N-1）。

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlertService } from './actions/alerts.ts';
import { MinecraftService } from './actions/minecraft/service.ts';
import { OverlayHub, type OverlaySocket } from './actions/overlayHub.ts';
import { SpeechService } from './actions/voicevox.ts';
import type { AppPaths } from './config/paths.ts';
import { SecretStore } from './config/secrets.ts';
import { SettingsStore, type Settings } from './config/settings.ts';
import { EVENT_LABELS, type LiveEvent } from './core/events.ts';
import { describeError, type Logger } from './core/logger.ts';
import { cleanText } from './core/sanitize.ts';
import { toIso } from './core/time.ts';
import { BackupManager, copyDatabase } from './db/backup.ts';
import { DailyCounters } from './db/counters.ts';
import { openDatabase, type Db } from './db/database.ts';
import { migrate, pendingMigrations } from './db/migrations.ts';
import { daySummary } from './db/queries.ts';
import { Recorder, type RuleRunRecord } from './db/recorder.ts';
import { activeSet, defaultOverlayLook } from './config/rules.ts';
import { MediaService } from './actions/media.ts';
import { SpinnerService } from './actions/spinner.ts';
import { MediaStore } from './actions/mediaStore.ts';
import { RuleEngine } from './rules/engine.ts';
import type { TikTokClient } from './tiktok/client.ts';
import { ConnectorClient } from './tiktok/connectorClient.ts';
import { EulerUsage } from './tiktok/eulerUsage.ts';
import { LiveWatcher } from './tiktok/liveWatcher.ts';
import { EventPipeline } from './tiktok/pipeline.ts';

export const APP_NAME = 'TikTok LIVE ツール';

/** 管理画面に出すイベント（表示用に整えたもの） */
export interface DisplayEvent {
  id: number;
  at: string;
  kind: LiveEvent['kind'];
  label: string;
  name: string;
  detail: string;
  imageUrl: string | null;
  isTest: boolean;
  late: boolean;
}

/** 管理画面に出すルールの発動（表示用） */
export interface RuleRunNotice {
  at: string;
  isTest: boolean;
  ruleName: string;
  triggerKind: string;
  triggerViewer: string | null;
  triggerDetail: string | null;
  actions: string[];
  result: string;
  message: string | null;
}

export interface AdminSocket {
  send(data: string): void;
  readyState: number;
  on(event: 'close', listener: () => void): unknown;
}

const RECENT_EVENTS = 200;

export class App {
  readonly paths: AppPaths;
  readonly logger: Logger;
  readonly port: number;
  readonly version: string;
  readonly startedAt = new Date().toISOString();
  readonly secrets: SecretStore;
  readonly settings: SettingsStore;
  readonly db: Db;
  readonly recorder: Recorder;
  readonly counters: DailyCounters;
  readonly euler: EulerUsage;
  readonly client: TikTokClient;
  readonly pipeline: EventPipeline;
  readonly watcher: LiveWatcher;
  readonly hub: OverlayHub;
  readonly alerts: AlertService;
  readonly mediaStore: MediaStore;
  readonly media: MediaService;
  readonly spinner: SpinnerService;
  readonly minecraft: MinecraftService;
  readonly speech: SpeechService;
  readonly rule: RuleEngine;
  readonly backups: BackupManager;

  private readonly adminSockets = new Set<AdminSocket>();
  private readonly recentEvents: DisplayEvent[] = [];
  private readonly recentRuns: RuleRunNotice[] = [];
  private eventSerial = 0;
  private currentViewers: number | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private quitHandler: (() => void) | null = null;

  private constructor(options: {
    paths: AppPaths;
    logger: Logger;
    port: number;
    secrets: SecretStore;
    settings: SettingsStore;
    db: Db;
    client?: TikTokClient;
  }) {
    this.paths = options.paths;
    this.logger = options.logger;
    this.port = options.port;
    this.secrets = options.secrets;
    this.settings = options.settings;
    this.db = options.db;
    this.version = readVersion(options.paths.projectRoot);
    const log = (area: string) => this.logger.area(area);

    this.counters = new DailyCounters(this.db);
    this.recorder = new Recorder(this.db, log('記録'));
    this.euler = new EulerUsage(this.counters, () => this.settings.get().tiktok.eulerDailyLimit, log('Euler'));
    this.client = options.client ?? new ConnectorClient((route) => this.euler.record(route));
    this.client.setApiKey(this.secrets.get('EULER_API_KEY'));
    this.pipeline = new EventPipeline({
      recorder: this.recorder,
      emit: (event) => this.emit(event),
      counters: this.counters,
      log: log('TikTok'),
      getLateSec: () => this.settings.get().records.lateEventSec,
    });
    this.watcher = new LiveWatcher({
      client: this.client,
      pipeline: this.pipeline,
      euler: this.euler,
      counters: this.counters,
      log: log('TikTok'),
      getSettings: () => this.settings.get().tiktok,
      getApiKey: () => this.secrets.get('EULER_API_KEY'),
      onLiveState: (liveRoomId) => this.recorder.reconcileOpenStreams(liveRoomId),
    });

    this.hub = new OverlayHub((name) => this.overlaySettings(name));
    this.alerts = new AlertService({ hub: this.hub, getSettings: () => this.settings.get().alert, log: log('演出') });
    this.mediaStore = new MediaStore(this.paths.mediaDir);
    this.media = new MediaService({ hub: this.hub, store: this.mediaStore, log: log('メディア') });
    this.spinner = new SpinnerService({ hub: this.hub, getSettings: () => this.settings.get().spinner, log: log('スピナー') });
    this.minecraft = new MinecraftService({
      getSettings: () => this.settings.get().minecraft,
      getPassword: () => this.secrets.get('MINECRAFT_RCON_PASSWORD'),
      log: log('Minecraft'),
    });
    this.speech = new SpeechService({ getSettings: () => this.settings.get().voicevox, hub: this.hub, log: log('読み上げ') });
    this.rule = new RuleEngine({
      getSettings: () => this.settings.get(),
      alerts: this.alerts,
      media: this.media,
      spinner: this.spinner,
      minecraft: this.minecraft,
      speech: this.speech,
      onRun: (run) => this.recordRuleRun(run),
    });
    this.backups = new BackupManager({
      db: this.db,
      defaultFolder: this.paths.defaultBackupDir,
      getFolder: () => this.settings.get().records.backupFolder,
      getKeep: () => this.settings.get().records.backupKeep,
      log: log('バックアップ'),
    });

    // 状態が変わったら、管理画面に知らせる
    const changed = () => this.scheduleStatePush();
    this.watcher.onStatus(changed);
    this.euler.onChange(changed);
    this.minecraft.onChange(changed);
    this.speech.onChange(changed);
    this.hub.onChange(changed);
    for (const queue of [this.alerts.queue, this.media.queue, this.spinner.queue, this.minecraft.queue, this.speech.queue]) {
      queue.onChange(changed);
    }
    this.spinner.onChange(changed);
    this.logger.onEntry((entry) => {
      if (entry.level !== 'info') this.broadcastAdmin({ type: 'log', entry });
    });

    // 設定・秘密情報が変わったら、関係するところをやり直す
    this.settings.onChange((next, prev) => this.applySettings(next, prev));
    this.secrets.onChange((changedKeys) => {
      this.logger.setSecrets(this.secrets.allSecretValues());
      if (changedKeys.includes('EULER_API_KEY')) {
        this.client.setApiKey(this.secrets.get('EULER_API_KEY'));
        void this.watcher.start();
        void this.watcher.refreshRateLimits();
      }
      if (changedKeys.includes('MINECRAFT_RCON_PASSWORD')) this.minecraft.restart();
      this.scheduleStatePush();
    });
  }

  /** データベースを開いて（必要なら構造を移行して）、本体を作る */
  static async create(options: { paths: AppPaths; logger: Logger; port: number; client?: TikTokClient }): Promise<App> {
    const log = options.logger.area('起動');
    const secrets = new SecretStore(options.paths.envFile);
    secrets.load();
    options.logger.setSecrets(secrets.allSecretValues());
    const settings = new SettingsStore(options.paths.settingsFile, options.paths.defaultBackupDir, options.logger.area('設定'));
    settings.load();

    const db = openDatabase(options.paths.dbFile);
    const pending = pendingMigrations(db);
    const hasData = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'streams'").get() as {
      n: number;
    }).n;
    if (pending.length > 0 && hasData > 0) {
      // 表の構造を変える前に、必ずバックアップを取る（CLAUDE.md の約束）
      const file = join(options.paths.defaultBackupDir, `live-before-v${pending[0].version}-${Date.now()}.db`);
      await copyDatabase(db, file);
      log.info(`表の構造を変える前にバックアップを作りました: ${file}`);
    }
    const result = migrate(db);
    if (result.from !== result.to) log.info(`データベースの構造を 版${result.from} → 版${result.to} にしました`);
    return new App({ ...options, secrets, settings, db });
  }

  /** 各機能を動かし始める */
  start(): void {
    this.recorder.start();
    this.minecraft.restart();
    this.speech.restart();
    this.backups.start();
    this.settings.dailyBackup(this.settings.get().records.backupKeep);
    this.dailyTimer = setInterval(() => this.settings.dailyBackup(this.settings.get().records.backupKeep), 60 * 60 * 1000);
    this.dailyTimer.unref();
    void this.watcher.start();
    if (this.secrets.get('EULER_API_KEY')) void this.watcher.refreshRateLimits();
  }

  async stop(): Promise<void> {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    await this.watcher.shutdown().catch(() => {});
    this.minecraft.stop();
    this.speech.stop();
    this.backups.stop();
    this.recorder.stop();
    this.db.close();
  }

  /** 「終了」ボタンが押された時に呼ぶ処理を登録する（main.ts が使う） */
  onQuit(handler: () => void): void {
    this.quitHandler = handler;
  }

  requestQuit(): void {
    this.quitHandler?.();
  }

  // ───────── イベント ─────────

  /** イベントを流す（TikTokからも、テストパネルからも、ここを通る） */
  emit(event: LiveEvent): void {
    try {
      this.rule.handle(event);
    } catch (err) {
      this.logger.area('ルール').error('ルールの処理中にエラー', err);
    }
    try {
      this.recorder.handle(event);
    } catch (err) {
      this.logger.area('記録').error('記録中にエラー', err);
    }
    if (event.kind === 'viewers') {
      if (!event.isTest) {
        this.currentViewers = event.count;
        this.scheduleStatePush();
      }
      return;
    }
    if (event.kind === 'gift' && event.count <= 0) return;
    const display = toDisplay(event, ++this.eventSerial);
    this.recentEvents.push(display);
    if (this.recentEvents.length > RECENT_EVENTS) this.recentEvents.shift();
    this.broadcastAdmin({ type: 'event', event: display });
  }

  private recordRuleRun(run: RuleRunRecord): void {
    this.recorder.recordRuleRun(run);
    const notice: RuleRunNotice = {
      at: run.at,
      isTest: run.isTest,
      ruleName: run.ruleName,
      triggerKind: run.triggerKind,
      triggerViewer: run.triggerViewer?.nickname || run.triggerViewer?.uniqueId || null,
      triggerDetail: run.triggerDetail,
      actions: run.actions,
      result: run.result,
      message: run.message,
    };
    this.recentRuns.push(notice);
    if (this.recentRuns.length > 30) this.recentRuns.shift();
    this.broadcastAdmin({ type: 'ruleRun', run: notice });
  }

  /** テストパネルから、にせのイベントを作って流す（要件 U-3、D-8） */
  /**
   * 管理画面の「テスト」ボタン（要件 U-4）。
   * ルール（またはスピナーの項目）の「やること」を、テストのイベントで動かす。
   */
  testActions(target: { kind: 'rule' | 'spinnerItem'; id: string; actionIndex: number | null }): { ok: true } | { error: string } {
    const settings = this.settings.get();
    let actions;
    let label: string;
    if (target.kind === 'rule') {
      const set = activeSet(settings.rules);
      const rule = set?.rules.find((r) => r.id === target.id);
      if (!rule) return { error: 'そのルールはありません（保存してからもう一度試してください）' };
      actions = rule.actions;
      label = rule.name;
    } else {
      const item = settings.spinner.items.find((i) => i.id === target.id);
      if (!item) return { error: 'その項目はありません（保存してからもう一度試してください）' };
      actions = item.actions;
      label = item.name;
    }
    if (actions.length === 0) return { error: 'この中に「やること」がありません' };

    // テストボタンは、このルールだけを動かす（イベントを流すと、ほかのルールまで動いてしまう）
    const event = this.buildTestEvent({ kind: 'gift', name: 'テスト視聴者', giftName: 'テストギフト', coins: 1, count: 1 });
    this.rule.testActions(actions, event, label, target.actionIndex);
    return { ok: true };
  }

  /** 管理画面のボタンから、スピナーを手動で回す（要件 U-2） */
  spinSpinnerManually(): void {
    // 置き換え記号に入れる名前がいるので、テストの人が回したことにする
    const event: LiveEvent = {
      kind: 'comment',
      at: toIso(Date.now()),
      msgId: null,
      isTest: true,
      late: false,
      viewer: { id: 'manual', uniqueId: 'manual', nickname: '手動', avatarUrl: null, followStatus: null },
      text: '',
    };
    this.rule.spinManually(event);
  }

  /** テストのイベントを作って流す（テストパネル。要件 U-3） */
  emitTestEvent(input: Parameters<App['buildTestEvent']>[0]): LiveEvent {
    const event = this.buildTestEvent(input);
    this.emit(event);
    return event;
  }

  /** テストのイベントを作るだけ（流さない）。テストボタンで使う */
  buildTestEvent(input: {
    kind: 'gift' | 'like' | 'comment' | 'follow' | 'share' | 'join' | 'subscribe';
    name: string;
    giftId?: string;
    giftName?: string;
    coins?: number;
    imageUrl?: string | null;
    count?: number;
    text?: string;
  }): LiveEvent {
    const name = cleanText(input.name, 64) || 'テスト視聴者';
    const viewer = {
      id: `test-${Buffer.from(name).toString('base64url').slice(0, 40)}`,
      uniqueId: 'test_viewer',
      nickname: name,
      avatarUrl: null,
      followStatus: null,
    };
    const base = { at: toIso(Date.now()), msgId: null, isTest: true, late: false, viewer };
    const count = Math.min(Math.max(Math.round(input.count ?? 1), 1), 1000);
    let event: LiveEvent;
    switch (input.kind) {
      case 'gift':
        event = {
          ...base,
          kind: 'gift',
          giftId: input.giftId || 'test-gift',
          giftName: cleanText(input.giftName, 40) || 'テストギフト',
          coinsEach: Math.max(0, Math.round(input.coins ?? 1)),
          imageUrl: input.imageUrl ?? null,
          count,
          streakTotal: count,
          streakKey: `test:${randomUUID()}`,
          streakable: false,
          streakEnded: true,
        };
        break;
      case 'like':
        event = { ...base, kind: 'like', count, roomTotal: null };
        break;
      case 'comment':
        event = { ...base, kind: 'comment', text: cleanText(input.text, 300) || 'テストのコメントです' };
        break;
      case 'subscribe':
        event = { ...base, kind: 'subscribe', months: 1 };
        break;
      default:
        event = { ...base, kind: input.kind };
    }
    return event;
  }

  // ───────── 設定 ─────────

  private applySettings(next: Settings, prev: Settings): void {
    const t = (s: Settings) => JSON.stringify([s.tiktok.username, s.tiktok.autoConnect]);
    if (t(next) !== t(prev)) void this.watcher.start();
    const m = (s: Settings) => JSON.stringify([s.minecraft.enabled, s.minecraft.host, s.minecraft.port]);
    if (m(next) !== m(prev)) this.minecraft.restart();
    const v = (s: Settings) => JSON.stringify([s.voicevox.enabled, s.voicevox.url]);
    if (v(next) !== v(prev)) this.speech.restart();
    this.hub.pushSettings();
    this.scheduleStatePush();
  }

  /** オーバーレイに渡す設定（名前ごと）。見た目（要件 O-6）は全部のオーバーレイに渡す */
  private overlaySettings(name: string): Record<string, unknown> {
    const settings = this.settings.get();
    const look = settings.overlays[name] ?? defaultOverlayLook();
    const own: Record<string, unknown> = name === 'alert' ? { displaySec: settings.alert.displaySec } : {};
    return { ...own, look };
  }

  // ───────── 管理画面 ─────────

  addAdminSocket(socket: AdminSocket): void {
    this.adminSockets.add(socket);
    socket.on('close', () => this.adminSockets.delete(socket));
    this.sendAdmin(socket, { type: 'state', state: this.state() });
  }

  private broadcastAdmin(message: Record<string, unknown>): void {
    for (const socket of this.adminSockets) this.sendAdmin(socket, message);
  }

  private sendAdmin(socket: AdminSocket, message: Record<string, unknown>): void {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // 送れなくても困らない
    }
  }

  /** 状態の知らせは、まとめて少しあとに送る（変化が続いても送りすぎないように） */
  private scheduleStatePush(): void {
    if (this.stateTimer || this.adminSockets.size === 0) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      // イベントの一覧は1件ずつ送っているので、ここでは省く（送る量を減らすため）
      this.broadcastAdmin({ type: 'state', state: this.state(false) });
    }, 300);
  }

  /** 管理画面に出す、今の状態すべて（includeEvents が false なら、イベントの一覧は空） */
  state(includeEvents = true) {
    const settings = this.settings.get();
    let today = null;
    try {
      today = daySummary(this.db, Date.now());
    } catch (err) {
      this.logger.area('記録').warn(`集計を読めませんでした: ${describeError(err)}`);
    }
    return {
      app: {
        name: APP_NAME,
        version: this.version,
        startedAt: this.startedAt,
        port: this.port,
        dataDir: this.paths.dataDir,
        overlayBaseUrl: `http://127.0.0.1:${this.port}/overlay/`,
      },
      tiktok: {
        username: settings.tiktok.username,
        status: this.watcher.getStatus(),
        viewers: this.currentViewers,
        roomId: this.recorder.currentRoomId,
      },
      euler: this.euler.snapshot(),
      minecraft: { status: this.minecraft.getStatus(), recent: this.minecraft.recentResults() },
      speech: this.speech.getStatus(),
      overlays: this.hub.counts(),
      queues: [
        this.alerts.queue.snapshot(),
        this.media.queue.snapshot(),
        this.spinner.queue.snapshot(),
        this.minecraft.queue.snapshot(),
        this.speech.queue.snapshot(),
      ],
      spinner: { ready: this.spinner.ready(), lastResult: this.spinner.getLastResult() },
      secrets: this.secrets.status(),
      settings,
      events: includeEvents ? [...this.recentEvents].reverse() : [],
      ruleRuns: [...this.recentRuns].reverse(),
      problems: this.logger.recentProblems().slice(0, 20),
      today,
      backup: this.backups.status(),
    };
  }

  queueByName(name: string) {
    return [this.alerts.queue, this.media.queue, this.spinner.queue, this.minecraft.queue, this.speech.queue].find(
      (q) => q.name === name,
    ) ?? null;
  }

  addOverlaySocket(name: string, socket: OverlaySocket): void {
    this.hub.add(name, socket);
  }
}

export type AppState = ReturnType<App['state']>;

function toDisplay(event: LiveEvent, id: number): DisplayEvent {
  const viewer = 'viewer' in event ? event.viewer : null;
  const name = viewer ? viewer.nickname || viewer.uniqueId || viewer.id : '';
  let detail = '';
  let imageUrl: string | null = viewer?.avatarUrl ?? null;
  switch (event.kind) {
    case 'gift':
      detail = `${event.giftName || event.giftId} ×${event.count}${event.coinsEach ? `（${event.coinsEach * event.count}コイン）` : ''}`;
      imageUrl = event.imageUrl ?? imageUrl;
      break;
    case 'like':
      detail = `${event.count}回`;
      break;
    case 'comment':
      detail = event.text;
      break;
    case 'subscribe':
      detail = event.months ? `${event.months}か月` : '';
      break;
    case 'streamEnd':
      detail = '配信が終わりました';
      break;
    default:
      break;
  }
  return {
    id,
    at: event.at,
    kind: event.kind,
    label: EVENT_LABELS[event.kind],
    name,
    detail,
    imageUrl,
    isTest: event.isTest,
    late: event.late,
  };
}

function readVersion(projectRoot: string): string {
  try {
    return (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
