/**
 * Family access: who may open the read-only family payment portal. Adding or
 * removing an address saves to the plan and is mirrored to Cloudflare Access;
 * the sync line says whether that has gone live yet.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api, FamilyAccess, FamilyMember } from '../api/client';
import { Card, Badge, Button, Input, Spinner, ConfirmDialog } from './ui';
import { formatDateTime } from '../utils/helpers';
import { siteOrigin } from '../utils/site';

export default function FamilyAccessCard() {
  const { showToast } = useApp();
  const [data, setData] = useState<FamilyAccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);

  useEffect(() => {
    api.family.access().then(setData).catch(() => setFailed(true));
  }, []);

  // Every change returns the fresh list + sync result; say which it was.
  const applied = (next: FamilyAccess, done: string) => {
    setData(next);
    if (next.sync?.state === 'failed') showToast(`${done} — saved, but not yet live in Cloudflare.`, 'error');
    else showToast(done, 'success');
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      applied(await api.family.add(email.trim(), label.trim()), 'Added to the family list');
      setEmail('');
      setLabel('');
    } catch (e: any) {
      showToast(e.message || 'Could not add that address', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    try {
      applied(await api.family.remove(removing.id), 'Removed from the family list');
    } catch (e: any) {
      showToast(e.message || 'Could not remove', 'error');
    } finally {
      setRemoving(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const next = await api.family.sync();
      setData(next);
      showToast(next.sync?.message || 'Synced', next.sync?.state === 'synced' ? 'success' : 'error');
    } catch (e: any) {
      showToast(e.message || 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const sync = data?.sync || null;
  const portalUrl = data?.portal_url || siteOrigin('family');
  const portalHost = portalUrl.replace(/^https?:\/\//, '');

  return (
    <Card className="mt-6" title="Family access" subtitle="Who can open the read-only family payment portal">
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-charcoal-600">
          Family sign in at <a className="text-sage-600 underline" href={portalUrl} target="_blank" rel="noopener noreferrer">{portalHost}</a> with
          a code emailed to the address you add here — no password. You two are always on the list.
        </p>

        <div className="flex gap-2 flex-wrap">
          <Input className="flex-1 min-w-[14rem]" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" maxLength={254} />
          <Input className="flex-1 min-w-[10rem]" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Who is it? (optional)" maxLength={60} />
          <Button variant="outline" onClick={handleAdd} loading={adding} disabled={!email.trim() || !data}>Add</Button>
        </div>

        {failed ? (
          <p className="text-xs text-red-600">Could not load the family list.</p>
        ) : data === null ? (
          <Spinner size="sm" />
        ) : data.members.length === 0 ? (
          <p className="text-xs text-charcoal-400">No family added yet — only you two can open the family portal.</p>
        ) : (
          <ul className="divide-y divide-charcoal-100 border border-charcoal-200 rounded-lg">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-700 truncate">{m.label || m.email}</p>
                  {m.label && <p className="text-xs text-charcoal-400 truncate">{m.email}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setRemoving(m)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}

        {data && (
          <div className="flex items-center justify-between gap-3 flex-wrap bg-charcoal-50 rounded-lg px-3 py-2">
            <div className="min-w-0 text-xs text-charcoal-600">
              {!sync ? (
                <span>Not synced to Cloudflare yet.</span>
              ) : (
                <>
                  <Badge tone={sync.state === 'synced' ? 'success' : sync.state === 'failed' ? 'danger' : 'warning'}>
                    {sync.state === 'synced' ? 'Live in Cloudflare' : sync.state === 'failed' ? 'Saved, but not yet live in Cloudflare' : 'Saved here — sync not set up'}
                  </Badge>
                  <span className="ml-2">{sync.message}</span>
                  <span className="ml-2 text-charcoal-400">Last attempt {formatDateTime(sync.at)}</span>
                </>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={handleSync} loading={syncing} disabled={!data.sync_configured} title={data.sync_configured ? 'Send the current list to Cloudflare again' : 'Automatic sync to Cloudflare is not set up yet'}>
              Sync now
            </Button>
          </div>
        )}

        <p className="text-xs text-charcoal-400">
          Removing someone blocks them from the page straight away and stops new sign-in codes. Up to {data?.limit ?? 50} addresses.
        </p>
      </div>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={handleRemove}
        title="Remove from the family list?"
        message={removing ? `${removing.label || removing.email} will no longer be able to open the family payment portal. You can add them again any time.` : ''}
        confirmLabel="Remove"
      />
    </Card>
  );
}
