// メディア（要件 A-1）のテスト
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_MEDIA_BYTES, MediaStore, kindOf, safeFileName } from '../src/server/actions/mediaStore.ts';

function tempStore(): MediaStore {
  const store = new MediaStore(mkdtempSync(join(tmpdir(), 'tlt-media-')));
  store.ensure();
  return store;
}

describe('ファイル名の安全化', () => {
  it('フォルダをさかのぼる書き方は消す', () => {
    expect(safeFileName('../../秘密.png')).toBe('秘密.png');
    expect(safeFileName('C:\\Windows\\system32\\evil.mp4')).toBe('evil.mp4');
    expect(safeFileName('/etc/passwd.png')).toBe('passwd.png');
  });

  it('Windowsで使えない文字は _ にする', () => {
    expect(safeFileName('あ:い*う?.png')).toBe('あ_い_う_.png');
  });

  it('扱えない拡張子は null', () => {
    expect(safeFileName('危ない.exe')).toBe(null);
    expect(safeFileName('script.js')).toBe(null);
    expect(safeFileName('拡張子なし')).toBe(null);
  });

  it('名前が空になる時は media にする', () => {
    // 先頭の . を落とすと名前が残らない場合
    expect(safeFileName('...png')).toBe('media.png');
  });

  it('拡張子のない隠しファイル（.png という名前そのもの）は断る', () => {
    expect(safeFileName('.png')).toBe(null);
  });

  it('日本語のファイル名はそのまま使える', () => {
    expect(safeFileName('ゾンビ召喚.mp4')).toBe('ゾンビ召喚.mp4');
  });
});

describe('種類の見分け', () => {
  it('拡張子から決める（大文字でもよい）', () => {
    expect(kindOf('a.MP4')).toBe('video');
    expect(kindOf('a.webm')).toBe('video');
    expect(kindOf('a.gif')).toBe('image');
    expect(kindOf('a.png')).toBe('image');
    expect(kindOf('a.mp3')).toBe('audio');
    expect(kindOf('a.txt')).toBe(null);
  });
});

describe('メディアの置き場', () => {
  it('入れて、一覧に出て、消せる', () => {
    const store = tempStore();
    expect(store.list()).toEqual([]);

    const saved = store.save('ゾンビ.mp4', Buffer.from('ダミーの動画'));
    expect(saved.name).toBe('ゾンビ.mp4');
    expect(saved.kind).toBe('video');
    expect(store.has('ゾンビ.mp4')).toBe(true);
    expect(store.list().map((f) => f.name)).toEqual(['ゾンビ.mp4']);
    expect(readFileSync(join(store.folder, 'ゾンビ.mp4'), 'utf8')).toBe('ダミーの動画');

    expect(store.remove('ゾンビ.mp4')).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.remove('ゾンビ.mp4')).toBe(false);
  });

  it('同じ名前は -2, -3 と番号を付ける', () => {
    const store = tempStore();
    expect(store.save('音.mp3', Buffer.from('1')).name).toBe('音.mp3');
    expect(store.save('音.mp3', Buffer.from('2')).name).toBe('音-2.mp3');
    expect(store.save('音.mp3', Buffer.from('3')).name).toBe('音-3.mp3');
    expect(store.list()).toHaveLength(3);
  });

  it('扱えない種類は入れられない', () => {
    const store = tempStore();
    expect(() => store.save('危ない.exe', Buffer.from('x'))).toThrow(/入れられません/);
    expect(store.list()).toEqual([]);
  });

  it('空のファイルと、大きすぎるファイルは断る', () => {
    const store = tempStore();
    expect(() => store.save('a.png', Buffer.alloc(0))).toThrow(/中身がありません/);
    expect(() => store.save('a.png', Buffer.alloc(MAX_MEDIA_BYTES + 1))).toThrow(/大きすぎます/);
  });

  it('フォルダをさかのぼる名前で入れても、フォルダの外には書かない', () => {
    const store = tempStore();
    const saved = store.save('../../のっとり.png', Buffer.from('x'));
    expect(saved.name).toBe('のっとり.png');
    expect(existsSync(join(store.folder, 'のっとり.png'))).toBe(true);
    expect(existsSync(join(store.folder, '..', '..', 'のっとり.png'))).toBe(false);
  });

  it('has は、フォルダの外を指す名前には false を返す', () => {
    const store = tempStore();
    store.save('ある.png', Buffer.from('x'));
    expect(store.has('ある.png')).toBe(true);
    expect(store.has('../ある.png')).toBe(false);
    expect(store.has('ない.png')).toBe(false);
  });

  it('扱えない種類のファイルが直に置かれていても、一覧には出さない', () => {
    const store = tempStore();
    store.save('出る.png', Buffer.from('x'));
    writeFileSync(join(store.folder, 'メモ.txt'), 'これは出ない');
    expect(store.list().map((f) => f.name)).toEqual(['出る.png']);
  });

  it('フォルダがなくても、一覧は空で返る（落ちない）', () => {
    const store = new MediaStore(join(tmpdir(), 'tlt-media-ない-' + Date.now()));
    expect(store.list()).toEqual([]);
  });
});
