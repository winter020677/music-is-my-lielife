// TikTok LIVEへの接続（tiktok-live-connector を使う、唯一の場所。要件 N-6）
//
// TikTok側の仕様変更で接続が止まった時は、まずライブラリを最新にする（READMEの手順）。
// それでも直らない時は、このファイルと normalize.ts を直す。
//
// Euler Streamの使用回数を正しく数えるため（要件 C-7）：
//  ・ライブラリの中の「Euler Streamを使う処理」を包んで、1回ごとに数える
//  ・ライブラリが自動で Euler Stream に頼る「配信中かの確認」を止め、
//    こちらで数えながら、必要な時だけ頼む

import {
  IsLiveRouteConfig,
  RoomIdRouteConfig,
  RouteConfig,
  SignConfig,
  SignatureRateLimitError,
  TikTokLiveConnection,
  UserOfflineError,
  createEulerClient,
  validateAndNormalizeUniqueId,
} from 'tiktok-live-connector';
import { describeError } from '../core/logger.ts';
import { parseTikTokTime } from '../core/time.ts';
import {
  OfflineError,
  RateLimitedError,
  type ClientHandlers,
  type ConnectResult,
  type EulerRateLimits,
  type LiveCheckResult,
  type TikTokClient,
} from './client.ts';
import { TIKTOK_EVENT_NAMES } from './normalize.ts';

/** Euler Streamを使うライブラリの処理（1回呼ぶ＝1リクエスト） */
const EULER_ROUTES = [
  'fetchSignedWebSocketFromProvider',
  'fetchWebcastSignatureFromProvider',
  'fetchRoomIdFromProvider',
  'fetchRoomInfoFromProvider',
  'fetchRoomGiftsFromProvider',
  'fetchRoomGiftGalleryFromProvider',
  'sendRoomChatFromProvider',
] as const;

type AnyRoute = (args: any) => Promise<any>;

let onEulerRequest: (route: string) => void = () => {};
let routesWrapped = false;

function wrapEulerRoutes(): void {
  if (routesWrapped) return;
  routesWrapped = true;
  const routes = RouteConfig as unknown as Record<string, AnyRoute>;
  for (const name of EULER_ROUTES) {
    const original = routes[name];
    if (typeof original !== 'function') continue;
    routes[name] = (args: unknown) => {
      onEulerRequest(name);
      return original(args);
    };
  }
  IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;
  RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
}

export class ConnectorClient implements TikTokClient {
  private apiKey = '';
  private probe: { username: string; connection: TikTokLiveConnection } | null = null;
  private current: TikTokLiveConnection | null = null;

  constructor(onEuler: (route: string) => void) {
    onEulerRequest = onEuler;
    wrapEulerRoutes();
  }

  setApiKey(key: string): void {
    if (key === this.apiKey) return;
    this.apiKey = key;
    SignConfig.apiKey = key || undefined;
    // 前のAPIキーで作られた接続の部品を捨てる
    SignConfig.cachedInstance = undefined;
    this.probe = null;
  }

  async checkLive(username: string, allowEuler: boolean): Promise<LiveCheckResult> {
    const uniqueId = normalizeUsername(username);
    const connection = this.probeFor(uniqueId);
    const webClient = connection.webClient;
    const problems: string[] = [];
    const routes = RouteConfig as unknown as Record<string, AnyRoute>;

    // 1. TikTokのページから（Euler Streamを使わない）
    try {
      const info = await routes.fetchRoomInfoFromHtml({ webClient, uniqueId });
      const status = info?.liveRoom?.status;
      if (status !== undefined && status !== null) {
        return {
          live: Number(status) !== 4,
          roomId: stringOrNull(info?.user?.roomId ?? info?.liveRoom?.roomId),
          startedAtMs: parseTikTokTime(info?.liveRoom?.startTime),
          title: stringOrNull(info?.liveRoom?.title),
          source: 'html',
        };
      }
      problems.push('ページ：状態が見つからない');
    } catch (err) {
      problems.push(`ページ：${describeError(err)}`);
    }

    // 2. TikTokのAPIから（Euler Streamを使わない）
    try {
      const res = await routes.fetchRoomInfoFromApiLive({ webClient, uniqueId });
      const status = res?.data?.liveRoom?.status;
      if (status !== undefined && status !== null) {
        return {
          live: Number(status) !== 4,
          roomId: stringOrNull(res?.data?.user?.roomId ?? res?.data?.liveRoom?.roomId),
          startedAtMs: parseTikTokTime(res?.data?.liveRoom?.startTime),
          title: stringOrNull(res?.data?.liveRoom?.title),
          source: 'api',
        };
      }
      problems.push('API：状態が見つからない');
    } catch (err) {
      problems.push(`API：${describeError(err)}`);
    }

    // 3. Euler Streamに聞く（1リクエスト使う）
    if (allowEuler) {
      try {
        const res = await routes.fetchRoomIdFromProvider({ webClient, apiClient: connection.apiClient, uniqueId });
        if (res?.code === 200 && typeof res.is_live === 'boolean') {
          return { live: res.is_live, roomId: stringOrNull(res.room_id), startedAtMs: null, title: null, source: 'euler' };
        }
        problems.push(`Euler Stream：${res?.message ?? `コード ${res?.code}`}`);
      } catch (err) {
        problems.push(`Euler Stream：${describeError(err)}`);
      }
    }

    throw new Error(`配信中か確かめられませんでした（${problems.join(' / ')}）`);
  }

  async connect(username: string, roomId: string, handlers: ClientHandlers): Promise<ConnectResult> {
    await this.disconnect();
    const connection = new TikTokLiveConnection(normalizeUsername(username), {
      signApiKey: this.apiKey || undefined,
      processInitialData: true,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
    });
    const emitter = connection as unknown as {
      on(event: string, listener: (...args: any[]) => void): void;
      removeAllListeners(): void;
    };
    // 接続の途中でも（少し前の）イベントが届くので、先に受け取る準備をする
    for (const name of TIKTOK_EVENT_NAMES) {
      emitter.on(name, (data: unknown) => handlers.onEvent(name, data));
    }
    emitter.on('streamEnd', () => handlers.onStreamEnd());
    emitter.on('disconnected', (info: { code?: number; reason?: string }) => {
      if (this.current === connection) this.current = null;
      handlers.onDisconnected(info ?? {});
    });
    emitter.on('error', (err: { info?: string; exception?: unknown }) => {
      handlers.onError(`${err?.info ?? 'エラー'}: ${describeError(err?.exception ?? err)}`);
    });

    try {
      const state = await connection.connect(roomId);
      this.current = connection;
      const room = (state.roomInfo as { data?: Record<string, unknown> } | null)?.data ?? {};
      return {
        roomId: String(state.roomId || roomId),
        startedAtMs: parseTikTokTime(room.create_time ?? room.start_time),
        title: stringOrNull(room.title),
      };
    } catch (err) {
      emitter.removeAllListeners();
      if (err instanceof UserOfflineError) throw new OfflineError('配信していません');
      if (err instanceof SignatureRateLimitError) {
        const retry = Number((err as { retryAfter?: number }).retryAfter);
        throw new RateLimitedError('Euler Streamの回数制限に達しました', Number.isFinite(retry) ? retry : null);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const connection = this.current;
    this.current = null;
    if (!connection) return;
    try {
      await connection.disconnect();
    } finally {
      (connection as unknown as { removeAllListeners(): void }).removeAllListeners();
    }
  }

  async fetchRateLimits(): Promise<EulerRateLimits | null> {
    if (!this.apiKey) return null;
    const client = createEulerClient();
    const res = await client.accounts.getRateLimits();
    const data = res.data as {
      code?: number;
      message?: string;
      day?: RateInfo;
      hour?: RateInfo;
      minute?: RateInfo;
    };
    if (res.status !== 200 || (data.code !== undefined && data.code !== 200)) {
      throw new Error(`Euler Streamに残り回数を聞けませんでした（${data.message ?? `HTTP ${res.status}`}）`);
    }
    return { day: rate(data.day), hour: rate(data.hour), minute: rate(data.minute) };
  }

  /** 配信中かの確認に使う接続の部品（ユーザー名ごとに1つ作って使い回す） */
  private probeFor(uniqueId: string): TikTokLiveConnection {
    if (this.probe?.username !== uniqueId) {
      this.probe = {
        username: uniqueId,
        connection: new TikTokLiveConnection(uniqueId, { signApiKey: this.apiKey || undefined }),
      };
    }
    return this.probe.connection;
  }
}

type RateInfo = { max: number; remaining: number; reset_at: string | null };

function rate(info: RateInfo | undefined): EulerRateLimits['day'] {
  if (!info) return null;
  return { max: Number(info.max), remaining: Number(info.remaining), resetAt: info.reset_at ?? null };
}

/** 「@name」「https://www.tiktok.com/@name/live」なども受け付ける */
export function normalizeUsername(username: string): string {
  return validateAndNormalizeUniqueId(username.trim());
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' || text === '0' ? null : text;
}
