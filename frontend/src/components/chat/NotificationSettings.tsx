/** Turn push notifications on/off for this device, and set your name in chats. */
import React, { useEffect, useState } from 'react';
import { chatApi, type ChatMe } from '../../api/chat';
import { useApp } from '../../context/AppContext';
import { Button, Card, Input } from '../ui';
import { currentSubscription, deviceLabel, pushState, subscribePush, type PushState } from '../../utils/device';

export function NotificationSettings({ me, onChanged }: { me: ChatMe; onChanged: () => void }) {
  const { showToast } = useApp();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(me.name);
  const [level, setLevel] = useState(me.notify.level);
  const [quietOn, setQuietOn] = useState(!!me.notify.quiet_start);
  const [quietStart, setQuietStart] = useState(me.notify.quiet_start || '22:00');
  const [quietEnd, setQuietEnd] = useState(me.notify.quiet_end || '07:30');
  const [savingPrefs, setSavingPrefs] = useState(false);
  const prefsChanged =
    level !== me.notify.level || quietOn !== !!me.notify.quiet_start || (quietOn && (quietStart !== me.notify.quiet_start || quietEnd !== me.notify.quiet_end));

  const savePrefs = async () => {
    setSavingPrefs(true);
    try {
      await chatApi.setNotify({ level, quiet_start: quietOn ? quietStart : '', quiet_end: quietOn ? quietEnd : '' });
      showToast('Notification settings saved', 'success');
      onChanged();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const refresh = () => pushState().then(setState).catch(() => setState('unsupported'));
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => setName(me.name), [me.name]);
  useEffect(() => {
    setLevel(me.notify.level);
    setQuietOn(!!me.notify.quiet_start);
    if (me.notify.quiet_start) setQuietStart(me.notify.quiet_start);
    if (me.notify.quiet_end) setQuietEnd(me.notify.quiet_end);
  }, [me.notify]);

  const turnOn = async () => {
    setBusy(true);
    try {
      const sub = await subscribePush(me.push.public_key);
      await chatApi.push.subscribe(sub.toJSON(), deviceLabel());
      await chatApi.push.test(sub.endpoint).catch(() => undefined);
      showToast('Notifications are on for this device', 'success');
      onChanged();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await chatApi.push.unsubscribe({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      showToast('Notifications are off for this device', 'success');
      onChanged();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const test = async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      await chatApi.push.test(sub.endpoint);
      showToast('Test notification sent', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const saveName = async () => {
    try {
      await chatApi.setName(name);
      showToast('Name saved', 'success');
      onChanged();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const others = me.push.devices.filter((d) => !d.this_device);

  return (
    <Card title="Notifications" subtitle="Get a ping when the assistant has a question or there's news in a chat.">
      <div className="p-5 space-y-3 text-sm">
        {state === null ? null : state === 'on' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sage-700">✓ On for this device</span>
            <Button size="sm" variant="ghost" onClick={test}>Send a test</Button>
            <Button size="sm" variant="ghost" onClick={turnOff} loading={busy}>Turn off</Button>
          </div>
        ) : state === 'off' ? (
          <Button onClick={turnOn} loading={busy}>Turn on notifications here</Button>
        ) : state === 'denied' ? (
          <p className="text-charcoal-600">Notifications are blocked for this site in your browser settings. Allow them there, then come back.</p>
        ) : state === 'needs-install' ? (
          <p className="text-charcoal-600">
            On iPhone and iPad, add the planner to your Home Screen first (Share → <strong>Add to Home Screen</strong>), open it from there, then turn notifications on here.
          </p>
        ) : (
          <p className="text-charcoal-600">This browser doesn't support push notifications.</p>
        )}
        {others.length > 0 && (
          <p className="text-xs text-charcoal-500">
            Also on: {others.map((d) => `${d.label || 'a device'}${d.name ? ` (${d.name})` : ''}`).join(', ')}
          </p>
        )}
        <p className="text-xs text-charcoal-500">
          {me.email_fallback
            ? "If you haven't turned push notifications on anywhere, you'll get an email from the planner instead (chat updates at most once an hour per chat; questions every time)."
            : 'Email fallback is off until the planner mailbox is set up.'}
        </p>
        <div className="pt-2 border-t border-charcoal-100 space-y-2.5">
          <p className="text-xs text-charcoal-500">
            Your settings{me.email ? '' : ' (shared: you sign in with a password, so the planner can\'t tell you two apart)'}, for push and email alike:
          </p>
          <fieldset className="space-y-1">
            <legend className="sr-only">What to notify you about</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="notify-level" checked={level === 'all'} onChange={() => setLevel('all')} />
              Everything: questions, plus new messages and replies in any chat
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="notify-level" checked={level === 'questions'} onChange={() => setLevel('questions')} />
              Only when the assistant has a question
            </label>
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={quietOn} onChange={(e) => setQuietOn(e.target.checked)} />
            Quiet hours (UK time)
          </label>
          {quietOn && (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <div className="w-36"><Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} aria-label="Quiet hours start" /></div>
              <span className="text-charcoal-500">to</span>
              <div className="w-36"><Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} aria-label="Quiet hours end" /></div>
              <span className="basis-full text-xs text-charcoal-500">Nothing pings you then. Anything that came in arrives as one summary when quiet hours end.</span>
            </div>
          )}
          <Button size="sm" variant="secondary" onClick={savePrefs} loading={savingPrefs} disabled={!prefsChanged}>Save notification settings</Button>
        </div>
        {me.can_rename && (
          <div className="pt-2 border-t border-charcoal-100">
            <label className="block text-xs text-charcoal-500 mb-1">Your name in chats</label>
            <div className="flex gap-2">
              <div className="w-full max-w-xs"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
              <Button size="sm" variant="secondary" onClick={saveName} disabled={!name.trim() || name === me.name}>Save</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
