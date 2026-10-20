// Approval cards for live permission requests and AskUserQuestion prompts (used by the project inbox).
// Visual language adapted from affectUI's free decision-inbox (MIT): gray tray, card on top, light primary button.
import { useState } from 'react';
import { Check, MessageCircleQuestion, ShieldQuestion, Terminal, X } from 'lucide-react';
import { agentName, ago, cn, projectName, rel } from '../lib';
import type { ApprovalRequest, Decision, Question, Session } from '../types';

type Props = {
  requests: ApprovalRequest[];
  sessions: Record<string, Session>;
  now: number;
  onDecide: (id: string, d: Decision) => Promise<boolean>;
  onOpenSession: (id: string) => void;
};

const RESOLVED_LABEL: Record<string, string> = {
  allowed: 'İzin verildi',
  denied: 'Reddedildi',
  answered: 'Cevaplandı',
  elsewhere: 'Başka yerden',
};

export function RecentList({ recent }: { recent: ApprovalRequest[] }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {recent.map((r) => (
        <li key={r.id} className="flex items-center gap-2 rounded-lg py-1 text-xs text-faint">
          {r.status === 'denied' ? <X className="size-3.5 text-err" /> : r.status === 'elsewhere' ? <Terminal className="size-3.5" /> : <Check className="size-3.5 text-ok" />}
          <span className="truncate text-muted">{r.kind === 'question' ? r.toolInput.questions?.[0]?.question : `${r.toolName} · ${preview(r).title}`}</span>
          <span className="ml-auto shrink-0">{RESOLVED_LABEL[r.status]}</span>
        </li>
      ))}
    </ul>
  );
}

export function RequestCard({ r, session, now, first, onDecide, onOpenSession }: { r: ApprovalRequest; session?: Session; first: boolean } & Omit<Props, 'requests' | 'sessions'>) {
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const send = async (d: Decision) => {
    setBusy(true);
    const ok = await onDecide(r.id, d);
    if (!ok) setBusy(false); // already answered elsewhere; the SSE update will retire the card
  };
  const who = agentName(session, r.agentId);

  return (
    <div className={cn('enter px-4 py-3.5', !first && 'border-t border-line')}>
      <div className="flex items-center gap-2 text-[11px] text-faint">
        {r.kind === 'question' ? <MessageCircleQuestion className="size-3.5 text-alert" /> : <ShieldQuestion className="size-3.5 text-alert" />}
        <button className="truncate hover:text-ink" onClick={() => onOpenSession(r.sessionId)} title={r.cwd}>
          {projectName(r.cwd)}
        </button>
        <span>·</span>
        <span className="truncate">{who}</span>
        <span className="ml-auto shrink-0">{ago(r.createdAt, now)}</span>
      </div>

      {r.kind === 'question' ? (
        <QuestionForm r={r} busy={busy} onSubmit={(answers) => send({ behavior: 'allow', answers })} onSkip={() => send({ behavior: 'deny', message: 'The user skipped this question on agent-board.' })} />
      ) : (
        <>
          <PermissionPreview r={r} />
          {denying ? (
            <div className="mt-3 space-y-2">
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Neden? Claude bunu okuyup yönünü değiştirir (isteğe bağlı)"
                className="w-full resize-none rounded-lg bg-tile px-2.5 py-2 text-[13px] text-ink placeholder:text-faint ring-line focus:outline-none"
              />
              <div className="flex gap-2">
                <button className="btn btn-danger" disabled={busy} onClick={() => send({ behavior: 'deny', message: reason.trim() || 'Denied from agent-board.' })}>
                  Reddet
                </button>
                <button className="btn" onClick={() => setDenying(false)}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={() => send({ behavior: 'allow' })}>
                İzin ver
              </button>
              {r.suggestions.length > 0 && (
                <button className="btn" disabled={busy} onClick={() => send({ behavior: 'allow', remember: true })} title="Claude'un önerdiği kuralı bu oturum için ekler">
                  Bu oturumda hep izin ver
                </button>
              )}
              <button className="btn btn-danger" disabled={busy} onClick={() => setDenying(true)}>
                Reddet…
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- permission preview -----------------------------------------------------

function preview(r: ApprovalRequest): { title: string; body?: string; diff?: { old: string; new: string } } {
  const i = r.toolInput as Record<string, string>;
  const shortPath = (p = '') => rel(p, r.cwd);
  switch (r.toolName) {
    case 'Bash':
      return { title: i.description || 'Komut çalıştırmak istiyor', body: rel(i.command, r.cwd) };
    case 'Write':
      return { title: shortPath(i.file_path), body: i.content };
    case 'Edit':
      return { title: shortPath(i.file_path), diff: { old: i.old_string || '', new: i.new_string || '' } };
    case 'NotebookEdit':
      return { title: shortPath(i.notebook_path), body: i.new_source };
    case 'WebFetch':
      return { title: i.url, body: i.prompt };
    default:
      return { title: r.toolName, body: JSON.stringify(r.toolInput, null, 2) };
  }
}


function PermissionPreview({ r }: { r: ApprovalRequest }) {
  const p = preview(r);
  const lines = (s: string, n = 14) => {
    const all = s.split('\n');
    return all.length > n ? [...all.slice(0, n), `… +${all.length - n} satır`] : all;
  };
  return (
    <>
      <p className="mt-1.5 text-sm font-medium text-ink">
        <span className="font-mono text-[12.5px] text-alert">{r.toolName}</span> <span className="break-all">{p.title}</span>
      </p>
      {p.body && (
        <pre className="scroll-thin mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-tile p-2.5 font-mono text-[11.5px] leading-[18px] text-text ring-line">
          {lines(p.body).join('\n')}
        </pre>
      )}
      {p.diff && (
        <pre className="scroll-thin mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-tile py-2 font-mono text-[11.5px] leading-[18px] ring-line">
          {lines(p.diff.old, 8).map((l, i) => (
            <div key={`o${i}`} className="bg-err/10 px-2.5 text-err">
              - {l}
            </div>
          ))}
          {lines(p.diff.new, 8).map((l, i) => (
            <div key={`n${i}`} className="bg-ok/10 px-2.5 text-ok">
              + {l}
            </div>
          ))}
        </pre>
      )}
    </>
  );
}

// ---- AskUserQuestion ---------------------------------------------------------

function QuestionForm({ r, busy, onSubmit, onSkip }: { r: ApprovalRequest; busy: boolean; onSubmit: (a: Record<string, string>) => void; onSkip: () => void }) {
  const questions: Question[] = r.toolInput.questions || [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const toggle = (q: Question, label: string) =>
    setPicked((p) => {
      const cur = p[q.question] || [];
      if (!q.multiSelect) return { ...p, [q.question]: [label] };
      return { ...p, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });

  const answers = Object.fromEntries(
    questions.map((q) => {
      const typed = other[q.question]?.trim();
      const chosen = picked[q.question] || [];
      return [q.question, typed ? [...chosen, typed].join(', ') : chosen.join(', ')];
    })
  );
  const complete = questions.every((q) => answers[q.question]);

  return (
    <div className="mt-2 space-y-4">
      {questions.map((q) => (
        <fieldset key={q.question}>
          <legend className="text-sm font-medium text-ink">
            {q.header && <span className="mr-2 rounded-md bg-tile px-1.5 py-0.5 text-[11px] font-medium text-muted ring-line">{q.header}</span>}
            {q.question}
          </legend>
          <div className="mt-2 space-y-1.5">
            {q.options.map((o) => {
              const on = (picked[q.question] || []).includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(q, o.label)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors duration-150',
                    on ? 'bg-raise ring-strong' : 'bg-tile ring-line hover:bg-raise'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors',
                      q.multiSelect ? 'rounded-[5px]' : 'rounded-full',
                      on ? 'border-ink bg-ink text-page' : 'border-faint'
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                    {o.description && <span className="block text-xs text-muted">{o.description}</span>}
                  </span>
                </button>
              );
            })}
            <input
              value={other[q.question] || ''}
              onChange={(e) => setOther((p) => ({ ...p, [q.question]: e.target.value }))}
              placeholder="Diğer… (kendi cevabını yaz)"
              className="w-full rounded-xl bg-tile px-3 py-2 text-[13px] text-ink placeholder:text-faint ring-line focus:outline-none"
            />
          </div>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || !complete} onClick={() => onSubmit(answers)}>
          Gönder
        </button>
        <button className="btn" disabled={busy} onClick={onSkip}>
          Atla
        </button>
      </div>
    </div>
  );
}
