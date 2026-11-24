/**
 * Error boundaries: a render error in one page shows a "something went wrong"
 * panel instead of blanking the whole app.
 *
 * - The route boundary sits INSIDE the portal Layout, so the nav stays usable;
 *   it resets when the path changes (resetKey), so clicking another page
 *   recovers without a reload.
 * - The top-level boundary (main.tsx) is the last resort for anything outside
 *   the routes (layout, providers).
 *
 * Pages are lazy-loaded chunks. After a deploy an open tab can ask for a chunk
 * name that no longer exists; that load error gets a "new version" message
 * and one automatic reload per tab session.
 */
import React from 'react';

const CHUNK_RELOAD_KEY = 'wp_chunk_reload_at';

export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message || error || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module|ChunkLoadError/i.test(msg);
}

// One automatic reload per tab session; a second chunk error shows the panel.
function reloadOnceForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

type Props = {
  children: React.ReactNode;
  /** When this changes, a caught error is cleared (e.g. the route path). */
  resetKey?: string;
  /** "page": panel inside the layout; "app": full-screen panel. */
  variant?: 'page' | 'app';
};

type State = { error: unknown | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Page error', error, info.componentStack);
    if (isChunkLoadError(error)) reloadOnceForNewVersion();
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkLoadError(this.state.error);
    return (
      <ErrorPanel
        variant={this.props.variant || 'page'}
        title={chunk ? 'A new version is available' : 'Something went wrong'}
        message={chunk
          ? 'The planner was updated while this page was open. Reload to get the latest version.'
          : 'This page hit an unexpected error. Your data is safe — reload to try again, or pick another page.'}
      />
    );
  }
}

function ErrorPanel({ variant, title, message }: { variant: 'page' | 'app'; title: string; message: string }) {
  const panel = (
    <div role="alert" className="max-w-md w-full mx-auto rounded-2xl border border-charcoal-200 bg-white p-6 text-center shadow-sm">
      <h2 className="font-serif text-2xl text-charcoal-900">{title}</h2>
      <p className="mt-2 text-sm text-charcoal-500">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-5 inline-flex items-center justify-center rounded-xl bg-sage-600 px-4 py-2 text-sm font-medium text-white hover:bg-sage-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-400"
      >
        Reload
      </button>
    </div>
  );
  if (variant === 'app') {
    return <div className="min-h-screen flex items-center justify-center bg-ivory-50 p-6">{panel}</div>;
  }
  return <div className="py-16 px-4">{panel}</div>;
}
