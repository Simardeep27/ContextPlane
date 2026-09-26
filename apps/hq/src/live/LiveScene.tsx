import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { MathUtils, Vector3, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";

import type { AgentView } from "../../shared/harness.ts";
import { layoutTeam, legendState, padRadius, statusLabels, type PadLayout, type Vec3 } from "../../shared/live.ts";
import { stateColors } from "../scene/layout.ts";
import { clock } from "../ui/format.ts";

export const statusColor = (status: AgentView["status"]) => stateColors[legendState(status)];
const pulseMs = 1800;

// drei's Html re-targets (and empties) its root when the canvas connects its
// event layer; pin labels to the canvas container so the target never changes.
function Label(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const portal = useMemo(() => ({ current: gl.domElement.parentNode as HTMLElement }), [gl]);
  return <Html portal={portal} {...props} />;
}

interface Props {
  views: AgentView[];
  pulseAt: number | null;
  fresh: ReadonlyMap<string, number>;
  selected: string | null;
  onSelect: (identity: string | null) => void;
  brainNote: string | null;
}

// Company brain / harness optimizer: the crystal every report flows into.
function Brain({ pulseAt, note }: { pulseAt: number | null; note: string | null }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const shock = useRef<Mesh>(null);
  const shockMaterial = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock: c }, delta) => {
    if (!mesh.current || !material.current) return;
    mesh.current.rotation.y += delta * 0.4;
    mesh.current.rotation.x += delta * 0.15;
    const since = pulseAt === null ? Infinity : (performance.now() - pulseAt) / pulseMs;
    const flare = Math.max(0, 1 - since);
    material.current.emissiveIntensity = 0.7 + Math.sin(c.elapsedTime * 1.5) * 0.12 + flare * 2.2;
    mesh.current.scale.setScalar(1 + flare * 0.18);
    if (shock.current && shockMaterial.current) {
      shock.current.visible = since < 1;
      shock.current.scale.setScalar(1 + since * 3);
      shockMaterial.current.opacity = 0.9 * (1 - since);
    }
  });
  return (
    <group>
      <mesh position={[0, 0.05, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.2, 48]} />
        <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh ref={shock} position={[0, 0.08, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[1.05, 1.18, 64]} />
        <meshBasicMaterial ref={shockMaterial} color="#2dd4bf" transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={mesh} position={[0, 1.2, 0]}>
        <icosahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial ref={material} color="#0f766e" emissive="#14b8a6" flatShading />
      </mesh>
      <Label position={[0, 2.35, 0]} center distanceFactor={12} zIndexRange={[5, 0]}>
        <div className="brain-label">
          <strong>Company brain</strong>
          <span>harness optimizer</span>
          {note && <em>{note}</em>}
        </div>
      </Label>
    </group>
  );
}

function Pad({ pad }: { pad: PadLayout }) {
  const [x, , z] = pad.center;
  const counts = pad.agents.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.view.status]: (acc[a.view.status] ?? 0) + 1 }), {});
  const radius = Math.max(padRadius(pad.agents.length), 1.1);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius + 0.08, 0.12, 64]} />
        <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.125, 0]}>
        <ringGeometry args={[radius - 0.08, radius, 96]} />
        <meshBasicMaterial color="#1d4ed8" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <Label position={[0, 0.2, radius + 0.35]} center distanceFactor={12} zIndexRange={[4, 0]}>
        <div className="pad-label">
          <strong>{pad.label}</strong>
          <span>{pad.agents.length === 0 ? "no agents reporting" : `${pad.agents.length} ${pad.agents.length === 1 ? "agent" : "agents"}`}
            {counts.blocked ? ` · ${counts.blocked} blocked` : ""}</span>
        </div>
      </Label>
    </group>
  );
}

function Robot({ view, position, freshAt, selected, onSelect }: { view: AgentView; position: Vec3; freshAt: number | undefined; selected: boolean; onSelect: () => void }) {
  const color = statusColor(view.status);
  const [hovered, setHovered] = useState(false);
  const body = useRef<Group>(null);
  const ring = useRef<MeshBasicMaterial>(null);
  const visor = useRef<MeshStandardMaterial>(null);
  const shock = useRef<Mesh>(null);
  const shockMaterial = useRef<MeshBasicMaterial>(null);
  const phase = useMemo(() => [...view.identity].reduce((h, c) => h + c.charCodeAt(0), 0) % 7, [view.identity]);

  useFrame(({ clock: c }, delta) => {
    if (!body.current) return;
    const t = c.elapsedTime + phase;
    const s = view.status;
    body.current.position.y = 0.12 + (s === "working" ? Math.abs(Math.sin(t * 7)) * 0.05 : Math.sin(t * 1.2) * 0.02);
    body.current.rotation.x = MathUtils.damp(body.current.rotation.x, s === "blocked" ? 0.3 : 0, 4, delta);
    if (ring.current) ring.current.opacity = s === "blocked" ? 0.55 + Math.sin(t * 5) * 0.45 : s === "idle" ? 0.35 : 0.9;
    if (visor.current) visor.current.emissiveIntensity = s === "working" ? 1.4 + Math.sin(t * 18) * 0.5 : s === "idle" ? 0.4 : 1.3;
    if (shock.current && shockMaterial.current) {
      const p = freshAt === undefined ? Infinity : (performance.now() - freshAt) / 1400;
      shock.current.visible = p < 1;
      if (p < 1) { shock.current.scale.setScalar(1 + p * 2); shockMaterial.current.opacity = 1 - p; }
    }
  });

  return (
    <group
      position={position as [number, number, number]}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; }}
    >
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.13, 0]}>
        <ringGeometry args={[0.3, 0.38, 40]} />
        <meshBasicMaterial ref={ring} color={color} transparent toneMapped={false} />
      </mesh>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.135, 0]}>
          <ringGeometry args={[0.42, 0.46, 40]} />
          <meshBasicMaterial color="#f8fafc" toneMapped={false} />
        </mesh>
      )}
      <mesh ref={shock} rotation-x={-Math.PI / 2} position={[0, 0.14, 0]} visible={false}>
        <ringGeometry args={[0.32, 0.38, 40]} />
        <meshBasicMaterial ref={shockMaterial} color={color} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <group ref={body} scale={0.5}>
        <mesh position={[0, 0.78, 0]} castShadow>
          <capsuleGeometry args={[0.36, 0.55, 8, 20]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.15} emissive={color} emissiveIntensity={view.status === "idle" ? 0.05 : 0.25} />
        </mesh>
        <group position={[0, 1.55, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.34, 24, 24]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.02, 0.27]}>
            <boxGeometry args={[0.46, 0.14, 0.12]} />
            <meshStandardMaterial ref={visor} color="#020617" emissive={color} emissiveIntensity={1.3} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <Label position={[0, 1.45, 0]} center distanceFactor={9} zIndexRange={hovered || selected ? [30, 20] : [10, 0]}>
        <button
          type="button"
          className={`live-label${selected ? " is-selected" : ""}`}
          style={{ "--state": color } as CSSProperties}
          onClick={onSelect}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <span className="agent-label__dot" aria-label={statusLabels[view.status]} />
          <span className="live-label__name mono">{view.suffix}</span>
          {hovered && !selected && (
            <span className="live-label__card">
              <span className="live-label__head"><span className="mono">{view.identity}</span> · <span style={{ color: color }}>{statusLabels[view.status]}</span></span>
              <span><b>Task</b> {view.task ?? "not reported"}</span>
              <span><b>Summary</b> {view.summary ?? "not reported"}</span>
              <span><b>Last update</b> {view.updatedAt ? clock(view.updatedAt) : "not reported"}</span>
            </span>
          )}
        </button>
      </Label>
    </group>
  );
}

// A report travelling from the robot into the company brain.
function ReportPacket({ from, startedAt, color }: { from: Vec3; startedAt: number; color: string }) {
  const mesh = useRef<Mesh>(null);
  const start = useMemo(() => new Vector3(from[0], 0.9, from[2]), [from]);
  const end = useMemo(() => new Vector3(0, 1.2, 0), []);
  useFrame(() => {
    if (!mesh.current) return;
    const t = (performance.now() - startedAt) / 1300;
    mesh.current.visible = t >= 0 && t <= 1;
    if (mesh.current.visible) mesh.current.position.lerpVectors(start, end, t).setY(0.9 + Math.sin(t * Math.PI) * 1.4);
  });
  return (
    <mesh ref={mesh} visible={false}>
      <sphereGeometry args={[0.1, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

export function LiveScene({ views, pulseAt, fresh, selected, onSelect, brainNote }: Props) {
  const pads = useMemo(() => layoutTeam(views), [views]);
  const now = performance.now();
  return (
    <Canvas
      shadows
      camera={{ position: [0, 12.5, 14.5], fov: 44 }}
      onPointerMissed={(event) => {
        if ((event.target as Element | null)?.closest?.(".live-label")) return;
        onSelect(null);
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#060913"]} />
      <fog attach="fog" args={["#060913", 22, 42]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 12, 6]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 4, 0]} intensity={14} color="#2dd4bf" distance={14} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color="#0a0f1c" roughness={0.9} />
      </mesh>
      <Grid position={[0, 0.01, 0]} args={[36, 36]} cellSize={0.6} cellThickness={0.5} cellColor="#13243a"
        sectionSize={3} sectionThickness={1} sectionColor="#1d4ed8" fadeDistance={30} fadeStrength={1.4} />

      <Brain pulseAt={pulseAt} note={brainNote} />
      {pads.map((pad) => (
        <group key={pad.person}>
          <Line points={[[pad.center[0] * 0.25, 0.08, pad.center[2] * 0.25], [pad.center[0] * 0.62, 0.08, pad.center[2] * 0.62]]}
            color="#1e3a8a" lineWidth={1.2} transparent opacity={0.6} />
          <Pad pad={pad} />
          {pad.agents.map(({ view, position }) => {
            const at = fresh.get(view.identity);
            return (
              <group key={view.identity}>
                <Robot view={view} position={position} freshAt={at !== undefined && now - at < 2000 ? at : undefined}
                  selected={selected === view.identity} onSelect={() => onSelect(view.identity)} />
                {at !== undefined && now - at < 2000 && <ReportPacket from={position} startedAt={at} color={statusColor(view.status)} />}
              </group>
            );
          })}
        </group>
      ))}
      <OrbitControls enablePan={false} minDistance={8} maxDistance={30} maxPolarAngle={1.25} target={[0, 0.6, 0]} />
    </Canvas>
  );
}
