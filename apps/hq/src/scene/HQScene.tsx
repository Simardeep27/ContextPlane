import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshStandardMaterial } from "three";

import { agentKeys, type AgentKey, type HQEvent } from "../../shared/events.ts";
import type { HQView } from "../../shared/projection.ts";
import type { LiveReceipts } from "../useEventStream.ts";
import { AgentCharacter } from "./AgentCharacter.tsx";
import { liveWindowMs } from "./layout.ts";
import { Links, Packets } from "./Links.tsx";

interface Props {
  view: HQView;
  events: readonly HQEvent[];
  live: LiveReceipts;
  selected: AgentKey | null;
  onSelect: (agent: AgentKey | null) => void;
}

// The shared context plane at the center of the room; it flares whenever a
// new event is recorded.
function Core({ lastLiveAt }: { lastLiveAt: number | null }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (!mesh.current || !material.current) return;
    mesh.current.rotation.y += delta * 0.4;
    mesh.current.rotation.x += delta * 0.15;
    const since = lastLiveAt === null ? Infinity : (performance.now() - lastLiveAt) / 600;
    material.current.emissiveIntensity = 0.6 + Math.max(0, 1 - since) * 2.2;
  });
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.05, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.9, 48]} />
        <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh ref={mesh} position={[0, 0.9, 0]}>
        <icosahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial ref={material} color="#0f766e" emissive="#14b8a6" flatShading wireframe={false} />
      </mesh>
    </group>
  );
}

export function HQScene({ view, events, live, selected, onSelect }: Props) {
  const recent = events.slice(-30);
  const lastLiveAt = [...live.values()].at(-1) ?? null;

  const pulseFor = (agent: AgentKey): number | null => {
    const a = view.agents[agent];
    const candidates = [a.stateSince?.eventId, a.affectedBy?.eventId]
      .map((id) => (id ? live.get(id) : undefined))
      .filter((at): at is number => at !== undefined && performance.now() - at < liveWindowMs);
    return candidates.length > 0 ? Math.max(...candidates) : null;
  };

  return (
    <Canvas
      shadows
      camera={{ position: [-0.9, 8.2, 11.2], fov: 42 }}
      // Clicks on the HTML agent labels bubble through the canvas container
      // and register as misses; only clear the selection for real misses.
      onPointerMissed={(event) => {
        if ((event.target as Element | null)?.closest?.(".agent-label")) return;
        onSelect(null);
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#060913"]} />
      <fog attach="fog" args={["#060913", 16, 32]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 10, 6]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 4, 0]} intensity={12} color="#2dd4bf" distance={12} />

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#0a0f1c" roughness={0.9} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[28, 28]}
        cellSize={0.6}
        cellThickness={0.5}
        cellColor="#13243a"
        sectionSize={3}
        sectionThickness={1}
        sectionColor="#1d4ed8"
        fadeDistance={24}
        fadeStrength={1.4}
      />

      <Core lastLiveAt={lastLiveAt} />
      <Links links={view.links} live={live} />
      <Packets events={recent} links={view.links} live={live} />
      {agentKeys.map((key) => (
        <AgentCharacter
          key={key}
          agent={view.agents[key]}
          selected={selected === key}
          pulseAt={pulseFor(key)}
          hasPendingApproval={view.accessRequests.some((r) => r.agent === key && r.status === "pending")}
          onSelect={() => onSelect(key)}
        />
      ))}

      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={22}
        maxPolarAngle={1.2}
        target={[-0.9, 0.6, 0.3]}
      />
    </Canvas>
  );
}
