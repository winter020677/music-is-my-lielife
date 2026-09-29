// 記録の画面
// ・フェーズ0の確認用の数字（入室の通知が全員分届くか、Euler Streamの使用回数）
// ・配信の一覧（V-1のかんたん版。詳しい分析画面はフェーズ2）
// ・データベースの大きさ（要件 N-11）とバックアップ（要件 D-10）

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  type AppState,
} from '../api.ts';
import { ActionButton, Card, Stat } from '../components/ui.tsx';
import type { Phase0Check, StreamRow, DbInfo } from '../../server/db/queries.ts';
import type { BackupStatus } from '../../server/db/backup.ts';

interface Info {
  db: DbInfo;
  backup: BackupStatus;
  dataDir: string;
}

export function RecordsPage({ state }: { state: AppState }) {
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [includeTest, setIncludeTest] = useState(false);
  const [check, setCheck] = useState<Phase0Check | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c, i] = await Promise.all([
        api<{ streams: StreamRow[] }>('GET', `/api/records/streams?limit=100${includeTest ? '&includeTest=1' : ''}`),
        api<Phase0Check>('GET', '/api/records/phase0'),
        api<Info>('GET', '/api/records/info'),
      ]);
      setStreams(s.streams);
      setCheck(c);
      setInfo(i);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [includeTest]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="page-stack">
      {error && <div className="banner banner-red">{error}</div>}
      <Phase0Card check={check} euler={state.euler} />

      <Card
        title="配信の一覧"
        actions={
          <>
            <label className="inline-check">
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
              テスト用も表示
            </label>
            <ActionButton kind="small" onClick={load}>
              更新
            </ActionButton>
          </>
        }
      >
        {streams.length === 0 ? (
          <p className="muted">まだ記録された配信はありません。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>開始（日本時間）</th>
                  <th>配信時間</th>
                  <th>最大視聴者</th>
                  <th>来場者</th>
                  <th>コイン</th>
                  <th>ギフト</th>
                  <th>いいね</th>
                  <th>コメント</th>
                  <th>新規フォロー</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((s) => (
                  <tr key={s.id} className={s.is_test ? 'row-test' : ''}>
                    <td>
                      {formatDateTime(s.started_at)}
                      {s.started_at_estimated ? <span className="tag tag-late">推定</span> : null}
                      {s.is_test ? <span className="tag tag-test">テスト</span> : null}
                      {!s.ended_at && !s.is_test && <span className="tag tag-live">配信中</span>}
                    </td>
                    <td>
                      {formatDuration(s.duration_sec)}
                      {s.ended_at_estimated ? <span className="tag tag-late">推定</span> : null}
                    </td>
                    <td className="num">{formatNumber(s.max_viewers)}</td>
                    <td className="num">{formatNumber(s.visitor_count)}</td>
                    <td className="num">{formatNumber(s.coin_total)}</td>
                    <td className="num">{formatNumber(s.gift_count)}</td>
                    <td className="num">{formatNumber(s.like_count)}</td>
                    <td className="num">{formatNumber(s.comment_count)}</td>
                    <td className="num">{formatNumber(s.follow_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          来場者＝コメント・いいね・入室など、何か1つでもデータが届いた人の数（重複なし）。「推定」は、TikTokから時刻が取れなかったり、本体が途中で止まったりして、分かる範囲の時刻で記録したもの。合計は1分ごとに数え直します。
        </p>
      </Card>

      {info && <DatabaseCard info={info} onChanged={load} />}
    </div>
  );
}

function Phase0Card({ check, euler }: { check: Phase0Check | null; euler: AppState['euler'] }) {
  const c = check?.counters ?? {};
  const s = check?.stream;
  return (
    <Card title="フェーズ0の確認（最新の配信）">
      <p className="muted small">
        短いテスト配信のあとに、この数字を見て、要件定義書の「フェーズ0」の結果に書き足します（README の手順を参照）。
      </p>
      {!s ? (
        <p className="muted">まだ配信の記録がありません。</p>
      ) : (
        <>
          <p className="small">
            {formatDateTime(s.started_at)} 開始・{s.ended_at ? `配信時間 ${formatDuration(s.duration_sec)}` : '配信中'}
          </p>
          <div className="stats">
            <Stat label="最大同時視聴者" value={formatNumber(s.max_viewers)} note="TikTokが知らせる視聴者数の最大" />
            <Stat label="TikTokの累計視聴者" value={formatNumber(s.tiktok_total_viewers)} note="TikTokが知らせる、見に来た人の累計" />
            <Stat label="来場者" value={formatNumber(s.visitor_count)} note="何か1つでもデータが届いた人" />
            <Stat label="入室通知が届いた人" value={formatNumber(s.joined_count)} />
            <Stat
              label="入室通知が届いた割合"
              value={check?.joinCoveragePercent === null || check?.joinCoveragePercent === undefined ? '―' : `${check.joinCoveragePercent}%`}
              note="来場者のうち、入室通知も届いた人"
            />
            <Stat label="入室通知なしで来た人" value={formatNumber(check?.seenWithoutJoin)} note="コメント等は届いたのに入室通知が来なかった人" />
          </div>
        </>
      )}
      <h3>今日のEuler Streamと接続の回数（UTCの日付：{euler.day}）</h3>
      <div className="stats">
        <Stat label="Euler Stream 合計" value={`${formatNumber(euler.used)}回`} />
        <Stat label="うち 接続の署名" value={formatNumber(euler.byRoute.fetchSignedWebSocketFromProvider ?? 0)} />
        <Stat label="うち 配信待ちの確認" value={formatNumber(euler.byRoute.fetchRoomIdFromProvider ?? 0)} />
        <Stat label="配信待ちの確認（TikTokのページ）" value={formatNumber(c['liveCheck.html'] ?? 0)} note="Euler Streamを使わない" />
        <Stat label="配信待ちの確認（TikTokのAPI）" value={formatNumber(c['liveCheck.api'] ?? 0)} note="Euler Streamを使わない" />
        <Stat label="配信待ちの確認（Euler Stream）" value={formatNumber(c['liveCheck.euler'] ?? 0)} note="1回につき1リクエスト" />
        <Stat label="確認の失敗" value={formatNumber(c['liveCheck.failed'] ?? 0)} />
        <Stat label="接続できた回数" value={formatNumber(c['connect.ok'] ?? 0)} />
        <Stat label="切れた回数" value={formatNumber(c['connect.dropped'] ?? 0)} />
        <Stat label="接続の失敗" value={formatNumber(c['connect.failed'] ?? 0)} />
      </div>
      <div className="button-row">
        <ActionButton kind="small" onClick={() => api('POST', '/api/tiktok/rate-limits')}>
          Euler Streamに残り回数を聞く
        </ActionButton>
        {euler.remote?.day && (
          <span className="muted small">
            残り {formatNumber(euler.remote.day.remaining)} / {formatNumber(euler.remote.day.max)} 回（{formatDateTime(euler.remote.fetchedAt)} 時点）
          </span>
        )}
      </div>
    </Card>
  );
}

function DatabaseCard({ info, onChanged }: { info: Info; onChanged: () => Promise<void> }) {
  return (
    <Card title="データベースとバックアップ">
      <table className="kv">
        <tbody>
          <tr>
            <th>データの場所</th>
            <td>
              <code>{info.dataDir}</code>
            </td>
          </tr>
          <tr>
            <th>データベースの大きさ</th>
            <td>
              {formatBytes(info.db.bytes)}（表の構造：版{info.db.schemaVersion}）
              {info.db.tooLarge && <span className="tag tag-late">大きくなっています。古い記録の整理を相談してください</span>}
            </td>
          </tr>
          <tr>
            <th>バックアップ先</th>
            <td>
              <code>{info.backup.folder}</code>
            </td>
          </tr>
          <tr>
            <th>最後のバックアップ</th>
            <td>
              {info.backup.lastAt ? formatDateTime(info.backup.lastAt) : 'まだありません'}
              {info.backup.lastError && <div className="action-error">失敗：{info.backup.lastError}</div>}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="button-row">
        <ActionButton
          kind="small"
          onClick={async () => {
            const r = await api<{ ok: boolean; error?: string }>('POST', '/api/records/backup');
            if (!r.ok) throw new Error(r.error ?? '失敗しました');
            await onChanged();
          }}
        >
          今すぐバックアップ
        </ActionButton>
        <ActionButton kind="small" onClick={() => api('POST', '/api/app/open-folder', { which: 'data' })}>
          データのフォルダを開く
        </ActionButton>
        <ActionButton kind="small" onClick={() => api('POST', '/api/app/open-folder', { which: 'backup' })}>
          バックアップのフォルダを開く
        </ActionButton>
        <ActionButton kind="small" onClick={() => api('POST', '/api/app/open-folder', { which: 'logs' })}>
          ログのフォルダを開く
        </ActionButton>
      </div>
    </Card>
  );
}
