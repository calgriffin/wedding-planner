/**
 * Assistant: the planner's AI chat (same assistant as the email one). Every
 * chat is shared between both partners. The assistant also posts its own
 * questions here (daily check-in, or from an email).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { chatApi, type ChatConversationSummary, type ChatMe } from '../api/chat';
import { ChatThread } from '../components/chat/ChatThread';
import { ChatList } from '../components/chat/ChatList';
import { NotificationSettings } from '../components/chat/NotificationSettings';
import { UsageCard } from '../components/chat/UsageCard';
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui';
import { useApp } from '../context/AppContext';
import { cn } from '../utils/helpers';

export default function AssistantPage() {
  const { showToast } = useApp();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c') || '';
  const [me, setMe] = useState<ChatMe | null>(null);
  const [items, setItems] = useState<ChatConversationSummary[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [asking, setAsking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUsage, setShowUsage] = useState(false);

  const loadMe = useCallback(() => chatApi.me().then(setMe).catch((e) => showToast(e.message, 'error')), [showToast]);
  const loadList = useCallback(() => chatApi.list(archived).then(setItems).catch(() => undefined), [archived]);
  useEffect(() => {
    window.addEventListener('chat:changed', loadList);
    return () => window.removeEventListener('chat:changed', loadList);
  }, [loadList]);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    loadList();
    const t = window.setInterval(loadList, 10000);
    return () => window.clearInterval(t);
  }, [loadList]);

  const select = (id: string) => setParams(id ? { c: id } : {});

  const newChat = async () => {
    try {
      const c = await chatApi.create();
      await loadList();
      select(c.id);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const askNow = async () => {
    setAsking(true);
    try {
      const r = await chatApi.checkin();
      await loadList();
      if (r.status === 'open questions') {
        showToast(`${r.count} question${r.count === 1 ? ' is' : 's are'} still waiting. Answer or skip ${r.count === 1 ? 'it' : 'them'} first.`, 'info');
        if (r.conversationId) select(r.conversationId);
      } else if (r.status === 'already running') {
        showToast('A check-in is already running. It will appear here in a moment.', 'info');
      } else if (r.conversationId) {
        select(r.conversationId);
      } else {
        showToast(r.status === 'nothing to ask' ? 'Nothing to ask right now. The plan looks complete.' : `Check-in: ${r.problem || r.status}`, r.status === 'nothing to ask' ? 'success' : 'error');
      }
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setAsking(false);
    }
  };

  const active = items?.find((c) => c.id === activeId);
  const toggleArchive = async () => {
    if (!activeId) return;
    try {
      await chatApi.update(activeId, { archived: !active?.archived && !archived });
      select('');
      loadList();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  if (!me) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Assistant"
        subtitle={`Chat with your planner's AI. Both ${me.couple.length ? me.couple.map((c) => c.name).join(' and ') : 'of you'} see every chat, and it will ask you questions here when it needs something.`}
        badge={me.ai.dry_run ? <Badge tone="warning">Simulation</Badge> : undefined}
      />
      {/* Own row (not PageHeader actions) so the buttons wrap on a phone. */}
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={newChat}>New chat</Button>
        {me.ai.configured && <Button size="sm" variant="outline" onClick={askNow} loading={asking}>Any questions for us?</Button>}
        <Button size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)}>Notifications</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowUsage((v) => !v)}>Usage &amp; cost</Button>
      </div>

      {!me.ai.configured && (
        <Card className="mb-4">
          <p className="text-sm text-charcoal-700">The AI isn't switched on yet: the Worker needs its <code>ANTHROPIC_API_KEY</code> secret (the same one the email assistant uses). Until then, messages here are shared between you but nobody replies.</p>
        </Card>
      )}
      {showSettings && <div className="mb-4"><NotificationSettings me={me} onChanged={loadMe} /></div>}
      {showUsage && <div className="mb-4"><UsageCard /></div>}

      <div className="bg-white border border-charcoal-200 rounded-xl overflow-hidden flex h-[calc(100vh-14rem)] min-h-[28rem]">
        <aside className={cn('w-full md:w-80 md:border-r border-charcoal-200 flex-col min-h-0', activeId ? 'hidden md:flex' : 'flex')}>
          <div className="px-4 py-2.5 border-b border-charcoal-100 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{archived ? 'Archived' : 'Chats'}</span>
            <button className="text-xs text-sage-700 hover:underline" onClick={() => { setArchived((v) => !v); select(''); }}>
              {archived ? 'Back to chats' : 'Archived'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {items ? <ChatList items={items} activeId={activeId} onSelect={select} /> : <div className="p-6 flex justify-center"><Spinner /></div>}
          </div>
        </aside>
        <section className={cn('flex-1 min-w-0 flex-col min-h-0', activeId ? 'flex' : 'hidden md:flex')}>
          {activeId ? (
            <>
              <div className="px-4 py-2.5 border-b border-charcoal-100 flex items-center gap-2">
                <button className="md:hidden text-charcoal-500 mr-1" onClick={() => select('')} aria-label="Back to chats">←</button>
                <h2 className="flex-1 min-w-0 truncate font-sans text-base font-medium text-charcoal-900">{active?.title || 'Chat'}</h2>
                <button className="text-xs text-charcoal-500 hover:text-charcoal-800" onClick={toggleArchive}>{active?.archived || archived ? 'Unarchive' : 'Archive'}</button>
              </div>
              <div className="flex-1 min-h-0">
                <ChatThread key={activeId} conversationId={activeId} myEmail={me.email} onChanged={loadList} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <p className="font-serif text-xl text-charcoal-900 mb-2">What can I help with?</p>
                <p className="text-sm text-charcoal-500 mb-4">Ask about the plan, tell it what's changed, or attach a quote or invoice to file. Pick a chat or start a new one.</p>
                <Button onClick={newChat}>New chat</Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
