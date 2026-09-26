// Scripted playback is deliberately memory only. Runtime mode reads the
// existing Context API and never initializes another database or ledger.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ActorRef, HQEvent, HQEventType, PayloadByType, ProjectScope } from "../shared/events.ts";

export type DraftEvent = {
  [T in HQEventType]: { type: T; runId: string; actor: ActorRef; payload: PayloadByType[T] };
}[HQEventType];

type Listener = (event: HQEvent) => void;

export interface EventStore {
  readonly mode: "memory";
  readonly detail: string;
  append(scope: ProjectScope, draft: DraftEvent): Promise<HQEvent>;
  list(projectId: string): Promise<HQEvent[]>;
  latestProjectId(): Promise<string | null>;
  onEvent(listener: Listener): () => void;
  close(): Promise<void>;
}

function envelope(scope: ProjectScope, draft: DraftEvent, revision: number): HQEvent {
  return {
    ...draft,
    eventId: `evt_${randomUUID().slice(0, 8)}`,
    scope,
    revision,
    cursor: String(revision).padStart(6, "0"),
    occurredAt: new Date().toISOString(),
  } as HQEvent;
}

export class MemoryStore implements EventStore {
  readonly mode = "memory";
  readonly detail = "Simulation · in memory · resets when this process exits";
  private readonly events: HQEvent[] = [];
  private readonly emitter = new EventEmitter();

  async append(scope: ProjectScope, draft: DraftEvent) {
    const revision = this.events.filter((e) => e.scope.projectId === scope.projectId).length + 1;
    const event = envelope(scope, draft, revision);
    this.events.push(event);
    this.emitter.emit("event", event);
    return event;
  }

  async list(projectId: string) {
    return this.events.filter((e) => e.scope.projectId === projectId);
  }

  async latestProjectId() {
    return this.events.at(-1)?.scope.projectId ?? null;
  }

  onEvent(listener: Listener) {
    this.emitter.on("event", listener);
    return () => void this.emitter.off("event", listener);
  }

  async close() { this.emitter.removeAllListeners(); }
}
