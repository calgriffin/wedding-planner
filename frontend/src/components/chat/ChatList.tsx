/** The shared list of assistant chats (used by the Assistant page and the floating panel). */
import React from 'react';
import type { ChatConversationSummary } from '../../api/chat';
import { cn } from '../../utils/helpers';

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const KIND_ICON: Record<string, string> = { chat: '', checkin: '✦ ', email: '✉ ' };

export function ChatList({ items, activeId, onSelect }: { items: ChatConversationSummary[]; activeId?: string; onSelect: (id: string) => void }) {
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-charcoal-500">No chats yet.</p>;
  return (
    <ul className="divide-y divide-charcoal-100">
      {items.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onSelect(c.id)}
            className={cn('w-full text-left px-4 py-3 hover:bg-sage-50 transition-colors', activeId === c.id && 'bg-sage-100 hover:bg-sage-100')}
          >
            <div className="flex items-center gap-2">
              {c.unread && <span className="w-2 h-2 rounded-full bg-sage-500 shrink-0" aria-label="Unread" />}
              <span className={cn('flex-1 min-w-0 truncate text-sm', c.unread ? 'font-semibold text-charcoal-900' : 'text-charcoal-800')}>
                {KIND_ICON[c.kind] || ''}{c.title}
              </span>
              <span className="text-[11px] text-charcoal-400 shrink-0">{when(c.updated_at)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-xs text-charcoal-500">
                {c.thinking ? 'Assistant is replying…' : c.last_text ? `${c.last_author_name ? `${c.last_author_name}: ` : ''}${c.last_text.replace(/\*\*/g, '').replace(/\s+/g, ' ')}` : 'No messages yet'}
              </span>
              {c.open_questions > 0 && <span className="shrink-0 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium px-1.5 py-0.5">{c.open_questions} question{c.open_questions === 1 ? '' : 's'}</span>}
              {c.pending_count > 0 && <span className="shrink-0 rounded-full bg-sage-100 text-sage-800 text-[10px] font-medium px-1.5 py-0.5">to confirm</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
