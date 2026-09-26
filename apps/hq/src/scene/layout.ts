import { QuadraticBezierCurve3, Vector3 } from "three";

import type { AgentKey } from "../../shared/events.ts";
import type { AgentState } from "../../shared/projection.ts";

export const stations: Readonly<Record<AgentKey, readonly [number, number, number]>> = {
  pm: [0, 0, -3.4],
  orders: [-3.6, 0, 0.2],
  notifications: [3.6, 0, 0.2],
  billing: [0, 0, 3.2],
};

export const stateColors: Readonly<Record<AgentState, string>> = {
  idle: "#64748b",
  investigating: "#818cf8",
  coding: "#22d3ee",
  waiting_approval: "#fbbf24",
  blocked: "#f87171",
  testing: "#c084fc",
  coordinating: "#2dd4bf",
  complete: "#4ade80",
};

// Arc between two stations, raised in the middle so crossing links stay
// readable. Reversed pairs bow to opposite sides.
export function linkCurve(from: AgentKey, to: AgentKey): QuadraticBezierCurve3 {
  const start = new Vector3(...stations[from]).setY(1.1);
  const end = new Vector3(...stations[to]).setY(1.1);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const side = new Vector3().subVectors(end, start).cross(new Vector3(0, 1, 0)).normalize();
  mid.add(side.multiplyScalar(from < to ? 0.6 : -0.6)).setY(2.3);
  return new QuadraticBezierCurve3(start, mid, end);
}

// Wall-clock window in which a live event still animates in the scene.
export const liveWindowMs = 2600;
