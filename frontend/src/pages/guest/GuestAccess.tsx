import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { GUEST_SITE_UNLOCK_KEY, GuestShell, recallCode, rememberCode } from './GuestChrome';

export default function GuestAccess() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [code, setCode] = useState(() => search.get('c') || search.get('code') || recallCode());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const autoTried = useRef(false);

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) { setErr('Please enter your access code.'); return; }
    setLoading(true); setErr('');
    try {
      const r = await api.guest.access({ code });
      rememberCode(code.trim());
      // The same code opens the site details, so "Back to the site" from the
      // RSVP form doesn't ask for it again.
      try {
        const u = await api.guest.unlock({ code: code.trim() });
        if (u && u.unlocked && u.site) sessionStorage.setItem(GUEST_SITE_UNLOCK_KEY, JSON.stringify(u.site));
      } catch { /* the RSVP form still works without it */ }
      navigate('/guest/rsvp', { state: { access: r && r.data ? r.data : r, code } });
    } catch (e: any) {
      setErr(e.message || 'That code wasn’t found. Please double-check it.');
    } finally {
      setLoading(false);
    }
  };

  // A guest arriving with their code (invitation link, or already entered on
  // the site) goes straight to the form; a rejected code falls back to this page.
  useEffect(() => {
    if (code.trim() && !autoTried.current) {
      autoTried.current = true;
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GuestShell width="max-w-md">
      <div className="gs-rise text-center">
        <p className="gs-eyebrow">RSVP</p>
        <h1 className="mt-4 text-5xl font-light text-charcoal-900 md:text-6xl">You’re invited</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-charcoal-600">Enter the access code from your invitation or QR code.</p>
        <form onSubmit={submit} className="gs-card mt-8 px-6 py-8 text-left sm:px-8">
          <label htmlFor="rsvp-access-code" className="gs-label">Access code</label>
          <input
            id="rsvp-access-code"
            className="gs-input text-center tracking-[0.15em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. 7K2-QM4"
          />
          <p className="gs-hint">Codes ignore dashes and spaces.</p>
          {err && <p className="mt-3 text-sm text-red-700" role="alert">{err}</p>}
          <button type="submit" disabled={loading} className="gs-btn-primary mt-6 w-full">
            {loading ? 'Finding your party…' : 'Continue'}
          </button>
        </form>
      </div>
    </GuestShell>
  );
}
