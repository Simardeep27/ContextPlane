import { useEffect, useRef } from "react";

import { agentProfiles, type AgentKey } from "../../shared/events.ts";
import type { TimelineItem } from "../../shared/projection.ts";
import { clock } from "./format.ts";

interface Props {
  items: readonly TimelineItem[];
  open: boolean;
  onToggle: () => void;
  filter: AgentKey | null;
  onClearFilter: () => void;
  highlight: string | null;
  storeDetail: string | undefined;
}

export function Timeline({ items, open, onToggle, filter, onClearFilter, highlight, storeDetail }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const shown = filter ? items.filter((i) => i.agents.includes(filter)) : items;

  useEffect(() => {
    if (!open || !list.current) return;
    const target = highlight ? list.current.querySelector(`[data-event="${highlight}"]`) : null;
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    else list.current.scrollTop = list.current.scrollHeight;
  }, [open, highlight, shown.length]);

  return (
    <section className={`timeline panel${open ? " is-open" : ""}`}>
      <header className="timeline__head">
        <button type="button" className="timeline__toggle" onClick={onToggle} aria-expanded={open}>
          <span className="caret">{open ? "▾" : "▸"}</span>
          Evidence trail
          <span className="count">{shown.length}</span>
        </button>
        {filter && (
          <button type="button" className="chip is-active" onClick={onClearFilter}>
            {agentProfiles[filter].name} ✕
          </button>
        )}
        <span className="timeline__source muted small">{storeDetail}</span>
      </header>
      {open && (
        <ol className="timeline__list" ref={list}>
          {shown.length === 0 && <li className="muted small">No events yet.</li>}
          {shown.map((item) => (
            <li key={item.eventId} data-event={item.eventId} className={item.eventId === highlight ? "is-highlight" : ""}>
              <span className="mono muted">#{String(item.revision).padStart(3, "0")}</span>
              <span className="mono muted">{clock(item.at)}</span>
              <span className={`type type--${item.type.split(".")[0]}`}>{item.type}</span>
              <span className="timeline__summary">{item.summary}</span>
              <span className="timeline__actor muted small">{item.actor}</span>
              <span className="mono small muted">{item.evidenceIds.join(" ")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
