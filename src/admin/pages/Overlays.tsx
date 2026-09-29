// オーバーレイの画面：OBSに入れるURLと、入れ方（要件 O-1〜O-5）

import { api, type AppState } from '../api.ts';
import { ActionButton, Card, CopyText, StatusBadge } from '../components/ui.tsx';

const OVERLAYS = [
  {
    name: 'alert',
    title: 'アラート',
    description: 'ギフトなどが来た時に、名前とギフトを画面の上に出します。',
    size: '幅 1920 × 高さ 1080（配信の画面と同じ大きさ）',
    audio: false,
  },
  {
    name: 'speech',
    title: '読み上げ（音だけ）',
    description: 'VOICEVOXで作った読み上げの音を鳴らします。画面には何も出ません。',
    size: '幅 300 × 高さ 100（小さくてよい）',
    audio: true,
  },
];

export function OverlaysPage({ state }: { state: AppState }) {
  return (
    <div className="page-stack">
      <Card
        title="OBSに入れるオーバーレイ"
        actions={
          <ActionButton kind="small" onClick={() => api('POST', '/api/overlays/reload')}>
            全部を再読み込み
          </ActionButton>
        }
      >
        <ol className="steps">
          <li>OBSの「ソース」の＋ボタン →「ブラウザ」を選んで、名前を付けて「OK」</li>
          <li>「URL」に下のURLを貼り付け、「幅」「高さ」を下の大きさにする</li>
          <li>音を出すもの（読み上げ）は「OBSで音声を制御する」にチェックを入れる</li>
          <li>「OK」を押す。この画面の表示が「表示中」になれば、つながっています</li>
        </ol>
        <p className="muted small">
          背景は透明なので、配信の画面の上に重ねて使えます。本体を再起動しても、オーバーレイは自動でつなぎ直します（URLを貼り直す必要はありません）。
        </p>
      </Card>

      {OVERLAYS.map((o) => {
        const count = state.overlays[o.name] ?? 0;
        return (
          <Card
            key={o.name}
            title={o.title}
            actions={<StatusBadge tone={count > 0 ? 'green' : 'gray'}>{count > 0 ? `${count}つ表示中` : 'OBSにありません'}</StatusBadge>}
          >
            <p>{o.description}</p>
            <p>
              URL：<CopyText text={`${state.app.overlayBaseUrl}${o.name}/`} />
            </p>
            <p className="small">おすすめの大きさ：{o.size}</p>
            {o.audio && <p className="small">「OBSで音声を制御する」にチェックを入れてください。</p>}
          </Card>
        );
      })}

      <Card title="見た目を変えるには">
        <p className="small">
          プロジェクトの <code>overlays</code> フォルダの中の <code>style.css</code> を、メモ帳などで開いて書き換えます（色や大きさは、値を直接書いてあります）。
          書き換えたら「全部を再読み込み」を押すと反映されます。新しい演出が欲しい時は、Claude Codeに頼めば <code>overlays/_template</code> をもとに作れます。
        </p>
      </Card>
    </div>
  );
}
