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

// Messages and change proposals that arrived live travel along their link.
export function Packets({ events, live }: { events: readonly HQEvent[]; live: LiveReceipts }) {
  const now = performance.now();
  const packets: { key: string; from: AgentKey; to: AgentKey; startedAt: number }[] = [];
  for (const event of events) {
    const receivedAt = live.get(event.eventId);
    if (receivedAt === undefined || now - receivedAt > liveWindowMs) continue;
    if (event.type === "message.sent" && event.payload.from !== event.payload.to) {
      packets.push({ key: event.eventId, from: event.payload.from, to: event.payload.to, startedAt: receivedAt });
    }
    if (event.type === "change.proposed") {
      event.payload.affected.forEach((to, index) =>
        packets.push({ key: `${event.eventId}:${to}`, from: event.payload.agent, to, startedAt: receivedAt + index * 150 }),
      );
    }
  }
  return (
    <>
      {packets.map(({ key, ...packet }) => (
        <Packet key={key} {...packet} />
      ))}
    </>
  );
}
