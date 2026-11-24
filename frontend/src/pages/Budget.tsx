/**
 * Budget: category allowances, items (estimate/agreed), forecasts, actuals.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, ProgressBar, ConfirmDialog,
} from '../components/ui';
import { formatCurrency, formatCurrencyWithPence, parseCurrency, cn } from '../utils/helpers';

const CAT_COLORS = ['#527352', '#8B5E3C', '#B08968', '#7C9885', '#C9ADA7', '#A3B18A', '#D08C60', '#6B6B83', '#9C6644', '#83A598', '#8FBC8F', '#B5838D'];

export default function BudgetPage() {
  const { setup, showToast } = useApp();
  const [categories, setCategories] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [isNewCat, setIsNewCat] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deletingKind, setDeletingKind] = useState<'cat' | 'item'>('item');
  const [itemForm, setItemForm] = useState<Record<string, any>>({});
  const [catForm, setCatForm] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [cats, its] = await Promise.all([api.budget.categories(), api.budget.items()]);
      setCategories(cats);
      setItems(its);
    } catch (e: any) {
      showToast(e.message || 'Failed to load budget', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const ceiling = setup?.budget_ceiling || 0;
  const contingencyPct = setup?.contingency_percent ?? 10;
  const contingency = Math.round((ceiling * contingencyPct) / 100);
  const itemsForecast = items.reduce((s, i) => s + (i.forecast_pence || 0), 0);
  const itemsActual = items.reduce((s, i) => s + (i.actual_pence || 0), 0);
  const allowTotal = categories?.reduce((s, c) => s + (c.allowance_pence || 0), 0) || 0;
  const unpriced = items.filter((i) => !i.is_priced);
  const availableForCosts = Math.max(0, ceiling - contingency);
  const remainingAfterCosts = availableForCosts - itemsForecast;
  const remainingTotal = ceiling - contingency - itemsForecast;

  const byCategory = useMemo(() => {
    const map: Record<string, any[]> = {};
    items.forEach((i) => {
      (map[i.category_id] = map[i.category_id] || []).push(i);
    });
    return map;
  }, [items]);

  const catRows = useMemo(() => {
    if (!categories) return [] as { cat: any; forecast: number; actual: number }[];
    return categories
      .map((cat) => {
        const catItems = byCategory[cat.id] || [];
        return {
          cat,
          forecast: catItems.reduce((s, i) => s + (i.forecast_pence || 0), 0),
          actual: catItems.reduce((s, i) => s + (i.actual_pence || 0), 0),
        };
      })
      .sort((a, b) => b.forecast - a.forecast);
  }, [categories, byCategory]);

  const openNewCat = () => { setIsNewCat(true); setCatForm({ name: '', allowance_pence_input: '', notes: '' }); setEditingCat({ _new: true }); };
  const openEditCat = (c: any) => { setIsNewCat(false); setCatForm({ name: c.name, allowance_pence_input: c.allowance_pence ? formatCurrency(c.allowance_pence) : '', notes: c.notes || '' }); setEditingCat(c); };

  const openNewItem = (categoryId: string) => {
    setIsNewItem(true);
    setItemForm({
      category_id: categoryId, name: '', estimate_input: '', agreed_input: '', notes: '', supplier_id: null,
    });
    setEditingItem({ _new: true, category_id: categoryId });
  };
  const openEditItem = (item: any) => {
    setIsNewItem(false);
    setItemForm({
      category_id: item.category_id, name: item.name,
      estimate_input: item.estimate_pence != null ? formatCurrency(item.estimate_pence) : '',
      agreed_input: item.agreed_price_pence != null ? formatCurrency(item.agreed_price_pence) : '',
      notes: item.notes || '',
    });
    setEditingItem(item);
  };

  const saveCat = async () => {
    if (!catForm.name?.trim()) { showToast('Category name required', 'error'); return; }
    try {
      const payload = { name: catForm.name, allowance_pence: catForm.allowance_pence_input ? parseCurrency(String(catForm.allowance_pence_input)) : 0, notes: catForm.notes || '' };
      if (isNewCat) await api.budget.createCategory(payload);
      else await api.budget.updateCategory(editingCat.id, payload);
      showToast('Category saved', 'success');
      setEditingCat(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const saveItem = async () => {
    if (!itemForm.name?.trim()) { showToast('Item name required', 'error'); return; }
    try {
      const payload = {
        category_id: itemForm.category_id,
        name: itemForm.name,
        estimate_pence: itemForm.estimate_input ? parseCurrency(String(itemForm.estimate_input)) : null,
        agreed_price_pence: itemForm.agreed_input ? parseCurrency(String(itemForm.agreed_input)) : null,
        notes: itemForm.notes || '',
      };
      if (isNewItem) await api.budget.createItem(payload);
      else await api.budget.updateItem(editingItem.id, payload);
      showToast('Item saved — forecast recalculated from agreed price (or estimate)', 'success');
      setEditingItem(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => {
    try {
      if (deletingKind === 'cat') await api.budget.deleteCategory(deleting.id);
      else await api.budget.deleteItem(deleting.id);
      showToast('Deleted', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && !categories) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  const pctOfCeiling = ceiling ? Math.round(((itemsForecast + contingency) / ceiling) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Budget"
        subtitle="Forecast uses the agreed price when available, otherwise the estimate. Payments never double-count."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.open('/api/export/budget', '_blank')}>Export CSV</Button>
            <Button variant="outline" size="sm" onClick={() => window.open('/api/export/all', '_blank')}>Full backup</Button>
            <Button variant="outline" size="sm" onClick={openNewCat}>+ Category</Button>
          </>
        }
      />

      {/* Summary */}
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Ceiling</p>
          <p className="mt-1 text-2xl font-semibold font-serif">{formatCurrency(ceiling)}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Forecast costs</p>
          <p className="mt-1 text-2xl font-semibold font-serif text-charcoal-900">{formatCurrency(itemsForecast)}</p>
          <p className="text-xs text-charcoal-400">{unpriced.length} unpriced item{unpriced.length === 1 ? '' : 's'}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Contingency ({contingencyPct}%)</p>
          <p className="mt-1 text-2xl font-semibold font-serif text-sage-600">{formatCurrency(contingency)}</p>
        </Card>
        <Card className={cn('px-5 py-4', remainingTotal < 0 && 'bg-red-50 border-red-200')}>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Remaining after all</p>
          <p className={cn('mt-1 text-2xl font-semibold font-serif', remainingTotal < 0 ? 'text-red-600' : 'text-charcoal-900')}>{formatCurrency(remainingTotal)}</p>
          <div className="mt-2"><ProgressBar value={itemsForecast + contingency} max={ceiling || 1} tone={remainingTotal < 0 ? 'danger' : 'default'} /></div>
        </Card>
      </div>

      {/* Spend allocation + headline */}
      {categories && itemsForecast > 0 && (
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <Card className="p-5 md:col-span-2">
            <h3 className="font-medium text-charcoal-900">Spend by category</h3>
            <p className="text-xs text-charcoal-500 mb-3">Share of the total forecast (agreed price where set, otherwise estimate).</p>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-charcoal-100">
              {catRows.map(({ cat, forecast }, i) => {
                const w = Math.round((forecast / itemsForecast) * 100);
                return w > 0 ? (
                  <div key={cat.id} style={{ width: `${w}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} title={`${cat.name}: ${w}%`} />
                ) : null;
              })}
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {catRows.filter((r) => r.forecast > 0).map(({ cat, forecast }, i) => (
                <div key={cat.id} className="flex items-center gap-2 text-xs min-w-0">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} aria-hidden="true" />
                  <span className="truncate text-charcoal-700">{cat.name}</span>
                  <span className="ml-auto font-medium text-charcoal-900">{Math.round((forecast / itemsForecast) * 100)}%</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-medium text-charcoal-900">Headline</h3>
            <dl className="mt-3 space-y-2 text-sm">
              {(() => {
                const top = catRows.find((r) => r.forecast > 0);
                return top ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-charcoal-500">Largest category</dt>
                    <dd className="font-medium text-charcoal-900 truncate">{top.cat.name} · {Math.round((top.forecast / itemsForecast) * 100)}%</dd>
                  </div>
                ) : null;
              })()}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-charcoal-500">Allowances used</dt>
                <dd className="font-medium text-charcoal-900">{allowTotal > 0 ? `${Math.round((itemsForecast / allowTotal) * 100)}%` : 'n/a'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-charcoal-500">Forecast of ceiling</dt>
                <dd className="font-medium text-charcoal-900">{pctOfCeiling}%</dd>
              </div>
            </dl>
            <div className="mt-3">
              <ProgressBar value={itemsForecast} max={Math.max(ceiling || 0, 1)} />
            </div>
            <p className="mt-2 text-xs text-charcoal-400">Forecast costs against the {formatCurrency(ceiling)} ceiling, excluding contingency.</p>
          </Card>
        </div>
      )}

      {!loading && categories?.length === 0 && (
        <Card><EmptyState title="No budget categories yet" message="Add categories to start tracking. The playbook's starter categories are created automatically on first load." action={<Button size="sm" onClick={openNewCat}>+ Add category</Button>} /></Card>
      )}

      {catRows.map(({ cat, forecast: catForecast, actual: catActual }) => {
          const catItems = byCategory[cat.id] || [];
          const isOpen = expanded[cat.id] ?? (catForecast > 0 || catItems.length > 0);
          const pctOfTotal = itemsForecast ? Math.round((catForecast / itemsForecast) * 100) : 0;
          const pctOfAllowance = cat.allowance_pence > 0 ? Math.round((catForecast / cat.allowance_pence) * 100) : null;
          const delta = catForecast - (cat.allowance_pence || 0);
          const overUnderBadge = cat.allowance_pence > 0 && catForecast > 0 && delta !== 0 ? (
            <Badge tone={delta > 0 ? 'danger' : 'success'}>
              {delta > 0 ? `${formatCurrency(delta)} over` : `${formatCurrency(-delta)} under`}
            </Badge>
          ) : null;
          return (
            <Card key={cat.id} className="mb-4">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setExpanded({ ...expanded, [cat.id]: !isOpen })} className="flex items-center gap-2 text-left group">
                      <svg className={cn('w-4 h-4 text-charcoal-400 transition-transform', isOpen && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                      <h3 className="text-base font-medium text-charcoal-900 group-hover:text-sage-700">{cat.name}</h3>
                    </button>
                    {overUnderBadge}
                  </div>
                  <p className="text-xs text-charcoal-400 mt-0.5 ml-6">
                    {catItems.length} item{catItems.length === 1 ? '' : 's'} · allowance {formatCurrency(cat.allowance_pence)} · paid {formatCurrency(catActual)}
                    {pctOfTotal > 0 && <span className="ml-1">· {pctOfTotal}% of total spend</span>}
                  </p>
                  {pctOfAllowance != null && (
                    <div className="mt-2 ml-6 max-w-sm">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-charcoal-100">
                        <div
                          className={cn('h-full rounded-full', catForecast > cat.allowance_pence ? 'bg-red-400' : 'bg-sage-500')}
                          style={{ width: `${Math.min(100, pctOfAllowance)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-charcoal-400">{pctOfAllowance}% of allowance used</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <span className="text-sm font-medium">{formatCurrency(catForecast)}</span>
                  <Button variant="ghost" size="sm" onClick={() => openEditCat(cat)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setDeleting(cat); setDeletingKind('cat'); }} className="text-red-600 hover:bg-red-50">Del</Button>
                  <Button variant="outline" size="sm" onClick={() => openNewItem(cat.id)}>+ Item</Button>
                </div>
              </div>
            {isOpen && (
              <div className="border-t border-charcoal-100 px-5 py-3">
                {catItems.length === 0 ? (
                  <p className="text-sm text-charcoal-400 py-2">No items yet in this category.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left py-2 pr-4 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Item</th>
                        <th className="text-left py-2 pr-4 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Pricing</th>
                        <th className="text-right py-2 pr-4 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Forecast</th>
                        <th className="text-right py-2 pr-4 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Paid</th>
                        <th className="text-right py-2 pr-4 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Remaining</th>
                        <th className="text-right py-2 text-xs uppercase tracking-wide text-charcoal-400 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {catItems.map((item: any) => (
                        <tr key={item.id} className="border-t border-charcoal-100 hover:bg-ivory-50">
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-charcoal-800">{item.name}</span>
                            {!item.is_priced && <Badge tone="warning" className="ml-2">unpriced</Badge>}
                            {item.agreed_price_pence != null && item.agreed_price_pence > 0 && <Badge tone="success" className="ml-1">agreed</Badge>}
                            {item.notes && <p className="text-xs text-charcoal-400 mt-0.5">{item.notes}</p>}
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-charcoal-500">
                            {item.estimate_pence != null ? <>est {formatCurrencyWithPence(item.estimate_pence)}</> : 'no estimate'}
                            {item.agreed_price_pence != null && <><br />agreed {formatCurrencyWithPence(item.agreed_price_pence)}</>}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-medium">{formatCurrency(item.forecast_pence)}</td>
                          <td className="py-2.5 pr-4 text-right text-sage-600">{formatCurrency(item.actual_pence)}</td>
                          <td className={cn('py-2.5 pr-4 text-right', (item.forecast_pence - item.actual_pence) > 0 ? 'text-charcoal-700' : 'text-charcoal-300')}>{formatCurrency(item.forecast_pence - item.actual_pence)}</td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <Button variant="ghost" size="sm" onClick={() => openEditItem(item)}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => { setDeleting(item); setDeletingKind('item'); }} className="text-red-600 hover:bg-red-50">Del</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {/* Category modal */}
      <Modal
        open={!!editingCat}
        onClose={() => setEditingCat(null)}
        title={isNewCat ? 'Add category' : 'Edit category'}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setEditingCat(null)}>Cancel</Button><Button onClick={saveCat}>Save</Button></>}
      >
        <Field label="Category name *"><Input value={catForm.name || ''} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Photography" /></Field>
        <Field label="Allowance (£)"><Input value={catForm.allowance_pence_input || ''} onChange={(e) => setCatForm({ ...catForm, allowance_pence_input: e.target.value })} placeholder="e.g. £1,200" /></Field>
        <Field label="Notes"><Textarea rows={2} value={catForm.notes || ''} onChange={(e) => setCatForm({ ...catForm, notes: e.target.value })} /></Field>
      </Modal>

      {/* Item modal */}
      <Modal
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        title={isNewItem ? 'Add budget item' : 'Edit budget item'}
        size="md"
        footer={<><Button variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button><Button onClick={saveItem}>Save</Button></>}
      >
        {editingItem && (
          <div className="space-y-4">
            <Field label="Item name *"><Input value={itemForm.name || ''} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="e.g. Wedding dress" /></Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Estimate (£)" hint="Used until an agreed price exists">
                <Input value={itemForm.estimate_input || ''} onChange={(e) => setItemForm({ ...itemForm, estimate_input: e.target.value })} placeholder="e.g. £800" />
              </Field>
              <Field label="Agreed price (£)" hint="Takes precedence for the forecast">
                <Input value={itemForm.agreed_input || ''} onChange={(e) => setItemForm({ ...itemForm, agreed_input: e.target.value })} placeholder="e.g. £750" />
              </Field>
            </div>
            <Field label="Category">
              <Select value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Notes"><Textarea rows={2} value={itemForm.notes || ''} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title={deletingKind === 'cat' ? 'Delete this category?' : 'Delete this item?'}
        message={deletingKind === 'cat' ? 'All items and payments in this category will be deleted.' : 'This budget item and its payments will be deleted.'}
      />
    </div>
  );
}