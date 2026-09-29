// フェーズ0の試作用ルール：「ギフトが来たら」→ アラート表示＋Minecraftのコマンド＋読み上げ
//
// フェーズ1で「きっかけ→やること」を自由に組める仕組み（要件 6.2）を作ったら、このファイルは
// そちらの1つのルールに置き換える。設定は settings.json の phase0.giftReaction。

import type { AlertService } from '../actions/alerts.ts';
import type { MinecraftService } from '../actions/minecraft/service.ts';
import type { SpeechService } from '../actions/voicevox.ts';
import type { GiftEvent, LiveEvent } from '../core/events.ts';
import { describeError } from '../core/logger.ts';
import { forDisplay, forMinecraft, forSpeech } from '../core/sanitize.ts';
import { renderTemplate, splitLines, type TemplateVars } from '../core/template.ts';
import type { Settings } from '../config/settings.ts';
import type { RuleRunRecord } from '../db/recorder.ts';

export const PHASE0_RULE_ID = 'phase0-gift';
export const PHASE0_RULE_NAME = 'ギフトの反応（フェーズ0の試作）';

type Context = 'minecraft' | 'speech' | 'display';

/** 置き換え記号に入れる値を、使う場所に合わせて安全にして作る（要件 N-4） */
export function giftTemplateVars(event: GiftEvent, settings: Settings, context: Context): TemplateVars {
  const clean = context === 'minecraft' ? forMinecraft : context === 'speech' ? forSpeech : forDisplay;
  const name = event.viewer?.nickname || event.viewer?.uniqueId || '名無し';
  return {
    playername: forMinecraft(settings.minecraft.playerName, 40),
    nickname: clean(name, context === 'speech' ? 20 : 40),
    giftname: clean(event.giftName || 'ギフト', 30),
    giftcount: event.count,
    // {coins} は「ギフト1個あたりのコイン数」
    coins: event.coinsEach,
    repetition: 1,
    index: 1,
    comment: '',
  };
}

export class Phase0GiftRule {
  private readonly getSettings: () => Settings;
  private readonly alerts: AlertService;
  private readonly minecraft: MinecraftService;
  private readonly speech: SpeechService;
  private readonly onRun: (run: RuleRunRecord) => void;

  constructor(deps: {
    getSettings: () => Settings;
    alerts: AlertService;
    minecraft: MinecraftService;
    speech: SpeechService;
    onRun: (run: RuleRunRecord) => void;
  }) {
    this.getSettings = deps.getSettings;
    this.alerts = deps.alerts;
    this.minecraft = deps.minecraft;
    this.speech = deps.speech;
    this.onRun = deps.onRun;
  }

  handle(event: LiveEvent): void {
    if (event.kind !== 'gift' || event.count <= 0 || event.late) return;
    const settings = this.getSettings();
    const rule = settings.phase0.giftReaction;
    if (!rule.enabled) return;

    const display = giftTemplateVars(event, settings, 'display');
    const label = `${display.nickname}：${display.giftname} ×${event.count}`;
    const run = new RunTracker((actions, errors) => {
      this.onRun({
        at: event.at,
        isTest: event.isTest,
        ruleId: PHASE0_RULE_ID,
        ruleName: PHASE0_RULE_NAME,
        triggerKind: 'gift',
        triggerViewer: event.viewer,
        triggerDetail: `${event.giftName || event.giftId} ×${event.count}`,
        actions,
        result: actions.length === 0 ? 'skipped' : errors.length === 0 ? 'ok' : errors.length === actions.length ? 'error' : 'partial',
        message: errors.length > 0 ? errors.join(' / ') : null,
      });
    });

    if (rule.showOnOverlay) {
      const done = run.add('overlay');
      this.alerts.queue.push(
        {
          kind: 'gift',
          title: String(display.nickname),
          message: `${display.giftname} ×${event.count}`,
          imageUrl: event.imageUrl,
          avatarUrl: event.viewer?.avatarUrl ?? null,
          count: event.count,
        },
        label,
        { onDone: done },
      );
    }

    if (settings.minecraft.enabled && rule.minecraftCommand.trim()) {
      const vars = giftTemplateVars(event, settings, 'minecraft');
      const commands = splitLines(rule.minecraftCommand).map((line) => renderTemplate(line, vars));
      this.minecraft.enqueue(commands, label, run.add('minecraft'));
    }

    if (settings.voicevox.enabled && rule.speechText.trim()) {
      const text = renderTemplate(rule.speechText, giftTemplateVars(event, settings, 'speech'));
      this.speech.speak(text, label, run.add('speech'));
    }

    run.close();
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
