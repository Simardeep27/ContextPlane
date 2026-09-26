import { useState } from "react";

import { agentProfiles } from "../../shared/events.ts";
import type { AccessRequestView } from "../../shared/projection.ts";
import { relative, useNow } from "./format.ts";

interface Props {
  request: AccessRequestView;
  onDecide: (decision: "approved" | "denied") => Promise<void>;
  onInspect: () => void;
}

export function ApprovalCard({ request, onDecide, onInspect }: Props) {
  const now = useNow();
  const [pending, setPending] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = agentProfiles[request.agent];

  const decide = async (decision: "approved" | "denied") => {
    setPending(decision);
    setError(null);
    try {
      await onDecide(decision);
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  };

  return (
    <section className="approval panel" aria-live="polite">
      <div className="approval__head">
        <span className="approval__badge">Access request</span>
        <span className="mono muted">{request.accessRequestId}</span>
      </div>
      <p className="approval__title">
        <button type="button" className="link" onClick={onInspect}>{profile.name}</button> needs{" "}
        <strong>{request.action}</strong> access to <code>{request.resource}</code>
      </p>
      <p className="approval__purpose">“{request.purpose}”</p>
      <dl className="approval__facts">
        <div><dt>Owner</dt><dd>{request.owner}</dd></div>
        <div><dt>Grant expires</dt><dd>{relative(request.expiresAt, now)}</dd></div>
      </dl>
      <div className="approval__actions">
        <button type="button" className="btn btn--approve" disabled={pending !== null} onClick={() => decide("approved")}>
          {pending === "approved" ? "Approving…" : `Approve as ${request.owner.split(" ")[0]}`}
        </button>
        <button type="button" className="btn btn--ghost" disabled={pending !== null} onClick={() => decide("denied")}>
          Deny
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="approval__note">Only a human owner can decide. Agents have no approval tool.</p>
    </section>
  );
}
