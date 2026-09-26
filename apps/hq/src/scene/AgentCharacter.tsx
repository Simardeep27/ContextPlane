import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState, type CSSProperties } from "react";
import { MathUtils, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";

import { agentProfiles } from "../../shared/events.ts";
import { stateLabels, type AgentView } from "../../shared/projection.ts";
import { stateColors, stations } from "./layout.ts";

interface Props {
  agent: AgentView;
  selected: boolean;
  // performance.now() of the live event that last changed this agent, if any.
  pulseAt: number | null;
  hasPendingApproval: boolean;
  onSelect: () => void;
}

const stateIcons: Partial<Record<AgentView["state"], string>> = {
  waiting_approval: "⏳",
  blocked: "!",
  complete: "✓",
};

export function AgentCharacter({ agent, selected, pulseAt, hasPendingApproval, onSelect }: Props) {
  const profile = agentProfiles[agent.key];
  const color = stateColors[agent.state];
  const [hovered, setHovered] = useState(false);

  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const ring = useRef<MeshBasicMaterial>(null);
  const shock = useRef<Mesh>(null);
  const shockMaterial = useRef<MeshBasicMaterial>(null);
  const orbit = useRef<Group>(null);
  const visor = useRef<MeshStandardMaterial>(null);
  const antenna = useRef<MeshStandardMaterial>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const state = agent.state;
    if (!body.current || !head.current) return;

    const sinceLive = pulseAt === null ? Infinity : (performance.now() - pulseAt) / 1000;
    const hop = state === "complete" && sinceLive < 0.9 ? Math.sin((sinceLive / 0.9) * Math.PI) * 0.55 : 0;
    const bob =
      state === "coding" ? Math.abs(Math.sin(t * 9)) * 0.04
      : state === "coordinating" ? Math.abs(Math.sin(t * 3.2)) * 0.12
      : state === "idle" ? Math.sin(t * 1.2) * 0.02
      : Math.sin(t * 2) * 0.03;
    body.current.position.y = 0.2 + bob + hop;

    const lean = state === "blocked" ? 0.32 : state === "waiting_approval" ? 0.12 : 0;
    body.current.rotation.x = MathUtils.damp(body.current.rotation.x, lean, 4, delta);

    const yaw =
      state === "investigating" ? Math.sin(t * 1.6) * 0.7
      : state === "coordinating" ? Math.sin(t * 0.8) * 0.3
      : 0;
    head.current.rotation.y = MathUtils.damp(head.current.rotation.y, yaw, 5, delta);

    const urgent = state === "blocked" || state === "waiting_approval";
    if (ring.current) ring.current.opacity = urgent ? 0.55 + Math.sin(t * 5) * 0.45 : state === "idle" ? 0.35 : 0.9;
    if (visor.current) {
      visor.current.emissiveIntensity = state === "coding" ? 1.4 + Math.sin(t * 22) * 0.5 : urgent ? 1 + Math.sin(t * 5) : 1.3;
    }
    if (antenna.current) {
      antenna.current.emissiveIntensity = state === "coordinating" || state === "coding" ? (Math.sin(t * 10) > 0 ? 3 : 0.4) : 1.5;
    }
    if (orbit.current) {
      orbit.current.visible = state === "testing";
      orbit.current.rotation.y += delta * 3.5;
      orbit.current.rotation.z = Math.sin(t * 2) * 0.35;
    }
    if (shock.current && shockMaterial.current) {
      const progress = sinceLive / 1.4;
      shock.current.visible = progress < 1;
      if (progress < 1) {
        shock.current.scale.setScalar(1 + progress * 2.4);
        shockMaterial.current.opacity = 1 - progress;
      }
    }
  });

  const icon = stateIcons[agent.state];

  return (
    <group
      position={stations[agent.key] as [number, number, number]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[1.15, 1.25, 0.2, 48]} />
        <meshStandardMaterial color={hovered || selected ? "#1e293b" : "#111827"} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.205, 0]}>
        <ringGeometry args={[0.98, 1.12, 64]} />
        <meshBasicMaterial ref={ring} color={color} transparent toneMapped={false} />
      </mesh>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.21, 0]}>
          <ringGeometry args={[1.18, 1.24, 64]} />
          <meshBasicMaterial color="#f8fafc" toneMapped={false} />
        </mesh>
      )}
      <mesh ref={shock} rotation-x={-Math.PI / 2} position={[0, 0.215, 0]} visible={false}>
        <ringGeometry args={[1.0, 1.1, 64]} />
        <meshBasicMaterial ref={shockMaterial} color={color} transparent toneMapped={false} depthWrite={false} />
      </mesh>

      <group ref={body} position={[0, 0.2, 0]}>
        <mesh position={[0, 0.78, 0]} castShadow>
          <capsuleGeometry args={[0.36, 0.55, 8, 24]} />
          <meshStandardMaterial color={profile.color} roughness={0.35} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.92, 0.33]}>
          <boxGeometry args={[0.3, 0.2, 0.04]} />
          <meshStandardMaterial color="#0b1120" emissive={color} emissiveIntensity={0.6} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.47, 0.8, 0.05]} rotation-z={side * 0.18} castShadow>
            <capsuleGeometry args={[0.09, 0.4, 6, 12]} />
            <meshStandardMaterial color={profile.color} roughness={0.4} />
          </mesh>
        ))}
        <group ref={head} position={[0, 1.55, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.34, 32, 32]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.02, 0.27]}>
            <boxGeometry args={[0.46, 0.14, 0.12]} />
            <meshStandardMaterial ref={visor} color="#020617" emissive={color} emissiveIntensity={1.3} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.2, 8]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial ref={antenna} color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
        </group>
      </group>

      <group ref={orbit} position={[0, 1.2, 0]} visible={false}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.75, 0.025, 8, 64]} />
          <meshBasicMaterial color={stateColors.testing} toneMapped={false} />
        </mesh>
        <mesh position={[0.75, 0, 0]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshBasicMaterial color="#f5f3ff" toneMapped={false} />
        </mesh>
      </group>

      <Html position={[0, 2.85, 0]} center distanceFactor={10} zIndexRange={[10, 0]}>
        <button
          type="button"
          className={`agent-label${selected ? " is-selected" : ""}`}
          style={{ "--state": color, "--agent": profile.color } as CSSProperties}
          onClick={onSelect}
        >
          <span className="agent-label__name">{profile.name}</span>
          <span className="agent-label__employee">{agent.employee ?? profile.employee}</span>
          <span className="agent-label__state">
            {icon ? <span className="agent-label__icon">{icon}</span> : <span className="agent-label__dot" />}
            {stateLabels[agent.state]}
          </span>
          {hasPendingApproval && <span className="agent-label__cta">Approval needed</span>}
        </button>
      </Html>
    </group>
  );
}
