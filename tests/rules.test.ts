// ルール（要件 6.2・6.3）のテスト
import { describe, expect, it } from 'vitest';
import { activeSet } from '../src/server/config/rules.ts';
import {
  DEFAULT_GIFT_RULE_ID,
  DEFAULT_SET_ID,
  defaultSettings,
  normalizeSettings,
  type Settings,
} from '../src/server/config/settings.ts';
import type { AlertPayload } from '../src/server/actions/alerts.ts';
import { LikeProgress, RuleEngine, matchTrigger, templateVars } from '../src/server/rules/engine.ts';
import type { RuleRunRecord } from '../src/server/db/recorder.ts';
import { event, viewer } from './helpers.ts';

/** 動いた「やること」を全部ためておく、にせものの各サービス */
function fakes() {
  const alerts: Array<{ payload: AlertPayload; priority: boolean }> = [];
  const commands: Array<{ commands: string[]; priority: boolean }> = [];
  const speeches: string[] = [];
  const runs: RuleRunRecord[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];

  const deps = {
    alerts: {
      queue: {
        push: (payload: AlertPayload, _label: string, options: { priority?: boolean; onDone?: (e: unknown) => void } = {}) => {
          alerts.push({ payload, priority: options.priority === true });
          options.onDone?.(null);
        },
      },
    },
    minecraft: {
      enqueue: (cmds: string[], _label: string, options: { priority?: boolean; onDone?: (e: unknown) => void } = {}) => {
        commands.push({ commands: cmds, priority: options.priority === true });
        options.onDone?.(null);
      },
    },
    speech: {
      speak: (text: string, _label: string, onDone?: (e: unknown) => void) => {
        speeches.push(text);
        onDone?.(null);
      },
    },
    onRun: (run: RuleRunRecord) => runs.push(run),
    /** 待ち時間つきのやることは、すぐには動かさずにためておく（下の runTimers で動かす） */
    schedule: (fn: () => void, ms: number) => timers.push({ fn, ms }),
  };

  return {
    alerts,
    commands,
    speeches,
    runs,
    timers,
    runTimers: () => {
      const pending = [...timers].sort((a, b) => a.ms - b.ms);
      timers.length = 0;
      for (const t of pending) t.fn();
    },
    deps,
  };
}

/** ルール1つだけを持つ設定を作る */
function settingsWith(rule: Record<string, unknown>, extra: Record<string, unknown> = {}): Settings {
  return normalizeSettings({
    minecraft: { enabled: true, playerName: 'winter' },
    voicevox: { enabled: true },
    ...extra,
    rules: { activeSetId: 'set1', sets: [{ id: 'set1', name: 'テスト', rules: [{ id: 'r1', ...rule }] }] },
  });
}

function engineWith(settings: Settings, f: ReturnType<typeof fakes>, now = () => 1_000_000) {
  return new RuleEngine({
    getSettings: () => settings,
    now,
    ...f.deps,
  } as unknown as ConstructorParameters<typeof RuleEngine>[0]);
}

describe('ルールの形', () => {
  it('idのない項目は捨て、足りない項目は初期値になる', () => {
    const s = normalizeSettings({
      rules: {
        activeSetId: 'set1',
        sets: [
          {
            id: 'set1',
            name: 'テスト',
            rules: [{ id: 'ok' }, { name: 'idがない' }, { id: 'ok2', cooldownSec: 'こわれた' }],
          },
        ],
      },
    });
    const set = activeSet(s.rules);
    expect(set?.rules.map((r) => r.id)).toEqual(['ok', 'ok2']);
    expect(set?.rules[0].enabled).toBe(true);
    expect(set?.rules[0].trigger.kind).toBe('gift');
    expect(set?.rules[1].cooldownSec).toBe(0);
  });

  it('指定のセットがなければ、最初のセットを使う', () => {
    const s = normalizeSettings({
      rules: { activeSetId: 'ない', sets: [{ id: 'a', name: 'A', rules: [] }, { id: 'b', name: 'B', rules: [] }] },
    });
    expect(activeSet(s.rules)?.id).toBe('a');
  });
});

describe('フェーズ0の設定からの移し替え', () => {
  it('phase0.giftReaction が、ギフトのルール1つになる', () => {
    const s = normalizeSettings({
      schemaVersion: 1,
      phase0: {
        giftReaction: {
          enabled: true,
          showOnOverlay: true,
          minecraftCommand: 'say {nickname}',
          speechText: '{nickname}さん、ありがとう',
        },
      },
    });
    expect(s.schemaVersion).toBe(2);
    expect('phase0' in s).toBe(false);

    const set = activeSet(s.rules);
    expect(set?.id).toBe(DEFAULT_SET_ID);
    expect(set?.rules).toHaveLength(1);

    const rule = set?.rules[0];
    expect(rule?.id).toBe(DEFAULT_GIFT_RULE_ID);
    expect(rule?.trigger.kind).toBe('gift');
    expect(rule?.actions.map((a) => a.type)).toEqual(['alert', 'minecraft', 'speech']);
    expect(rule?.actions[1].command).toBe('say {nickname}');
    expect(rule?.actions[2].text).toBe('{nickname}さん、ありがとう');
  });

  it('空にしていた項目は、そのやることを作らない', () => {
    const s = normalizeSettings({
      phase0: { giftReaction: { enabled: false, showOnOverlay: false, minecraftCommand: '  ', speechText: 'よむ' } },
    });
    const rule = activeSet(s.rules)?.rules[0];
    expect(rule?.enabled).toBe(false);
    expect(rule?.actions.map((a) => a.type)).toEqual(['speech']);
  });

  it('すでにルールがある設定は、そのままにする（二重に移し替えない）', () => {
    const s = normalizeSettings({
      phase0: { giftReaction: { minecraftCommand: '古いコマンド' } },
      rules: { activeSetId: 'mine', sets: [{ id: 'mine', name: '自分の', rules: [{ id: 'r1', name: '残る' }] }] },
    });
    expect(activeSet(s.rules)?.rules.map((r) => r.name)).toEqual(['残る']);
  });

  it('初めて使う時も、ギフトのルールが1つ用意される', () => {
    // 設定ファイルがない時に通るのは defaultSettings（normalizeSettings ではない）
    for (const s of [defaultSettings(), normalizeSettings({})]) {
      const rule = activeSet(s.rules)?.rules[0];
      expect(rule?.id).toBe(DEFAULT_GIFT_RULE_ID);
      expect(rule?.actions.map((a) => a.type)).toEqual(['alert', 'minecraft', 'speech']);
    }
  });
});

describe('きっかけが合っているか（R-1）', () => {
  const rule = (trigger: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    activeSet(settingsWith({ trigger, ...extra }).rules)!.rules[0];

  it('特定のギフト：選んだギフトだけ', () => {
    const r = rule({ kind: 'gift', giftIds: ['5655'] });
    expect(matchTrigger(r, event('gift', { giftId: '5655' }), new LikeProgress())).toBe(1);
    expect(matchTrigger(r, event('gift', { giftId: '9999' }), new LikeProgress())).toBe(0);
  });

  it('特定のギフト：ひとつも選ばなければ、どのギフトでも', () => {
    const r = rule({ kind: 'gift', giftIds: [] });
    expect(matchTrigger(r, event('gift', { giftId: '9999' }), new LikeProgress())).toBe(1);
  });

  it('個数が0のギフト（連打の途中）は動かさない', () => {
    const r = rule({ kind: 'gift' });
    expect(matchTrigger(r, event('gift', { count: 0 }), new LikeProgress())).toBe(0);
  });

  it('◯コイン以上：1個あたり × 個数 で見る', () => {
    const r = rule({ kind: 'giftCoins', minCoins: 100 });
    expect(matchTrigger(r, event('gift', { coinsEach: 10, count: 9 }), new LikeProgress())).toBe(0);
    expect(matchTrigger(r, event('gift', { coinsEach: 10, count: 10 }), new LikeProgress())).toBe(1);
  });

  it('ギフトの個数分くり返す（R-5）', () => {
    const r = rule({ kind: 'gift' }, { repeatPerCount: true });
    expect(matchTrigger(r, event('gift', { count: 5 }), new LikeProgress())).toBe(5);
  });

  it('いいね◯回ごと：またいだ回数だけ動く', () => {
    const r = rule({ kind: 'like', likeEvery: 100 });
    const progress = new LikeProgress();
    expect(matchTrigger(r, event('like', { count: 60 }), progress)).toBe(0);
    expect(matchTrigger(r, event('like', { count: 60 }), progress)).toBe(1); // 120回目
    expect(matchTrigger(r, event('like', { count: 250 }), progress)).toBe(2); // 370回目：200と300をまたぐ
  });

  it('コメント：キーワードが入っていれば（大文字小文字は区別しない）', () => {
    const r = rule({ kind: 'comment', keywords: ['こんにちは', 'Hello'] });
    expect(matchTrigger(r, event('comment', { text: 'みなさんこんにちは！' }), new LikeProgress())).toBe(1);
    expect(matchTrigger(r, event('comment', { text: 'HELLO there' }), new LikeProgress())).toBe(1);
    expect(matchTrigger(r, event('comment', { text: 'おやすみ' }), new LikeProgress())).toBe(0);
  });

  it('コメント：キーワードなしなら、どのコメントでも', () => {
    const r = rule({ kind: 'comment', keywords: [] });
    expect(matchTrigger(r, event('comment', { text: '何でも' }), new LikeProgress())).toBe(1);
  });

  it('フォロー・シェア・サブスクは、その種類だけ', () => {
    const r = rule({ kind: 'follow' });
    expect(matchTrigger(r, event('follow'), new LikeProgress())).toBe(1);
    expect(matchTrigger(r, event('share'), new LikeProgress())).toBe(0);
  });
});

describe('ルールの実行', () => {
  it('やることを全部動かし、1件の記録を残す', () => {
    const f = fakes();
    const settings = settingsWith({
      name: 'ギフトの反応',
      trigger: { kind: 'gift' },
      actions: [
        { type: 'alert', alertTitle: '{nickname}', alertMessage: '{giftname} x{giftcount}' },
        { type: 'minecraft', command: 'say {nickname} から {giftname}' },
        { type: 'speech', text: '{nickname}さん、ありがとう' },
      ],
    });
    engineWith(settings, f).handle(event('gift', { viewer: viewer('9', 'ふゆ'), giftName: 'バラ', count: 3 }));

    expect(f.alerts[0].payload.title).toBe('ふゆ');
    expect(f.alerts[0].payload.message).toBe('バラ x3');
    expect(f.commands[0].commands).toEqual(['say ふゆ から バラ']);
    expect(f.speeches).toEqual(['ふゆさん、ありがとう']);
    expect(f.runs).toHaveLength(1);
    expect(f.runs[0].result).toBe('ok');
    expect(f.runs[0].actions).toEqual(['overlay', 'minecraft', 'speech']);
    expect(f.runs[0].ruleName).toBe('ギフトの反応');
  });

  it('無効なルールと、やることが空のルールは動かない', () => {
    const f = fakes();
    const settings = settingsWith({ enabled: false, actions: [{ type: 'alert' }] });
    engineWith(settings, f).handle(event('gift'));
    expect(f.alerts).toHaveLength(0);
    expect(f.runs).toHaveLength(0);
  });

  it('遅れて届いたイベントは、演出しない', () => {
    const f = fakes();
    engineWith(settingsWith({ actions: [{ type: 'alert' }] }), f).handle(event('gift', { late: true }));
    expect(f.alerts).toHaveLength(0);
  });

  it('ギフトの個数分くり返す（R-5）と、その回数だけ動く', () => {
    const f = fakes();
    const settings = settingsWith({ repeatPerCount: true, actions: [{ type: 'alert' }] });
    engineWith(settings, f).handle(event('gift', { count: 4 }));
    expect(f.alerts).toHaveLength(4);
    expect(f.runs).toHaveLength(4);
  });

  it('Minecraftや読み上げを使わない設定なら、そのやることは飛ばす', () => {
    const f = fakes();
    const settings = settingsWith(
      { actions: [{ type: 'minecraft', command: 'say hi' }, { type: 'speech', text: 'やあ' }] },
      { minecraft: { enabled: false }, voicevox: { enabled: false } },
    );
    engineWith(settings, f).handle(event('gift'));
    expect(f.commands).toHaveLength(0);
    expect(f.speeches).toHaveLength(0);
    // 何も動かなかったので「飛ばした」として記録される
    expect(f.runs[0].result).toBe('skipped');
  });

  it('割り込み（A-6）は、順番待ちの先頭に入れるよう伝える', () => {
    const f = fakes();
    const settings = settingsWith({
      actions: [
        { type: 'alert', priority: true },
        { type: 'minecraft', command: 'say hi', priority: true },
      ],
    });
    engineWith(settings, f).handle(event('gift'));
    expect(f.alerts[0].priority).toBe(true);
    expect(f.commands[0].priority).toBe(true);
  });
});

describe('クールダウンと1回だけの制限', () => {
  it('全体のクールダウン中は動かない（R-3）', () => {
    const f = fakes();
    let nowMs = 1000;
    const settings = settingsWith({ cooldownSec: 10, actions: [{ type: 'alert' }] });
    const engine = engineWith(settings, f, () => nowMs);

    engine.handle(event('gift'));
    expect(f.alerts).toHaveLength(1);

    nowMs += 9000;
    engine.handle(event('gift'));
    expect(f.alerts).toHaveLength(1);

    nowMs += 1500;
    engine.handle(event('gift'));
    expect(f.alerts).toHaveLength(2);
  });

  it('人ごとのクールダウンは、他の人はさえぎらない（R-3）', () => {
    const f = fakes();
    let nowMs = 1000;
    const settings = settingsWith({ perViewerCooldownSec: 60, actions: [{ type: 'alert' }] });
    const engine = engineWith(settings, f, () => nowMs);

    engine.handle(event('gift', { viewer: viewer('A') }));
    engine.handle(event('gift', { viewer: viewer('A') }));
    expect(f.alerts).toHaveLength(1);

    engine.handle(event('gift', { viewer: viewer('B') }));
    expect(f.alerts).toHaveLength(2);

    nowMs += 61_000;
    engine.handle(event('gift', { viewer: viewer('A') }));
    expect(f.alerts).toHaveLength(3);
  });

  it('同じ人のフォローは、1回の配信で1回だけ（R-6）', () => {
    const f = fakes();
    const settings = settingsWith({ trigger: { kind: 'follow' }, actions: [{ type: 'alert' }] });
    const engine = engineWith(settings, f);

    engine.handle(event('follow', { viewer: viewer('A') }));
    engine.handle(event('follow', { viewer: viewer('A') }));
    engine.handle(event('follow', { viewer: viewer('B') }));
    expect(f.alerts).toHaveLength(2);

    // 配信が終われば、次の配信ではまた反応する
    engine.handle(event('streamEnd'));
    engine.handle(event('follow', { viewer: viewer('A') }));
    expect(f.alerts).toHaveLength(3);
  });
});

describe('Minecraftのコマンド（A-2）', () => {
  it('くり返し回数と、{index}・{repetition} が入る', () => {
    const f = fakes();
    const settings = settingsWith({ actions: [{ type: 'minecraft', command: 'say {index}/{repetition}', repeat: 3 }] });
    engineWith(settings, f).handle(event('gift'));

    expect(f.commands.map((c) => c.commands[0])).toEqual(['say 1/3', 'say 2/3', 'say 3/3']);
  });

  it('待ち時間と間隔があると、すぐには送らない', () => {
    const f = fakes();
    const settings = settingsWith({
      actions: [{ type: 'minecraft', command: 'say hi', repeat: 2, delaySec: 1, intervalSec: 2 }],
    });
    engineWith(settings, f).handle(event('gift'));

    expect(f.commands).toHaveLength(0);
    expect(f.timers.map((t) => t.ms)).toEqual([1000, 3000]);

    f.runTimers();
    expect(f.commands).toHaveLength(2);
  });

  it('複数行のコマンドは、1行ずつ送る', () => {
    const f = fakes();
    const settings = settingsWith({ actions: [{ type: 'minecraft', command: 'say a\n\n  say b  \n' }] });
    engineWith(settings, f).handle(event('gift'));
    expect(f.commands[0].commands).toEqual(['say a', 'say b']);
  });
});

describe('置き換え記号に入る値', () => {
  const settings = settingsWith({ actions: [] });

  it('ギフト以外のイベントでも、名前とコメントが入る', () => {
    const vars = templateVars(event('comment', { viewer: viewer('1', 'ふゆ'), text: 'こんばんは' }), settings, 'display');
    expect(vars.nickname).toBe('ふゆ');
    expect(vars.comment).toBe('こんばんは');
    expect(vars.giftname).toBe('');
    expect(vars.giftcount).toBe(0);
  });

  it('名前がない人は「名無し」になる', () => {
    const vars = templateVars(event('gift', { viewer: null }), settings, 'display');
    expect(vars.nickname).toBe('名無し');
  });

  it('Minecraftに送る時は、危ない文字を落とす（N-4）', () => {
    const vars = templateVars(event('gift', { viewer: viewer('1', 'あ"ぶ\nない') }), settings, 'minecraft');
    expect(String(vars.nickname)).not.toContain('"');
    expect(String(vars.nickname)).not.toContain('\n');
  });
});
