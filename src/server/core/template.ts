// 置き換え記号（要件 A-3）
// STEと同じ書き方で、コマンドや読み上げ文の中の {nickname} などを実際の値に置き換える。
//
// 使える記号：
//   {playername}  Minecraftのプレイヤー名（設定値）
//   {nickname}    視聴者の名前
//   {giftname}    ギフト名
//   {giftcount}   ギフトの個数
//   {repetition}  くり返し回数（設定値）
//   {comment}     コメント本文
//   {coins}       ギフトのコイン数
//   {index}       くり返しの何回目か（1〜N）
//   {random:X Y}   XからYのランダムな数
//   {random:N X Y} Nに「XからYのランダムな数」を足した値
//   {mult:X Y}     X×Y
//   {plus:X Y}     X＋Y
//
// 大事な決まり：
//  ・知らない {...} はそのまま残す。Minecraftのコマンドには {CustomName:'...'} のような
//    波かっこが普通に出てくるので、勝手に消してはいけない。
//  ・関数の中に記号を入れられる（例：{mult:{giftcount} 10}）。
//  ・置き換えた後の値（視聴者の名前など）は、もう一度読み直さない。
//    名前に「{random:1 100}」と書かれていても、ただの文字として扱う。

export const TEMPLATE_VARIABLES = [
  'playername',
  'nickname',
  'giftname',
  'giftcount',
  'repetition',
  'comment',
  'coins',
  'index',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | number>>;

const FUNCTIONS = ['random', 'mult', 'plus'] as const;
type TemplateFunction = (typeof FUNCTIONS)[number];

const NAME_PATTERN = /^\{([a-z]+)(\}|:)/;

function isVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

function isFunction(name: string): name is TemplateFunction {
  return (FUNCTIONS as readonly string[]).includes(name);
}

/** 置き換え記号を実際の値に置き換える */
export function renderTemplate(template: string, vars: TemplateVars, random: () => number = Math.random): string {
  const renderer = new Renderer(template, vars, random);
  return renderer.render(false);
}

/** 1行ずつに分ける（空行とスペースだけの行は捨てる）。複数行のコマンド用 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

class Renderer {
  private readonly src: string;
  private readonly vars: TemplateVars;
  private readonly random: () => number;
  private pos = 0;

  constructor(src: string, vars: TemplateVars, random: () => number) {
    this.src = src;
    this.vars = vars;
    this.random = random;
  }

  /** insideFunction が true の時は、閉じかっこ } の手前で止まる */
  render(insideFunction: boolean): string {
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (insideFunction && ch === '}') return out;
      if (ch === '{') {
        const replaced = this.tryPlaceholder();
        if (replaced !== null) {
          out += replaced;
          continue;
        }
      }
      out += ch;
      this.pos += 1;
    }
    return out;
  }

  /** 今の位置の { から記号を読む。記号でなければ null（その { は普通の文字として扱う） */
  private tryPlaceholder(): string | null {
    const match = NAME_PATTERN.exec(this.src.slice(this.pos, this.pos + 16));
    if (!match) return null;
    const name = match[1];

    if (match[2] === '}') {
      if (!isVariable(name)) return null;
      this.pos += match[0].length;
      const value = this.vars[name];
      return value === undefined || value === null ? '' : String(value);
    }

    if (!isFunction(name)) return null;
    const start = this.pos;
    this.pos += match[0].length;
    const inner = this.render(true);
    if (this.src[this.pos] !== '}') {
      // 閉じかっこがない → 記号ではなかったことにする
      this.pos = start;
      return null;
    }
    this.pos += 1;
    const result = this.applyFunction(name, inner);
    // 数字として読めなかった時は、置き換えずにそのまま残す（テストで気づけるように）
    return result ?? `{${name}:${inner}}`;
  }

  private applyFunction(name: TemplateFunction, inner: string): string | null {
    const parts = inner.trim().split(/\s+/).filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const decimals = Math.max(...parts.map(countDecimals));

    switch (name) {
      case 'random':
        if (nums.length === 2) return formatNumber(this.between(nums[0], nums[1], decimals), decimals);
        if (nums.length === 3) return formatNumber(nums[0] + this.between(nums[1], nums[2], decimals), decimals);
        return null;
      case 'mult':
        if (nums.length < 2) return null;
        return formatNumber(nums.reduce((a, b) => a * b, 1), 4);
      case 'plus':
        if (nums.length < 2) return null;
        return formatNumber(nums.reduce((a, b) => a + b, 0), decimals);
    }
  }

  /** a〜b（両端を含む）のランダムな数。どちらも整数なら整数、小数があればその桁数まで */
  private between(a: number, b: number, decimals: number): number {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (decimals === 0) {
      return lo + Math.floor(this.random() * (hi - lo + 1));
    }
    const scale = 10 ** decimals;
    return (Math.round(lo * scale) + Math.floor(this.random() * (Math.round((hi - lo) * scale) + 1))) / scale;
  }
}

function countDecimals(text: string): number {
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(4, text.length - dot - 1);
}

/** 数字を文字にする。浮動小数の誤差（0.30000000000000004 など）を消す */
function formatNumber(n: number, decimals: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(Math.max(decimals, 0) || 4)));
}
