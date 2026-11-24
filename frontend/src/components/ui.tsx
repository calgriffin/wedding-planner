/**
 * Shared UI primitives (ivory / sage / charcoal theme).
 */
import React, { useEffect, useState } from 'react';
import { cn } from '../utils/helpers';

// ------------------------------------------------ Button
type BtnVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const sizeCls = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm';
  const variantCls: Record<BtnVariant, string> = {
    primary: 'bg-sage-500 text-ivory-50 hover:bg-sage-600 focus:ring-sage-500',
    secondary: 'bg-charcoal-100 text-charcoal-900 hover:bg-charcoal-200 focus:ring-charcoal-400',
    outline: 'border-2 border-sage-500 text-sage-600 hover:bg-sage-50 focus:ring-sage-400',
    ghost: 'text-charcoal-600 hover:bg-charcoal-100 focus:ring-charcoal-300',
    danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
        sizeCls,
        variantCls[variant],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

// ------------------------------------------------ Spinner
export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeCls = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-charcoal-300 border-t-sage-500',
        sizeCls,
        className
      )}
      aria-label="Loading"
    />
  );
}

// ------------------------------------------------ Input / Select / Textarea
interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}
export function Field({ label, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn('mb-4', className)}>
      {label && <label className="block text-sm font-medium text-charcoal-700 mb-1">{label}</label>}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-charcoal-400">{hint}</p> : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-2 border border-charcoal-300 rounded-lg bg-white text-charcoal-900 placeholder-charcoal-400 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent transition-all',
        className
      )}
      {...rest}
    />
  )
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full px-3 py-2 border border-charcoal-300 rounded-lg bg-white text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent transition-all',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-3 py-2 border border-charcoal-300 rounded-lg bg-white text-charcoal-900 placeholder-charcoal-400 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-transparent transition-all resize-y',
        className
      )}
      {...rest}
    />
  )
);
Textarea.displayName = 'Textarea';

// ------------------------------------------------ Badge
export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: string; className?: string }) {
  const tones: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    neutral: 'bg-charcoal-100 text-charcoal-800',
    sage: 'bg-sage-100 text-sage-800',
  };
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', tones[tone] || tones.neutral, className)}>
      {children}
    </span>
  );
}

export function statusTone(status: string): string {
  const map: Record<string, string> = {
    done: 'success', paid: 'success', confirmed: 'success', decided: 'success', matched: 'success', accepted: 'success', booked: 'success',
    underway: 'info', in_progress: 'info', invited: 'info', quoted: 'info', contacted: 'info', shortlisted: 'info',
    waiting: 'warning', pending: 'warning', potential: 'warning', open: 'warning', flagged: 'warning', duplicate: 'warning',
    declined: 'danger', overdue: 'danger', not_started: 'neutral', not_applicable: 'neutral', cancelled: 'danger', unmatched: 'danger', conflict: 'danger', rejected: 'danger',
  };
  return map[status] || 'neutral';
}

export function formatLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Owner/responsible-person label: partner1/partner2 → the names from Setup. */
export function partnerLabel(
  value: string,
  setup?: { partner1_name?: string | null; partner2_name?: string | null } | null,
): string {
  if (value === 'partner1') return setup?.partner1_name || 'Partner 1';
  if (value === 'partner2') return setup?.partner2_name || 'Partner 2';
  return formatLabel(value || '');
}

// ------------------------------------------------ Card
export function Card({ children, className, title, subtitle, actions }: { children?: React.ReactNode; className?: string; title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn('bg-white rounded-xl shadow-sm border border-charcoal-100 overflow-hidden', className)}>
      {(title || actions) && (
        <div className="px-5 py-4 border-b border-charcoal-100 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {title && <h3 className="text-lg font-medium text-charcoal-900">{title}</h3>}
            {subtitle && <p className="text-sm text-charcoal-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ------------------------------------------------ StatCard
export function StatCard({ label, value, hint, tone = 'default', icon }: { label: string; value: React.ReactNode; hint?: string; tone?: 'default' | 'success' | 'danger' | 'warning'; icon?: React.ReactNode }) {
  const toneCls = tone === 'success' ? 'text-sage-600' : tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-charcoal-900';
  return (
    <div className="bg-white rounded-xl shadow-sm border border-charcoal-100 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
        {icon}
      </div>
      <p className={cn('mt-1 text-2xl font-semibold font-serif', toneCls)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-charcoal-400">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------ Modal
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  const sizeCls = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : size === 'xl' ? 'max-w-5xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-charcoal-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative bg-white rounded-xl shadow-2xl w-full', sizeCls)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-charcoal-100">
          <h3 className="text-lg font-medium">{title}</h3>
          <button onClick={onClose} className="text-charcoal-400 hover:text-charcoal-700 transition-colors" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-charcoal-100 bg-ivory-50 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Delete', danger = true }: { open: boolean; onClose: () => void; onConfirm: () => void; title?: string; message?: string; confirmLabel?: string; danger?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-charcoal-600">{message || 'This action cannot be undone.'}</p>
    </Modal>
  );
}

// ------------------------------------------------ EmptyState
export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto w-14 h-14 rounded-full bg-sage-100 flex items-center justify-center text-sage-500 mb-4">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
      </div>
      <h3 className="text-base font-medium text-charcoal-800">{title}</h3>
      {message && <p className="text-sm text-charcoal-500 mt-1 max-w-md mx-auto">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ------------------------------------------------ PageHeader
export function PageHeader({ title, subtitle, actions, badge }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-serif text-charcoal-900">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-charcoal-500 text-sm max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------ SearchInput
export function SearchInput({ value, onChange, placeholder = 'Search...', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}

// ------------------------------------------------ ProgressBar
export function ProgressBar({ value, max, tone, className }: { value: number; max: number; tone?: 'default' | 'danger' | 'warning'; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : pct > 85 ? 'bg-amber-500' : 'bg-sage-500';
  return (
    <div className={cn('w-full h-2 bg-charcoal-100 rounded-full overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ------------------------------------------------ Tabs
export function Tabs({ tabs, active, onChange, className }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 border-b border-charcoal-200 overflow-x-auto scrollbar-thin', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
            active === t.id ? 'text-sage-600 border-sage-500' : 'text-charcoal-500 border-transparent hover:text-charcoal-700 hover:border-charcoal-300'
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn('ml-1.5 px-1.5 py-0.5 rounded-full text-xs', active === t.id ? 'bg-sage-100 text-sage-700' : 'bg-charcoal-100 text-charcoal-600')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------ DataTable (simple)
export function DataTable<T extends Record<string, any>>({ columns, rows, rowKey, onRowClick }: { columns: { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string }[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-3 text-xs font-semibold text-charcoal-500 uppercase tracking-wider bg-ivory-100 border-b border-charcoal-200 whitespace-nowrap', c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-charcoal-400">No records yet.</td></tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={cn('border-b border-charcoal-100 hover:bg-ivory-50 transition-colors', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-top', c.className)}>
                    {c.render ? c.render(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------ Toasts
export function Toasts({ toasts, onDismiss }: { toasts: { id: number; message: string; type: string }[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm',
            t.type === 'success' && 'bg-green-50 border-green-200 text-green-800',
            t.type === 'error' && 'bg-red-50 border-red-200 text-red-800',
            t.type === 'info' && 'bg-ivory-50 border-charcoal-200 text-charcoal-800'
          )}
        >
          <p className="flex-1">{t.message}</p>
          <button onClick={() => onDismiss(t.id)} className="text-current opacity-60 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------ useFormState helper
export function useForm<T extends Record<string, any>>(initial: T) {
  const [form, setForm] = useState<T>(initial);
  const set = (key: keyof T, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const setMany = (partial: Partial<T>) => setForm((f) => ({ ...f, ...partial }));
  const reset = () => setForm(initial);
  return { form, set, setMany, reset, setForm };
}