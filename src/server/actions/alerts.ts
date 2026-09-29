// アラート（要件 O-13）
// アラート用オーバーレイ（alert）に、1つずつ順番に表示させる。
// 表示している間は次を出さないので、アラートが重ならない。

import type { OverlayHub } from './overlayHub.ts';
import type { AreaLogger } from '../core/logger.ts';
import { ActionQueue, sleep } from '../core/queue.ts';
import type { Settings } from '../config/settings.ts';

export interface AlertPayload {
  /** 例：gift / follow / share / subscribe / test */
  kind: string;
  title: string;
  message: string;
  imageUrl: string | null;
  avatarUrl: string | null;
  count: number | null;
}

export class AlertService {
  readonly queue: ActionQueue<AlertPayload>;
  private readonly hub: OverlayHub;
  private readonly getSettings: () => Settings['alert'];

  constructor(options: { hub: OverlayHub; getSettings: () => Settings['alert']; log: AreaLogger }) {
    this.hub = options.hub;
    this.getSettings = options.getSettings;
    this.queue = new ActionQueue({
      name: 'alert',
      label: '演出',
      log: options.log,
      run: (payload, signal) => this.show(payload, signal),
    });
  }

  show(payload: AlertPayload, signal: AbortSignal): Promise<void> {
    const durationMs = Math.round(this.getSettings().displaySec * 1000);
    const sent = this.hub.send('alert', { type: 'alert', durationMs, ...payload });
    if (sent === 0) return Promise.reject(new Error('アラート用オーバーレイ（alert）がOBSにつながっていません'));
    return sleep(durationMs, signal).then(() => {
      if (signal.aborted) this.hub.send('alert', { type: 'skip' });
    });
  }
}
