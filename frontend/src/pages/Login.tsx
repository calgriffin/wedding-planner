/**
 * Login / first-run password setup screen.
 */
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, Input, Field, Spinner } from '../components/ui';
import { siteHost } from '../utils/site';
import { brand } from '../utils/brand';

export default function LoginPage() {
  const { initialized, temporary, temporaryPassword, login, initSystem, checking, authError, authProvider } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      if (initialized) {
        await login(password);
      } else {
        if (password !== confirm) {
          setError('Passwords do not match.');
          return;
        }
        await initSystem(password);
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    }
  };

  const handleTempSignIn = async () => {
    if (!temporaryPassword) return;
    setError(null);
    try {
      await initSystem(temporaryPassword, true);
    } catch (err: any) {
      setError(err.message || 'Could not use the temporary access code.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ivory-100 via-ivory-50 to-sage-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg border border-charcoal-100 overflow-hidden">
          <div className="bg-sage-500 px-8 py-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-ivory-50/20 border-2 border-ivory-50/50 flex items-center justify-center font-serif font-bold text-3xl text-ivory-50">
              {brand.initial}
            </div>
            <h1 className="mt-4 text-2xl font-serif text-ivory-50">{brand.name}</h1>
            <p className="text-ivory-100/90 text-sm mt-1">Private planning system</p>
          </div>
          <div className="px-8 py-8">
            {authProvider === 'cloudflare-access' ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-charcoal-600">
                  Sign-in is handled by Cloudflare Access. Your session has ended — continue to sign in again.
                </p>
                {authError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{authError}</p>
                )}
                {/* A full page load lets Access redirect to its sign-in page. */}
                <Button onClick={() => window.location.assign('/')} className="w-full py-2.5">
                  Continue to sign in
                </Button>
              </div>
            ) : (
            <>
            {!initialized && (
              <div className="mb-5 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 space-y-2 text-amber-800">
                <p><strong>Welcome — set up your planner.</strong> Choose a strong password for you and your partner. Keep it somewhere safe; you can change it later on the Setup tab.</p>
                {temporaryPassword && (
                  <p className="bg-white/60 border border-amber-200 rounded-md px-2.5 py-2">
                    Your temporary access code is{' '}
                    <code className="font-mono font-semibold text-amber-900">{temporaryPassword}</code>
                  </p>
                )}
              </div>
            )}
            {initialized && temporary && (
              <div className="mb-5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                A <strong>temporary password</strong> is currently in use. Sign in and you'll be invited to set your own on
                the Setup tab.
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label={initialized ? 'Password' : 'Set a password (min 8 characters)'}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  placeholder="••••••••"
                />
              </Field>
              {!initialized && (
                <Field label="Confirm password">
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
              )}
              {(error || authError) && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error || authError}
                </p>
              )}
              <Button type="submit" loading={checking} className="w-full py-2.5">
                {checking ? 'Please wait…' : initialized ? 'Sign in' : 'Create password & continue'}
              </Button>
            </form>
            {!initialized && temporaryPassword && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleTempSignIn}
                  className="text-xs text-sage-700 underline hover:text-sage-800"
                  disabled={checking}
                >
                  Use the temporary access code instead (sign in with it now)
                </button>
              </div>
            )}
            </>
            )}
            <p className="mt-6 text-center text-xs text-charcoal-400">
              Hosted on Cloudflare · Data stored securely in Cloudflare D1<br />
              <span className="text-charcoal-300">{siteHost('plan')}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}