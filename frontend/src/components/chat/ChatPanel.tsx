/** The floating assistant panel: chat list, or one chat, plus a link to the full page. */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { chatApi, type ChatConversationSummary, type ChatMe } from '../../api/chat';
import { ChatThread } from './ChatThread';
import { ChatList } from './ChatList';
import { Button, Spinner } from '../ui';
import { useApp } from '../../context/AppContext';

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const { showToast } = useApp();
  const [me, setMe] = useState<ChatMe | null>(null);
  const [items, setItems] = useState<ChatConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState('');

  const loadList = useCallback(() => chatApi.list().then(setItems).catch(() => undefined), []);
  useEffect(() => {
    chatApi.me().then(setMe).catch((e) => showToast(e.message, 'error'));
    loadList();
    const t = window.setInterval(loadList, 10000);
    return () => window.clearInterval(t);
  }, [loadList, showToast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changed = () => {
    loadList();
    window.dispatchEvent(new Event('chat:changed'));
  };

  const newChat = async () => {
    try {
      const c = await chatApi.create();
      setActiveId(c.id);
      loadList();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const active = items?.find((c) => c.id === activeId);

  return (
    <div
      role="dialog"
      aria-label="Assistant chat"
      className="fixed z-50 inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[26rem] sm:h-[min(40rem,calc(100vh-2.5rem))] bg-ivory-50 sm:rounded-2xl shadow-2xl border border-charcoal-200 flex flex-col overflow-hidden print:hidden"
    >
      <div className="px-3 py-2.5 bg-white border-b border-charcoal-200 flex items-center gap-2">
        {activeId ? (
          <button onClick={() => { setActiveId(''); changed(); }} className="text-charcoal-500 hover:text-charcoal-900 px-1" aria-label="Back to chats">←</button>
        ) : null}
        <span className="flex-1 min-w-0 truncate font-medium text-charcoal-900">{activeId ? active?.title || 'Chat' : 'Assistant'}</span>
        <Link to={activeId ? `/assistant?c=${encodeURIComponent(activeId)}` : '/assistant'} className="text-xs text-sage-700 hover:underline">Open full page</Link>
        <button onClick={onClose} className="text-charcoal-500 hover:text-charcoal-900 px-1" aria-label="Close">✕</button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {!me ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : activeId ? (
          <ChatThread key={activeId} conversationId={activeId} myEmail={me.email} compact onChanged={changed} />
        ) : (
          <>
            <div className="p-3 border-b border-charcoal-100 bg-white">
              <Button className="w-full" onClick={newChat}>New chat</Button>
              {!me.ai.configured && <p className="mt-2 text-xs text-charcoal-500">The AI isn't switched on yet, so nobody will reply.</p>}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin bg-white">
              {items ? <ChatList items={items} onSelect={(id) => setActiveId(id)} /> : <div className="p-6 flex justify-center"><Spinner /></div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
