import { QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";

import { agentProfiles, type AgentKey, type HQEvent } from "../../shared/events.ts";
import type { LinkView } from "../../shared/projection.ts";
import type { LiveReceipts } from "../useEventStream.ts";
import { linkCurve, liveWindowMs, stateColors } from "./layout.ts";

type LineRef = { material: { dashOffset: number } } | null;

function Link({ link, receivedAt }: { link: LinkView; receivedAt: number | undefined }) {
  const curve = useMemo(() => linkCurve(link.from, link.to), [link.from, link.to]);
  const line = useRef<LineRef>(null);
  const active = receivedAt !== undefined && performance.now() - receivedAt < liveWindowMs * 2;

  useFrame((_, delta) => {
    if (link.blocking && line.current) line.current.material.dashOffset -= delta * 1.5;
  });

  const color = link.blocking ? stateColors.blocked : agentProfiles[link.from].color;
  return (
    <QuadraticBezierLine
      // Dashed and solid lines need different materials; remount on change.
      key={link.blocking ? "blocking" : "normal"}
      ref={line as never}
      start={curve.v0}
      mid={curve.v1}
      end={curve.v2}
      color={color}
      lineWidth={link.blocking ? 2.4 : active ? 3 : 1.4}
      transparent
      opacity={link.blocking || active ? 0.95 : 0.35}
      dashed={link.blocking}
      dashSize={0.25}
      gapSize={0.18}
      toneMapped={false}
    />
  );
}

export function Links({ links, live }: { links: readonly LinkView[]; live: LiveReceipts }) {
  return (
    <>
      {links.map((link) => (
        <Link key={`${link.from}->${link.to}`} link={link} receivedAt={live.get(link.lastEventId)} />
      ))}
    </>
  );
}

const packetMs = 1300;

function Packet({ from, to, startedAt }: { from: AgentKey; to: AgentKey; startedAt: number }) {
  const curve = useMemo(() => linkCurve(from, to), [from, to]);
  const mesh = useRef<Mesh>(null);

  useFrame(() => {
    if (!mesh.current) return;
    const t = (performance.now() - startedAt) / packetMs;
    mesh.current.visible = t >= 0 && t <= 1;
    if (mesh.current.visible) mesh.current.position.copy(curve.getPoint(t));
  });

  return (
    <mesh ref={mesh} visible={false}>
      <sphereGeometry args={[0.13, 16, 16]} />
      <meshBasicMaterial color={agentProfiles[from].color} toneMapped={false} />
    </mesh>
  );
}

// Messages, change proposals, and link activity that arrived live travel
// along their link. Keys are `${eventId}:${from}->${to}` so the same hop is
// drawn once whichever source reports it.
export function Packets({ events, links, live }: { events: readonly HQEvent[]; links: readonly LinkView[]; live: LiveReceipts }) {
  const now = performance.now();
  const packets = new Map<string, { from: AgentKey; to: AgentKey; startedAt: number }>();
  const add = (eventId: string, from: AgentKey, to: AgentKey, startedAt: number) => {
    if (from !== to) packets.set(`${eventId}:${from}->${to}`, { from, to, startedAt });
  };
  const recent = (eventId: string) => {
    const receivedAt = live.get(eventId);
    return receivedAt !== undefined && now - receivedAt <= liveWindowMs ? receivedAt : undefined;
  };
  for (const event of events) {
    const receivedAt = recent(event.eventId);
    if (receivedAt === undefined) continue;
    if (event.type === "message.sent") add(event.eventId, event.payload.from, event.payload.to, receivedAt);
    if (event.type === "change.proposed") {
      event.payload.affected.forEach((to, index) => add(event.eventId, event.payload.agent, to, receivedAt + index * 150));
    }
  }
  for (const link of links) {
    const receivedAt = recent(link.lastEventId);
    if (receivedAt !== undefined) add(link.lastEventId, link.from, link.to, receivedAt);
  }
  return (
    <>
      {[...packets].map(([key, packet]) => (
        <Packet key={key} {...packet} />
      ))}
    </>
  );
}
