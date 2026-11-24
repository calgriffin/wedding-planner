/**
 * App layout: sidebar navigation + top bar.
 */
import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { cn, formatDate } from '../utils/helpers';
import { brand } from '../utils/brand';
import { ChatBubble, useChatBadge } from './chat/ChatBubble';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h5v8H3v-8zm10 0h8v8h-8v-8z' },
  { to: '/assistant', label: 'Assistant', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12zM8.5 11h.01M12 11h.01M15.5 11h.01' },
  { to: '/timeline', label: 'Timeline', icon: 'M8 2v4M16 2v4M3 4h18v17H3V4zm0 7h18M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01M17 17h.01' },
  { to: '/setup', label: 'Setup', icon: 'M10.3 4.9 9.8 3.9l1.8-.9.4 1 4 1.8.4 1 3 5 1.1 5.7 1-1 .6 1.6L20.5 13l1.6.6-2.3 4.7-1.7.7M3 5h2v2H3V5zm4-2h2v4H7V3z' },
  { to: '/tasks', label: 'Tasks & Playbook', icon: 'M9 11H7V9h2v2zm0 4H7v-2h2v2zm0-8H7V5h2v2zm4 4h-2V9h2v2zm0 4h-2v-2h2v2zm0-8h-2V5h2v2zm4 4h-2V9h2v2zm0 4h-2v-2h2v2zm0-8h-2V5h2v2z' },
  { to: '/budget', label: 'Budget', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { to: '/payments', label: 'Payments', icon: 'M2 7h20v12H2V7zm2 4h16M2 15h20M10 7v12' },
  { to: '/guests', label: 'Guests', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87' },
  { to: '/suppliers', label: 'Suppliers & Venues', icon: 'M3 21V8l9-5 9 5v13M3 21h18M9 21v-6h6v6' },
  { to: '/decisions', label: 'Decisions & Ideas', icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-6 6c0 2.2 1.2 3.6 2.2 4.6.6.6 1 1.2 1.2 1.9h5c.3-.7.6-1.3 1.2-1.9 1-1 2.4-2.4 2.4-4.6a6 6 0 0 0-6-6z' },
  { to: '/seating', label: 'Seating & Logistics', icon: 'M3 3h18v18H3V3zm2 2v4h4V5H5zm6 0v4h4V5h-4zm6 0v4h4V5h-4zM5 11v4h4v-4H5zm6 0v4h4v-4h-4zm6 0v4h4v-4h-4zM5 17v2h4v-2H5zm6 0v2h4v-2h-4zm6 0v2h4v-2h-4z' },
  { to: '/wedding-day', label: 'Wedding Day', icon: 'M12 2a5 5 0 0 1 5 5c0 2-1 2.5-1 5h-8c0-2.5-1-3-1-5a5 5 0 0 1 5-5zM9 14h6a6 4 0 0 1 6 4v4H3v-4a6 4 0 0 1 6-4z' },
  { to: '/events', label: 'Other Events & Honeymoon', icon: 'M8 2v4M16 2v4M3 5h18v17H3V5zm0 9h18M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01M17 17h.01' },
  { to: '/rsvp', label: 'RSVP Inbox', icon: 'M22 6l-10 7L2 6v13h20V6zM2 4h20v2L12 13 2 6V4z' },
  { to: '/caterer-matrix', label: 'Caterer Matrix', icon: 'M4 4h16v4H4V4zm0 6h16v10H4V10zm4 3h8M8 16h5' },
  { to: '/guest-tools', label: 'Guest Tools', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
  { to: '/guest-website', label: 'Guest Website', icon: 'M8 2v4M16 2v4M3 5h18v17H3V5zm2 3v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8H5zm6 3h6v4h-6v-4z' },
  { to: '/email', label: 'Email & Reminders', icon: 'M22 6l-10 7L2 6v13h20V6zM2 4h20v2L12 13 2 6V4zM4 10v4M8 12v4' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout, setup, refreshAll } = useAppState();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-charcoal-200 bg-white sticky top-0 h-screen print:hidden">
        <SidebarContent onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-charcoal-200 px-4 py-3 flex items-center justify-between print:hidden">
        <button onClick={() => setMobileOpen(true)} className="text-charcoal-500 hover:text-charcoal-800" aria-label="Open menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <span className="font-serif font-semibold text-charcoal-900">{brand.nav}</span>
        <button onClick={() => navigate('/')} className="text-sage-500" aria-label="Home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-charcoal-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-charcoal-200">
              <span className="font-serif font-semibold text-charcoal-900">Menu</span>
              <button onClick={() => setMobileOpen(false)} className="text-charcoal-500">✕</button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 bg-ivory-50 min-w-0 print:bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 print:max-w-none print:px-0 print:py-0">{children}</div>
      </main>
      <ChatBubble />
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const { logout, setup, refreshAll } = useAppState();
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const chat = useChatBadge();
  const chatBadge = chat.unread + chat.open_questions;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <>
      <div className="px-5 py-6 border-b border-charcoal-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-sage-500 flex items-center justify-center text-ivory-50 font-serif font-bold text-lg">{brand.initial}</div>
          <div>
            <p className="font-serif font-semibold text-charcoal-900 leading-tight">{brand.nav}</p>
            <p className="text-xs text-charcoal-400">Planning HQ</p>
          </div>
        </div>
        {setup?.wedding_date && (
          <p className="mt-3 text-xs text-sage-600 bg-sage-50 rounded-md px-2.5 py-1.5 inline-block">
            {formatDate(setup.wedding_date)}
          </p>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-charcoal-600 hover:bg-sage-50 hover:text-sage-700 transition-colors mb-0.5',
                isActive && 'bg-sage-100 text-sage-700 font-medium'
              )
            }
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            <span className="truncate flex-1">{item.label}</span>
            {item.to === '/assistant' && chatBadge > 0 && (
              <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center" aria-label={`${chatBadge} new`}>
                {chatBadge > 9 ? '9+' : chatBadge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-charcoal-200 p-3 space-y-1">
        <button
          onClick={() => { setRefreshing(true); refreshAll().finally(() => setRefreshing(false)); }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-charcoal-600 hover:bg-charcoal-100 transition-colors"
          disabled={refreshing}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-charcoal-600 hover:bg-charcoal-100 transition-colors">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          Sign out
        </button>
      </div>
    </>
  );
}

// Pull shared app state used by Layout (kept local to avoid circular imports)
function useAppState() {
  const app = useApp();
  return {
    logout: app.logout,
    setup: app.setup,
    refreshAll: app.refreshAll,
  };
}