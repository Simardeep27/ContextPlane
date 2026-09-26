import { useMemo, useState } from "react";

import { answerQuestion } from "../../shared/ask.ts";
import type { HQView } from "../../shared/projection.ts";
import { stateColors } from "../scene/layout.ts";
import { clock } from "./format.ts";

const suggestions = ["What is everyone working on?", "Who is blocked?", "What has shipped?"];

interface Props {
  view: HQView;
  onCite: (eventId: string) => void;
}

export function ManagerPanel({ view, onCite }: Props) {
  const [draft, setDraft] = useState(suggestions[0]!);
  const [question, setQuestion] = useState(suggestions[0]!);
  // Recomputed on every event, so the answer stays live.
  const answer = useMemo(() => answerQuestion(question, view), [question, view]);

  return (
    <section className="manager panel">
      <h2>Ask the command center</h2>
      <form
        className="manager__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setQuestion(draft.trim());
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Question for the command center" />
        <button type="submit" className="btn btn--small">Ask</button>
      </form>
      <div className="chips">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${s === question ? " is-active" : ""}`}
            onClick={() => {
              setDraft(s);
              setQuestion(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="answer">
        <p className="answer__meta">
          <span className="live-dot" /> Live answer · {answer.scopeNote}
          {answer.asOfCursor && (
            <> · as of event <span className="mono">#{answer.asOfCursor}</span> ({clock(answer.asOfTime!)})</>
          )}
        </p>
        {answer.lines.length === 0 ? (
          <p className="muted">No agents match that question right now.</p>
        ) : (
          <ul className="answer__lines">
            {answer.lines.map((line) => (
              <li key={line.agent}>
                <span className="state-dot" style={{ background: stateColors[line.state] }} />
                <div>
                  <p>{line.text}</p>
                  {line.citations.length > 0 && (
                    <p className="citations">
                      {line.citations.map((c) => (
                        <button key={c.eventId} type="button" className="cite mono" onClick={() => onCite(c.eventId)}>
                          {c.eventId} · {clock(c.at)}
                        </button>
                      ))}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="answer__foot">Built only from recorded events. No model summarization.</p>
      </div>
    </section>
  );
}
