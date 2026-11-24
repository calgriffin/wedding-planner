/**
 * One shared assistant chat: messages from both partners and the assistant,
 * question cards (tap an option or type an answer), proposed changes with
 * Confirm / Cancel, attachments, and polling so each partner sees the
 * other's messages and the assistant's reply as they arrive.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi, type ChatAttachment, type ChatConversation, type ChatMessage, type ChatPending, type ChatQuestion } from '../../api/chat';
import { useApp } from '../../context/AppContext';
import { Button, Spinner } from '../ui';
import { cn } from '../../utils/helpers';

const MAX_FILES = 5;
const MAX_BYTES = 4 * 1024 * 1024;

function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Light formatting the assistant uses: **bold** and "- " lists. Text only, never HTML. */
export function RichText({ text }: { text: string }) {
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>
    );
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${k}`} className="list-disc pl-5 space-y-0.5">
          {list.map((li, i) => <li key={i}>{inline(li, `li-${k}-${i}`)}</li>)}
        </ul>
      );
      list = [];
    }
  };
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*[-•*]\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush(i);
      if (line.trim()) blocks.push(<p key={`p-${i}`}>{inline(line, `p-${i}`)}</p>);
    }
  });
  flush(-1);
  return <div className="space-y-2 break-words">{blocks}</div>;
}

async function readFile(file: File): Promise<ChatAttachment> {
  let blob: Blob = file;
  let type = file.type;
  // Big photos are shrunk to fit the 4 MB limit (PDFs can't be).
  if (type.startsWith('image/') && type !== 'image/gif' && file.size > 1.5 * 1024 * 1024) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo'))), 'image/jpeg', 0.85));
    type = 'image/jpeg';
  }
  if (blob.size > MAX_BYTES) throw new Error(`${file.name} is larger than 4 MB.`);
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => rej(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(blob);
  });
  return { name: file.name, type, data };
}

function QuestionCard({ q, onAnswer, onSkip, busy }: { q: ChatQuestion; onAnswer: (q: ChatQuestion, answer: string) => void; onSkip: (q: ChatQuestion) => void; busy: boolean }) {
  const [draft, setDraft] = useState('');
  if (q.skipped) {
    return (
      <div className="mt-2 rounded-xl border border-charcoal-200 bg-charcoal-50 p-3 text-sm">
        {q.about && <p className="text-[11px] uppercase tracking-wide text-charcoal-400 mb-0.5">{q.about}</p>}
        <p className="text-charcoal-500 line-through decoration-charcoal-300">{q.question}</p>
        <p className="mt-1 text-xs text-charcoal-500">Skipped by {q.answered_by_name}. It won't be asked again.</p>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-amber-600" aria-hidden>?</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {q.about && <p className="text-[11px] uppercase tracking-wide text-amber-700 mb-0.5">{q.about}</p>}
              <p className="font-medium text-charcoal-900">{q.question}</p>
            </div>
            {!q.answered_at && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSkip(q)}
                className="shrink-0 text-xs text-charcoal-500 hover:text-charcoal-800 hover:underline disabled:opacity-50"
                title="Not relevant: close it without answering, and don't ask again"
              >
                Skip
              </button>
            )}
          </div>
          {q.answered_at ? (
            <p className="mt-1.5 text-sage-700">
              ✓ {q.answered_by_name}: <span className="text-charcoal-800">{q.answer}</span>
            </p>
          ) : (
            <>
              {q.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.options.map((o) => (
                    <button
                      key={o}
                      disabled={busy}
                      onClick={() => onAnswer(q, o)}
                      className="px-3 py-1 rounded-full border border-amber-300 bg-white text-charcoal-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="mt-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) onAnswer(q, draft.trim());
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={q.options.length ? 'Or type your own answer…' : 'Type your answer…'}
                  className="flex-1 min-w-0 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                  disabled={busy}
                />
                <Button size="sm" type="submit" disabled={busy || !draft.trim()}>Answer</Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingCard({ p, onResolve, busy }: { p: ChatPending; onResolve: (p: ChatPending, decision: 'confirm' | 'cancel') => void; busy: boolean }) {
  const done = p.status !== 'pending' && p.status !== 'running';
  return (
    <div className={cn('mt-2 rounded-xl border p-3 text-sm', done ? 'border-charcoal-200 bg-charcoal-50' : 'border-sage-300 bg-sage-50')}>
      <p className="text-[11px] uppercase tracking-wide text-charcoal-500 mb-0.5">Proposed change</p>
      <p className="text-charcoal-800 break-words">{p.summary}</p>
      {done ? (
        <p className={cn('mt-1.5 text-xs', p.status === 'confirmed' ? 'text-sage-700' : p.status === 'failed' ? 'text-red-600' : 'text-charcoal-500')}>
          {p.status === 'confirmed' ? '✓ Confirmed' : p.status === 'failed' ? `Couldn't be done: ${p.result}` : 'Cancelled'}
          {p.resolved_by_name ? ` by ${p.resolved_by_name}` : ''}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onResolve(p, 'confirm')} loading={busy} disabled={p.status === 'running'}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => onResolve(p, 'cancel')} disabled={busy || p.status === 'running'}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, mine, pending, onAnswer, onSkip, onResolve, busy }: {
  m: ChatMessage;
  mine: boolean;
  pending: ChatPending[];
  onAnswer: (m: ChatMessage, q: ChatQuestion, answer: string) => void;
  onSkip: (m: ChatMessage, q: ChatQuestion) => void;
  onResolve: (p: ChatPending, decision: 'confirm' | 'cancel') => void;
  busy: boolean;
}) {
  const [showChanges, setShowChanges] = useState(false);
  if (m.role === 'event') {
    return (
      <div className="flex justify-center my-2">
        <p className="max-w-[90%] text-center text-xs text-charcoal-500 bg-charcoal-50 rounded-lg px-3 py-1.5 whitespace-pre-line break-words">{m.text}</p>
      </div>
    );
  }
  if (m.role === 'user') {
    return (
      <div className={cn('flex my-2', mine ? 'justify-end' : 'justify-start')}>
        <div className={cn('max-w-[85%]', mine ? 'items-end' : 'items-start', 'flex flex-col')}>
          <p className="text-[11px] text-charcoal-400 mb-0.5 px-1">{mine ? 'You' : m.author_name} · {timeLabel(m.created_at)}</p>
          <div className={cn('rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words', mine ? 'bg-sage-500 text-ivory-50 rounded-br-md' : 'bg-white border border-charcoal-200 text-charcoal-900 rounded-bl-md')}>
            {m.reply_to && <p className={cn('text-xs mb-1 italic', mine ? 'text-sage-100' : 'text-charcoal-500')}>↪ {m.reply_to.question}</p>}
            {m.text}
            {m.attachments.length > 0 && (
              <p className={cn('mt-1 text-xs', mine ? 'text-sage-100' : 'text-charcoal-500')}>📎 {m.attachments.map((a) => a.name).join(', ')}</p>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex my-3 gap-2">
      <div className="w-7 h-7 shrink-0 rounded-full bg-ivory-200 text-sage-700 flex items-center justify-center text-xs font-semibold mt-4" aria-hidden>✦</div>
      <div className="max-w-[88%] min-w-0 flex-1">
        <p className="text-[11px] text-charcoal-400 mb-0.5 px-1">Assistant · {timeLabel(m.created_at)}{m.dry_run ? ' · simulation' : ''}</p>
        <div className="rounded-2xl rounded-tl-md bg-white border border-charcoal-200 px-3.5 py-2 text-sm text-charcoal-900">
          {m.status === 'thinking' ? (
            <span className="inline-flex items-center gap-2 text-charcoal-500"><Spinner size="sm" /> Thinking…</span>
          ) : m.status === 'failed' && !m.text ? (
            <p className="text-red-600">Sorry, that didn't work: {m.reason || 'something went wrong'}. Try sending it again.</p>
          ) : (
            <RichText text={m.text} />
          )}
          {m.actions.length > 0 && (
            <div className="mt-2 border-t border-charcoal-100 pt-1.5">
              <button className="text-xs text-sage-700 hover:underline" onClick={() => setShowChanges((v) => !v)}>
                {showChanges ? 'Hide' : 'Show'} {m.actions.length} change{m.actions.length === 1 ? '' : 's'} made{m.actions.some((a) => a.simulated) ? ' (simulation)' : ''}
              </button>
              {showChanges && (
                <ul className="mt-1 text-xs text-charcoal-600 list-disc pl-4 space-y-0.5 break-words">
                  {m.actions.map((a, i) => <li key={i}>{a.summary}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        {m.questions.map((q) => <QuestionCard key={q.id} q={q} busy={busy} onAnswer={(qq, a) => onAnswer(m, qq, a)} onSkip={(qq) => onSkip(m, qq)} />)}
        {pending.map((p) => <PendingCard key={p.code} p={p} busy={busy} onResolve={onResolve} />)}
      </div>
    </div>
  );
}

export function ChatThread({ conversationId, myEmail, compact = false, onChanged }: { conversationId: string; myEmail: string; compact?: boolean; onChanged?: () => void }) {
  const { showToast } = useApp();
  const [data, setData] = useState<ChatConversation | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await chatApi.get(conversationId);
      setData(d);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [conversationId]);

  useEffect(() => {
    setData(null);
    lastCount.current = 0;
    load();
  }, [load]);

  // Poll: fast while the assistant is replying, slower otherwise, and only
  // gently when the tab is hidden.
  const thinking = !!data?.messages.some((m) => m.status === 'thinking');
  useEffect(() => {
    const ms = thinking ? 2500 : document.hidden ? 20000 : 5000;
    const t = window.setInterval(load, ms);
    return () => window.clearInterval(t);
  }, [load, thinking]);

  useEffect(() => {
    const n = data ? data.messages.length + data.messages.filter((m) => m.status !== 'thinking').length : 0;
    if (n !== lastCount.current) {
      lastCount.current = n;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      // Reading the chat marks it read: let the unread badges catch up now.
      window.dispatchEvent(new Event('chat:changed'));
    }
  }, [data]);

  const send = async (body: { text: string; answer_to?: { message_id: string; question_id: string } }, withFiles: File[] = []) => {
    setSending(true);
    try {
      const attachments = await Promise.all(withFiles.map(readFile));
      // Show it straight away; the request returns once the assistant replies.
      setData((d) =>
        d && {
          ...d,
          messages: [
            ...d.messages,
            { id: `local-${Date.now()}`, role: 'user', author_email: myEmail, author_name: 'You', text: body.text, status: 'done', reason: '', actions: [], attachments: attachments.map((a) => ({ name: a.name, type: a.type, size: 0 })), questions: [], reply_to: null, dry_run: false, created_at: new Date().toISOString(), updated_at: '' },
            { id: `local-t-${Date.now()}`, role: 'assistant', author_email: '', author_name: 'Assistant', text: '', status: 'thinking', reason: '', actions: [], attachments: [], questions: [], reply_to: null, dry_run: false, created_at: new Date().toISOString(), updated_at: '' },
          ],
        }
      );
      const d = await chatApi.send(conversationId, { ...body, attachments });
      setData(d);
      onChanged?.();
      return true;
    } catch (e) {
      showToast((e as Error).message, 'error');
      load();
      return false;
    } finally {
      setSending(false);
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sending || (!text.trim() && !files.length)) return;
    const t = text.trim();
    const f = files;
    setText('');
    setFiles([]);
    const sent = await send({ text: t }, f);
    if (!sent) {
      setText(t);
      setFiles(f);
    }
  };

  const answer = (m: ChatMessage, q: ChatQuestion, a: string) => send({ text: a, answer_to: { message_id: m.id, question_id: q.id } });

  const skip = async (m: ChatMessage, q: ChatQuestion) => {
    setBusy(true);
    try {
      await chatApi.skip(m.id, q.id);
      await load();
      onChanged?.();
    } catch (e) {
      showToast((e as Error).message, 'error');
      load();
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (p: ChatPending, decision: 'confirm' | 'cancel') => {
    setBusy(true);
    try {
      const r = decision === 'confirm' ? await chatApi.confirm(p.code) : await chatApi.cancel(p.code);
      if (r.status === 'failed') showToast(`Couldn't be done: ${r.result}`, 'error');
      else showToast(decision === 'confirm' ? 'Done' : 'Cancelled', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast((e as Error).message, 'error');
      load();
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = [...files, ...Array.from(list)].filter((f) => f.type === 'application/pdf' || f.type.startsWith('image/'));
    if (picked.length > MAX_FILES) showToast(`Attach at most ${MAX_FILES} files at a time.`, 'error');
    setFiles(picked.slice(0, MAX_FILES));
  };

  if (error && !data) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-10 flex justify-center"><Spinner /></div>;

  const pendingFor = (id: string) => data.pending.filter((p) => p.message_id === id);
  const mineOf = (m: ChatMessage) => m.role === 'user' && (m.author_email === myEmail || m.id.startsWith('local-'));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn('flex-1 overflow-y-auto scrollbar-thin', compact ? 'px-3 py-2' : 'px-4 py-3')}>
        {data.messages.length === 0 && (
          <div className="text-center text-sm text-charcoal-500 py-10 px-4">
            <p className="font-medium text-charcoal-700 mb-1">Ask anything about the plan</p>
            <p>"What's still to pay this month?", "Add a task to book the cake tasting", or attach a quote or invoice and ask the assistant to file it. You'll both see this chat.</p>
          </div>
        )}
        {data.messages.map((m) => (
          <Bubble key={m.id} m={m} mine={mineOf(m)} pending={pendingFor(m.id)} onAnswer={answer} onSkip={skip} onResolve={resolve} busy={busy || sending} />
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className={cn('border-t border-charcoal-200 bg-white', compact ? 'p-2' : 'p-3')}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-charcoal-100 px-2.5 py-0.5 text-xs text-charcoal-700 max-w-full">
                <span className="truncate">📎 {f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-charcoal-500 hover:text-charcoal-900">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="shrink-0 p-2 rounded-lg text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-800" aria-label="Attach a PDF or photo" title="Attach a PDF or photo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={thinking ? 'The assistant is replying…' : 'Message the assistant…'}
            className="flex-1 min-w-0 resize-none max-h-40 rounded-xl border border-charcoal-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <Button type="submit" disabled={sending || thinking || (!text.trim() && !files.length)} loading={sending} aria-label="Send">
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
