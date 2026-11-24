import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { Toasts, Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';

// Every page is its own chunk, so guests on the public site never download
// the planner, and the planner loads one page at a time.
const Layout = lazy(() => import('./components/Layout').then((m) => ({ default: m.Layout })));
const LoginPage = lazy(() => import('./pages/Login'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const SetupPage = lazy(() => import('./pages/Setup'));
const TimelinePage = lazy(() => import('./pages/Timeline'));
const TasksPage = lazy(() => import('./pages/Tasks'));
const BudgetPage = lazy(() => import('./pages/Budget'));
const PaymentsPage = lazy(() => import('./pages/Payments'));
const GuestsPage = lazy(() => import('./pages/Guests'));
const SuppliersPage = lazy(() => import('./pages/Suppliers'));
const DecisionsPage = lazy(() => import('./pages/Decisions'));
const SeatingPage = lazy(() => import('./pages/Seating'));
const WeddingDayPage = lazy(() => import('./pages/WeddingDay'));
const EventsPage = lazy(() => import('./pages/Events'));
const RsvpPage = lazy(() => import('./pages/Rsvp'));
const CatererMatrixPage = lazy(() => import('./pages/CatererMatrix'));
const GuestToolsPage = lazy(() => import('./pages/GuestTools'));
const EmailPage = lazy(() => import('./pages/Email'));
const GuestWebsitePage = lazy(() => import('./pages/GuestWebsite'));
const AssistantPage = lazy(() => import('./pages/Assistant'));

const GuestHome = lazy(() => import('./pages/guest/GuestHome'));
const GuestAccess = lazy(() => import('./pages/guest/GuestAccess'));
const GuestRsvp = lazy(() => import('./pages/guest/GuestRsvp'));
const GuestDetails = lazy(() => import('./pages/guest/GuestDetails'));

function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ivory-50">
      <div className="text-center">
        <Spinner size="lg" />
        {label && <p className="mt-3 text-sm text-charcoal-500">{label}</p>}
      </div>
    </div>
  );
}

function PageSpinner() {
  return (
    <div className="py-24 flex justify-center" role="status" aria-label="Loading page">
      <Spinner size="lg" />
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated } = useApp();
  if (authenticated === null) return <FullScreenSpinner label="Checking session…" />;
  return <>{children}</>;
}

/** One error boundary per route: cleared when the path changes. */
function RouteBoundary({ children, variant = 'page' }: { children: React.ReactNode; variant?: 'page' | 'app' }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} variant={variant}>
      {children}
    </ErrorBoundary>
  );
}

function GuestRoutes() {
  return (
    <RouteBoundary variant="app">
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/" element={<GuestHome />} />
          <Route path="/guest/access" element={<GuestAccess />} />
          <Route path="/guest/rsvp" element={<GuestRsvp />} />
          <Route path="/guest/details" element={<GuestDetails />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteBoundary>
  );
}

function PortalPages() {
  // The Layout (nav) sits OUTSIDE the boundary and the Suspense, so a broken
  // or loading page never takes the navigation with it.
  return (
    <Layout>
      <RouteBoundary>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/guests" element={<GuestsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/decisions" element={<DecisionsPage />} />
            <Route path="/seating" element={<SeatingPage />} />
            <Route path="/wedding-day" element={<WeddingDayPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/rsvp" element={<RsvpPage />} />
            <Route path="/caterer-matrix" element={<CatererMatrixPage />} />
            <Route path="/guest-tools" element={<GuestToolsPage />} />
            <Route path="/guest-website" element={<GuestWebsitePage />} />
            <Route path="/email" element={<EmailPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </Layout>
  );
}

function PortalRoutes() {
  const { authenticated } = useApp();
  return (
    <RouteBoundary variant="app">
      {/* Loading the Layout chunk itself: full-screen spinner. */}
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/login" element={authenticated ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/*" element={authenticated ? <PortalPages /> : <Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </RouteBoundary>
  );
}

export default function App() {
  const { toasts, dismissToast } = useApp();
  const isGuestSite = typeof window !== 'undefined' && !window.location.hostname.startsWith('plan.');

  return (
    <AuthGate>
      {isGuestSite ? <GuestRoutes /> : <PortalRoutes />}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </AuthGate>
  );
}
