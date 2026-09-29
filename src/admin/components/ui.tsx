// 管理画面で何度も使う部品

import { useState, type ReactNode } from 'react';

export type Tone = 'gray' | 'blue' | 'yellow' | 'green' | 'red';

/** 状態を色付きの丸と文字で表す */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-header">
          <h2>{title}</h2>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

/** 押すと処理が終わるまで「処理中」になるボタン。エラーはボタンの横に出す */
export function ActionButton({
  onClick,
  children,
  kind = 'normal',
  confirm,
  disabled,
}: {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  kind?: 'normal' | 'primary' | 'danger' | 'small';
  confirm?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="action">
      <button
        type="button"
        className={`button button-${kind}`}
        disabled={busy || disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '処理中…' : children}
      </button>
      {error && <span className="action-error">{error}</span>}
    </span>
  );
}

/** 入力欄と、その説明 */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** 数字と、何を数えたものかの短い説明（要件 8.） */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** クリックでURLなどをコピーする */
export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy">
      <code>{text}</code>
      <button
        type="button"
        className="button button-small"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </span>
  );
}
