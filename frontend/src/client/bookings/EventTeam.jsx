import { toast } from 'sonner';
import { useAssignEventMutation, useEventTeamQuery, useUnassignEventMutation } from '../api.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Button, Card, LinkButton, Loading, Notice, Select } from '../ui.jsx';

// Who works on this event (backend team/team.controller.ts). Owners and admins are on every
// event; everyone else sees the event (and its chat room) only while assigned here.
export function EventTeamTab({ e }) {
  const q = useEventTeamQuery(e.id);
  const [assign, assignState] = useAssignEventMutation();
  const [unassign] = useUnassignEventMutation();
  if (q.isLoading) return <Loading />;
  if (q.error) return <Notice tone="danger">{q.error.message}</Notice>;
  const { canAssign, everyEvent, assigned, available } = q.data;
  const run = async (p, ok) => {
    const r = await p;
    if (r.error) toast.error(r.error.message);
    else toast.success(ok);
  };
  return (
    <Card
      title="Event team"
      description="Team members see this event, with what their role allows, only while they’re assigned to it. Owners and admins are on every event."
      actions={
        <LinkButton size="sm" href={`${bookingsBase}/chat#event-${e.id}`}>
          Open the event chat
        </LinkButton>
      }
    >
      <ul className="divide-y divide-line">
        {[...everyEvent, ...assigned].map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name || m.email}</p>
              <p className="truncate text-sm text-faint">{m.email}</p>
            </div>
            <Badge tone={m.allEvents ? 'brand' : 'neutral'}>{m.roleName}</Badge>
            {m.allEvents ? (
              <span className="text-xs text-muted">Every event</span>
            ) : (
              canAssign && (
                <Button size="sm" variant="ghost" onClick={() => run(unassign({ id: e.id, userId: m.userId }), `${m.name || m.email} removed from this event`)}>
                  Remove
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      {canAssign &&
        (available.length ? (
          <form
            className="mt-4 flex flex-wrap items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              const userId = new FormData(ev.currentTarget).get('userId');
              if (userId) run(assign({ id: e.id, userId }), 'Assigned to this event');
            }}
          >
            <Select name="userId" className="max-w-72" aria-label="Team member" defaultValue="">
              <option value="" disabled>
                Choose a team member…
              </option>
              {available.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email} ({m.roleName})
                </option>
              ))}
            </Select>
            <Button type="submit" loading={assignState.isLoading}>
              Assign
            </Button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted">Everyone on the team is already on this event. Invite more people on the Team page.</p>
        ))}
    </Card>
  );
}
