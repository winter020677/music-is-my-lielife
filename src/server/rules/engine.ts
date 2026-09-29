// ルールの実行（要件 6.2・6.3）
//
// 届いたイベントを、今のセットの中のルールと照らし合わせて、合ったルールの「やること」を動かす。
// フェーズ0の固定ルール（phase0GiftRule.ts）の置き換え。
//
// 見ていること：
//  ・R-1 きっかけが合っているか
//  ・R-3 クールダウン（全体／人ごと）が明けているか
//  ・R-5 ギフトの個数分くり返すか
//  ・R-6 同じ人のフォローは、1回の配信で1回だけ
//  ・A-6 割り込み（順番待ちを追い越す）
//
// 「遅れて届いたイベント」（late）は、記録はされるがここでは何もしない。
// 接続し直した時に、昔のギフトで演出が出ないようにするため。

import type { AlertService } from '../actions/alerts.ts';
import type { MinecraftService } from '../actions/minecraft/service.ts';
import type { SpeechService } from '../actions/voicevox.ts';
import { activeSet, type Rule, type RuleAction } from '../config/rules.ts';
import type { Settings } from '../config/settings.ts';
import type { LiveEvent, Viewer } from '../core/events.ts';
import { describeError } from '../core/logger.ts';
import { forDisplay, forMinecraft, forSpeech } from '../core/sanitize.ts';
import { renderTemplate, splitLines, type TemplateVars } from '../core/template.ts';
import type { RuleRunRecord } from '../db/recorder.ts';

type Context = 'minecraft' | 'speech' | 'display';

/** 置き換え記号に入れる値を、使う場所に合わせて安全にして作る（要件 N-4） */
export function templateVars(event: LiveEvent, settings: Settings, context: Context): TemplateVars {
  const clean = context === 'minecraft' ? forMinecraft : context === 'speech' ? forSpeech : forDisplay;
  const nameLimit = context === 'speech' ? 20 : 40;
  const viewer = 'viewer' in event ? event.viewer : null;
  const name = viewer?.nickname || viewer?.uniqueId || '名無し';
  const gift = event.kind === 'gift' ? event : null;
  return {
    playername: forMinecraft(settings.minecraft.playerName, 40),
    nickname: clean(name, nameLimit),
    giftname: clean(gift?.giftName || (gift ? 'ギフト' : ''), 30),
    giftcount: gift ? gift.count : 0,
    // {coins} は「ギフト1個あたりのコイン数」
    coins: gift ? gift.coinsEach : 0,
    comment: event.kind === 'comment' ? clean(event.text, context === 'speech' ? 60 : 100) : '',
    repetition: 1,
    index: 1,
  };
}

/** きっかけが合っているか（要件 R-1）。合っていれば、やることを何回くり返すかを返す */
export function matchTrigger(rule: Rule, event: LiveEvent, likeProgress: LikeProgress): number {
  const t = rule.trigger;
  switch (t.kind) {
    case 'gift': {
      if (event.kind !== 'gift' || event.count <= 0) return 0;
      if (t.giftIds.length > 0 && !t.giftIds.includes(event.giftId)) return 0;
      return rule.repeatPerCount ? event.count : 1;
    }
    case 'giftCoins': {
      if (event.kind !== 'gift' || event.count <= 0) return 0;
      if (event.coinsEach * event.count < t.minCoins) return 0;
      return rule.repeatPerCount ? event.count : 1;
    }
    case 'like': {
      if (event.kind !== 'like' || event.count <= 0) return 0;
      // 前回からの合計が likeEvery をまたぐたびに1回。まとめて届いた分は、またいだ回数だけ動く
      return likeProgress.advance(rule.id, event.count, t.likeEvery);
    }
    case 'comment': {
      if (event.kind !== 'comment') return 0;
      if (t.keywords.length === 0) return 1;
      const text = event.text.toLowerCase();
      return t.keywords.some((word) => text.includes(word.toLowerCase())) ? 1 : 0;
    }
    case 'follow':
    case 'share':
    case 'subscribe':
      return event.kind === t.kind ? 1 : 0;
  }
}

/** いいねの累計を、ルールごとに数える（「いいね◯回ごと」用） */
export class LikeProgress {
  private readonly counts = new Map<string, number>();

  /** 今回の分を足して、しきい値を何回またいだかを返す */
  advance(ruleId: string, added: number, every: number): number {
    const before = this.counts.get(ruleId) ?? 0;
    const after = before + added;
    this.counts.set(ruleId, after);
    return Math.floor(after / every) - Math.floor(before / every);
  }

  reset(): void {
    this.counts.clear();
  }
}

export interface RuleEngineDeps {
  getSettings: () => Settings;
  alerts: AlertService;
  minecraft: MinecraftService;
  speech: SpeechService;
  onRun: (run: RuleRunRecord) => void;
  /** 待ち時間つきのやること用（テストでは、待たずにすぐ動かすものを渡す） */
  schedule?: (fn: () => void, ms: number) => void;
  now?: () => number;
}

export class RuleEngine {
  private readonly deps: RuleEngineDeps;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly now: () => number;
  private readonly likes = new LikeProgress();
  /** ルールごとの、最後に動いた時刻（クールダウン用。要件 R-3） */
  private readonly lastRun = new Map<string, number>();
  /** ルール＋人ごとの、最後に動いた時刻（要件 R-3） */
  private readonly lastRunPerViewer = new Map<string, number>();
  /** この配信でもう反応した人（フォローは1回だけ。要件 R-6） */
  private readonly oncePerStream = new Set<string>();

  constructor(deps: RuleEngineDeps) {
    this.deps = deps;
    this.schedule = deps.schedule ?? ((fn, ms) => {
      setTimeout(fn, ms);
    });
    this.now = deps.now ?? Date.now;
  }

  /** 配信が変わったら、1回だけの制限といいねの数え直しをする */
  resetStream(): void {
    this.likes.reset();
    this.oncePerStream.clear();
    this.lastRun.clear();
    this.lastRunPerViewer.clear();
  }

  handle(event: LiveEvent): void {
    if (event.late) return;
    if (event.kind === 'streamEnd') {
      this.resetStream();
      return;
    }
    const settings = this.deps.getSettings();
    const set = activeSet(settings.rules);
    if (!set) return;

    for (const rule of set.rules) {
      if (!rule.enabled || rule.actions.length === 0) continue;
      const times = matchTrigger(rule, event, this.likes);
      if (times <= 0) continue;
      if (!this.allowedNow(rule, event)) continue;
      for (let i = 0; i < times; i += 1) this.runActions(rule, event, settings);
    }
  }

  /** クールダウン（R-3）と、1回だけの制限（R-6）を見る。通ったら、動いた時刻を覚える */
  private allowedNow(rule: Rule, event: LiveEvent): boolean {
    const viewer: Viewer | null = 'viewer' in event ? event.viewer : null;
    const nowMs = this.now();

    // R-6：同じ人のフォローは、1回の配信で1回だけ
    if (rule.trigger.kind === 'follow' && viewer) {
      const key = `${rule.id} ${viewer.id}`;
      if (this.oncePerStream.has(key)) return false;
      this.oncePerStream.add(key);
    }

    if (rule.cooldownSec > 0) {
      const last = this.lastRun.get(rule.id);
      if (last !== undefined && nowMs - last < rule.cooldownSec * 1000) return false;
    }
    if (rule.perViewerCooldownSec > 0 && viewer) {
      const key = `${rule.id} ${viewer.id}`;
      const last = this.lastRunPerViewer.get(key);
      if (last !== undefined && nowMs - last < rule.perViewerCooldownSec * 1000) return false;
      this.lastRunPerViewer.set(key, nowMs);
    }
    this.lastRun.set(rule.id, nowMs);
    return true;
  }

  /** 1つのルールの「やること」を全部動かして、結果を1件の記録にする */
  private runActions(rule: Rule, event: LiveEvent, settings: Settings): void {
    const display = templateVars(event, settings, 'display');
    const label = `${rule.name}：${display.nickname}`;
    const run = new RunTracker((actions, errors) => {
      this.deps.onRun({
        at: event.at,
        isTest: event.isTest,
        ruleId: rule.id,
        ruleName: rule.name,
        triggerKind: rule.trigger.kind,
        triggerViewer: 'viewer' in event ? event.viewer : null,
        triggerDetail: detailOf(event),
        actions,
        result:
          actions.length === 0
            ? 'skipped'
            : errors.length === 0
              ? 'ok'
              : errors.length === actions.length
                ? 'error'
                : 'partial',
        message: errors.length > 0 ? errors.join(' / ') : null,
      });
    });

    for (const action of rule.actions) {
      switch (action.type) {
        case 'alert':
          this.runAlert(action, event, display, label, run);
          break;
        case 'minecraft':
          this.runMinecraft(action, event, settings, label, run);
          break;
        case 'speech':
          this.runSpeech(action, event, settings, label, run);
          break;
      }
    }
    run.close();
  }

  private runAlert(action: RuleAction, event: LiveEvent, vars: TemplateVars, label: string, run: RunTracker): void {
    const gift = event.kind === 'gift' ? event : null;
    const viewer = 'viewer' in event ? event.viewer : null;
    this.deps.alerts.queue.push(
      {
        kind: event.kind,
        title: renderTemplate(action.alertTitle, vars),
        message: renderTemplate(action.alertMessage, vars),
        imageUrl: gift?.imageUrl ?? null,
        avatarUrl: viewer?.avatarUrl ?? null,
        count: gift?.count ?? null,
      },
      label,
      { priority: action.priority, onDone: run.add('overlay') },
    );
  }

  private runMinecraft(action: RuleAction, event: LiveEvent, settings: Settings, label: string, run: RunTracker): void {
    if (!settings.minecraft.enabled || !action.command.trim()) return;
    const lines = splitLines(action.command);
    if (lines.length === 0) return;

    const done = run.add('minecraft');
    let remaining = action.repeat;
    let firstError: unknown = null;
    const sendOne = (index: number) => {
      const vars = { ...templateVars(event, settings, 'minecraft'), repetition: action.repeat, index };
      const commands = lines.map((line) => renderTemplate(line, vars));
      this.deps.minecraft.enqueue(commands, action.repeat > 1 ? `${label}（${index}/${action.repeat}）` : label, {
        priority: action.priority,
        onDone: (error) => {
          if (error && !firstError) firstError = error;
          remaining -= 1;
          if (remaining === 0) done(firstError);
        },
      });
    };

    for (let i = 1; i <= action.repeat; i += 1) {
      const waitMs = action.delaySec * 1000 + (i - 1) * action.intervalSec * 1000;
      if (waitMs <= 0) sendOne(i);
      else this.schedule(() => sendOne(i), waitMs);
    }
  }

  private runSpeech(action: RuleAction, event: LiveEvent, settings: Settings, label: string, run: RunTracker): void {
    if (!settings.voicevox.enabled || !action.text.trim()) return;
    const text = renderTemplate(action.text, templateVars(event, settings, 'speech'));
    this.deps.speech.speak(text, label, run.add('speech'));
  }
}

/** 記録に残す「何がきっかけだったか」の短い説明 */
function detailOf(event: LiveEvent): string | null {
  switch (event.kind) {
    case 'gift':
      return `${event.giftName || event.giftId} x${event.count}`;
    case 'like':
      return `いいね x${event.count}`;
    case 'comment':
      return event.text.slice(0, 100);
    case 'subscribe':
      return event.months ? `${event.months}か月` : null;
    default:
      return null;
  }
}

/** 1回の発動で動いた「やること」の結果を集めて、全部終わったら記録する */
class RunTracker {
  private readonly actions: string[] = [];
  private readonly errors: string[] = [];
  private pending = 0;
  private closed = false;
  private finished = false;
  private readonly finish: (actions: string[], errors: string[]) => void;

  constructor(finish: (actions: string[], errors: string[]) => void) {
    this.finish = finish;
  }

  add(action: string): (error: unknown) => void {
    this.actions.push(action);
    this.pending += 1;
    let called = false;
    return (error) => {
      if (called) return;
      called = true;
      if (error) this.errors.push(`${action}: ${describeError(error)}`);
      this.pending -= 1;
      this.maybeFinish();
    };
  }

  close(): void {
    this.closed = true;
    this.maybeFinish();
  }

  private maybeFinish(): void {
    if (this.finished || !this.closed || this.pending > 0) return;
    this.finished = true;
    this.finish(this.actions, this.errors);
  }
}
