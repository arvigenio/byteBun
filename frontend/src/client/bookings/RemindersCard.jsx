import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSaveSettingsMutation } from '../api.js';
import { bookingsBase } from '../lib/surface.js';
import { Button, Card, Checkbox, Field, Input, LinkButton, Select } from '../ui.jsx';

// Reminders to customers, the no-show follow-up, and alerts to the owner (backend:
// clients/booking/reminders.ts and notifications.ts). The API checks the plan again.
//   Free: email reminders 2 days and/or 1 day before.
//   Premium / Growth: up to 3, down to 1 hour before, by email or WhatsApp.
//   Bookings Pro and up: owner alerts by WhatsApp too.
const OFFSETS = [60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
const offsetLabel = (m) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'} before` : `${m / 60} hour${m === 60 ? '' : 's'} before`);
const ALERTS = [
  ['newBooking', 'New booking'],
  ['cancellation', 'Cancellation'],
  ['reschedule', 'Reschedule'],
];
const channelsOf = (alerts, key) => (Array.isArray(alerts?.[key]) ? alerts[key] : ['email']);

export function RemindersCard({ data, edit }) {
  const s = data.settings;
  const custom = data.customReminders;
  const [reminders, setReminders] = useState(s.reminders ?? []);
  const [noShow, setNoShow] = useState(s.noShowFollowUp);
  const [alerts, setAlerts] = useState(() => Object.fromEntries(ALERTS.map(([k]) => [k, channelsOf(s.ownerAlerts, k)])));
  const [phone, setPhone] = useState(s.alertPhone ?? '');
  const [save, state] = useSaveSettingsMutation();
  useEffect(() => {
    setReminders(s.reminders ?? []);
    setNoShow(s.noShowFollowUp);
    setAlerts(Object.fromEntries(ALERTS.map(([k]) => [k, channelsOf(s.ownerAlerts, k)])));
    setPhone(s.alertPhone ?? '');
  }, [s]);

  const has = (m) => reminders.some((r) => r.offsetMinutes === m);
  const toggleFree = (m, on) => setReminders((r) => (on ? [...r.filter((x) => x.offsetMinutes !== m), { offsetMinutes: m, channel: 'email' }] : r.filter((x) => x.offsetMinutes !== m)));
  const setRow = (i, patch) => setReminders((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toggleAlert = (key, channel, on) => setAlerts((a) => ({ ...a, [key]: on ? [...new Set([...a[key], channel])] : a[key].filter((c) => c !== channel) }));
  const duplicate = new Set(reminders.map((r) => r.offsetMinutes)).size !== reminders.length;
  const needsPhone = Object.values(alerts).some((c) => c.includes('whatsapp')) && !phone.trim();

  const submit = async () => {
    const r = await save({ reminders, noShowFollowUp: noShow, ownerAlerts: alerts, alertPhone: phone.trim() || null });
    if (r.error) return toast.error(r.error.message);
    toast.success('Reminders and alerts saved');
  };

  return (
    <Card
      title="Reminders and alerts"
      description="Reminders include the cancel and reschedule links, instructions and meeting links. They apply to new bookings."
      actions={
        edit && (
          <Button onClick={submit} loading={state.isLoading} disabled={duplicate || needsPhone}>
            Save
          </Button>
        )
      }
    >
      <fieldset disabled={!edit} className="flex flex-col gap-6">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Reminders to customers</h3>
          {custom ? (
            <div className="flex flex-col gap-2">
              {reminders.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select className="w-44" value={r.offsetMinutes} onChange={(e) => setRow(i, { offsetMinutes: Number(e.target.value) })} aria-label="When">
                    {OFFSETS.map((m) => (
                      <option key={m} value={m}>
                        {offsetLabel(m)}
                      </option>
                    ))}
                  </Select>
                  <Select className="w-36" value={r.channel} onChange={(e) => setRow(i, { channel: e.target.value })} aria-label="Channel">
                    <option value="email">Email</option>
                    {data.whatsapp && <option value="whatsapp">WhatsApp</option>}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => setReminders((x) => x.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              {reminders.length < 3 && (
                <Button size="sm" variant="secondary" className="self-start" onClick={() => setReminders((x) => [...x, { offsetMinutes: OFFSETS.find((m) => !x.some((r) => r.offsetMinutes === m)), channel: 'email' }])}>
                  + Add reminder
                </Button>
              )}
              {duplicate && <p className="text-[13px] text-danger">Each reminder needs a different time.</p>}
              {data.whatsapp && <p className="text-[13px] text-faint">WhatsApp goes to the phone number the customer enters; without one, the reminder is emailed.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Checkbox label="2 days before (email)" checked={has(2880)} onChange={(e) => toggleFree(2880, e.target.checked)} />
              <Checkbox label="1 day before (email)" checked={has(1440)} onChange={(e) => toggleFree(1440, e.target.checked)} />
              <p className="text-[13px] text-faint">
                Premium and Growth: up to 3 reminders, down to 1 hour before, by email or WhatsApp.{' '}
                <a className="text-brand underline" href={`${bookingsBase}/plan`}>
                  See plans
                </a>
              </p>
            </div>
          )}
        </div>

        <Checkbox label="No-show follow-up" hint="When you mark a booking as a no-show, the customer gets a friendly “we missed you” email with a link to book again." checked={noShow} onChange={(e) => setNoShow(e.target.checked)} />

        <div>
          <h3 className="mb-2 text-sm font-semibold">Alerts to you (owners and admins)</h3>
          <table className="text-sm">
            <tbody>
              {ALERTS.map(([key, label]) => (
                <tr key={key}>
                  <td className="py-1.5 pr-6">{label}</td>
                  <td className="py-1.5 pr-6">
                    <Checkbox label="Email" checked={alerts[key].includes('email')} onChange={(e) => toggleAlert(key, 'email', e.target.checked)} />
                  </td>
                  {data.whatsappAlerts && (
                    <td className="py-1.5">
                      <Checkbox label="WhatsApp" checked={alerts[key].includes('whatsapp')} onChange={(e) => toggleAlert(key, 'whatsapp', e.target.checked)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {data.whatsappAlerts ? (
            <Field label="WhatsApp number for alerts" hint="With country code, e.g. +1 416 555 0100." error={needsPhone ? 'Enter the number that should get WhatsApp alerts.' : undefined} className="mt-3 max-w-xs">
              {(a) => <Input {...a} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />}
            </Field>
          ) : (
            <div className="mt-3">
              <LinkButton href={`${bookingsBase}/plan`} size="sm">
                WhatsApp alerts: Bookings Pro
              </LinkButton>
            </div>
          )}
        </div>
      </fieldset>
    </Card>
  );
}
