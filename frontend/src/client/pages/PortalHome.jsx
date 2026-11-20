import { useConfigQuery, useMeQuery, useOverviewQuery } from '../api.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Card, LinkButton, PageHeader } from '../ui.jsx';

// The client portal's home: every app, the ones in the plan to open.
export function PortalHome() {
  const { data: me } = useMeQuery();
  useConfigQuery();
  const hasBookings = me.business.apps.some((a) => a.key === 'bookings' && a.enabled);
  const overview = useOverviewQuery(undefined, { skip: !hasBookings });
  return (
    <>
      <PageHeader title={`Welcome${me.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}`} description={`${me.business.name} · ${me.business.plan.name}`} />
      <div className="grid gap-4 desktop:grid-cols-2">
        {me.business.apps.map((a) => (
          <Card
            key={a.key}
            title={a.name}
            description={a.description}
            actions={a.enabled && a.live ? <Badge tone="ok">In your plan</Badge> : <Badge>{a.live ? 'Not in plan' : 'Coming soon'}</Badge>}
          >
            {a.key === 'bookings' && a.enabled && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted">{overview.data ? `${overview.data.upcoming} upcoming · ${overview.data.today} today` : ' '}</p>
                <LinkButton href={bookingsBase} variant="primary">
                  Open Bookings
                </LinkButton>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
