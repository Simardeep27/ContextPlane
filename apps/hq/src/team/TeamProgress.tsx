import { people, freshness, type TeamSnapshot } from '../../shared/team.ts';

export function TeamProgress({ snapshot }: { snapshot: TeamSnapshot | null }) {
  const recent = [...(snapshot?.events ?? [])].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 6);
  return <section className="episode" aria-labelledby="team-progress-title">
    <header className="episode-head"><h2 id="team-progress-title">Building Company Harness together</h2><span className="replay-badge">Live team reports</span></header>
    <p className="episode-task"><span>Our project</span>Connect Shivraj, Simar, Buddhsen and Tanish’s agents through shared context, persistent memory and a live command center.</p>
    <p className="episode-muted">Latest update from each person’s agents. Reports describe what teammates shared; older reports may no longer reflect current work.</p>
    {!snapshot ? <p className="episode-muted">Waiting for the shared team state…</p> : <>
      <ol className="stepper">{people.map(person => {
        const agent = snapshot.agents.filter(a => a.person === person).sort((a, b) => Date.parse(b.reportedAt ?? b.publishedAt ?? '1970-01-01') - Date.parse(a.reportedAt ?? a.publishedAt ?? '1970-01-01'))[0];
        return <li key={person} className="done"><strong>{person === 'Buddh' ? 'Buddhsen' : person}</strong>
          <p>{agent?.currentTask ?? agent?.task ?? 'No work update shared yet.'}</p>
          {agent && <><small>{agent.identity} · reported {agent.status} · {freshness(agent, Date.now())} report</small>
            {agent.nextAction && <p><strong>Next: </strong>{agent.nextAction}</p>}
            <small>{agent.reportedAt ? new Date(agent.reportedAt).toLocaleString() : 'Time not reported'}</small></>}
        </li>;
      })}</ol>
      <h3>Recent shared activity</h3>
      {recent.length ? <ol className="team-activity">{recent.map((event, i) => <li key={`${event.actor}:${event.occurredAt}:${i}`}>
        <small>{new Date(event.occurredAt).toLocaleString()} · {event.actor} · {event.type.replaceAll('_', ' ')}</small>
        <p>{event.summary ?? event.task ?? 'Activity recorded without a summary.'}</p>
      </li>)}</ol> : <p className="episode-muted">No ledger events returned in this snapshot. The updates above come from work-status reports.</p>}
      <small>Fetched {new Date(snapshot.fetchedAt).toLocaleString()} · updates every 5 seconds while this page is visible.</small>
    </>}
  </section>;
}
