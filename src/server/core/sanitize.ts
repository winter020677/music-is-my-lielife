// 視聴者から来る文字（名前・コメント）を安全にする（要件 N-4）
//
// 視聴者の名前やコメントは、誰でも自由に書ける。そのまま使うと、
//  ・Minecraftのコマンドが壊れる／別の意味に書き換わる
//  ・画面の表示が崩れる（改行や見えない文字）
//  ・とても長い文字で演出が止まる
// といったことが起きる。使う前に必ずここを通す。

// 改行・タブなどの制御文字と、見えない文字（ゼロ幅スペース、文字の向きを変える記号など）
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 見た目の1文字単位で数えて、長すぎる分を切る（絵文字が途中で割れないようにする） */
export function truncate(text: string, maxChars: number, ellipsis = ''): string {
  if (maxChars <= 0) return '';
  const parts: string[] = [];
  for (const { segment } of graphemes.segment(text)) {
    if (parts.length >= maxChars) return parts.join('') + ellipsis;
    parts.push(segment);
  }
  return parts.join('');
}

/**
 * 基本の無害化：
 *  ・文字でないもの（null など）は空文字にする
 *  ・改行・制御文字・見えない文字をスペースに置き換える
 *  ・連続するスペースを1つにまとめ、前後の空白を消す
 *  ・長さを制限する
 */
export function cleanText(input: unknown, maxChars: number, ellipsis = ''): string {
  if (input === null || input === undefined) return '';
  const text = String(input)
    .normalize('NFC')
    .replace(INVISIBLE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(text, maxChars, ellipsis);
}

/**
 * Minecraftのコマンドに入れる用。
 *  ・" と \ … tellraw などのJSONの文字列を壊すので消す
 *  ・' … NBT（例：CustomName:'...'）の文字列を壊すので消す
 *  ・§ … Minecraftの色コードなので消す
 *  ・@ … @a や @e のように「対象の指定」として読まれるので全角の＠にする
 */
export function forMinecraft(input: unknown, maxChars = 40): string {
  return cleanText(input, maxChars)
    .replace(/["'\\§]/g, '')
    .replace(/@/g, '＠');
}

/**
 * 読み上げ（VOICEVOX）に渡す用。
 *  ・URLは読むと長いので「URL」に置き換える
 *  ・同じ文字が何度も続く時（「wwwwww」「ーーーー」など）は4つまでにする
 */
export function forSpeech(input: unknown, maxChars = 60): string {
  const text = cleanText(input, 500)
    .replace(/https?:\/\/\S+/gi, 'URL')
    .replace(/(.)\1{4,}/gu, '$1$1$1$1');
  return truncate(text, maxChars);
}

/** 画面（オーバーレイ・管理画面）に出す用。表示はtextContentで行うので、ここでは長さと制御文字だけ整える */
export function forDisplay(input: unknown, maxChars = 40): string {
  return cleanText(input, maxChars, '…');
}
