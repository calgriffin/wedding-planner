/**
 * Floating chat button on every planner page (except the Assistant page
 * itself), with a badge for unread chats and open questions. Opens a side
 * panel with the chat list and a thread; the panel's code loads on first open.
 */
import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../../api/chat';
import { Spinner } from '../ui';

const ChatPanel = lazy(() => import('./ChatPanel'));

export function useChatBadge() {
  const [counts, setCounts] = useState({ unread: 0, open_questions: 0, pending: 0 });
  const load = useCallback(() => chatApi.unread().then(setCounts).catch(() => undefined), []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => !document.hidden && load(), 30000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('chat:changed', onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('chat:changed', onFocus);
    };
  }, [load]);
  return counts;
}

export function ChatBubble() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const counts = useChatBadge();
  const badge = counts.unread + counts.open_questions;
  useEffect(() => setOpen(false), [pathname]);
  if (pathname.startsWith('/assistant')) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-40 bottom-5 right-5 w-14 h-14 rounded-full bg-sage-500 text-ivory-50 shadow-lg hover:bg-sage-600 flex items-center justify-center print:hidden"
          aria-label={`Open the assistant chat${badge ? ` (${badge} new)` : ''}`}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
            <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
          </svg>
          {badge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>
          )}
        </button>
      )}
      {open && (
        <Suspense fallback={<div className="fixed z-50 bottom-5 right-5 bg-white rounded-xl shadow-xl p-6"><Spinner /></div>}>
          <ChatPanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
