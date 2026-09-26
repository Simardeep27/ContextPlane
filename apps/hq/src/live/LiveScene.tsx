import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { MathUtils, Vector3, type Group, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";

import type { AgentView } from "../../shared/harness.ts";
import { layoutTeam, legendState, padRadius, padSummary, statusLabels, type PadLayout, type Vec3 } from "../../shared/live.ts";
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
  still: boolean;
  shift: number;
  onOpenCompany: () => void;
  company: ReactNode;
}

// Eases the camera and orbit target sideways so the open command-center panel never covers a pad.
function CameraRig({ shift, still }: { shift: number; still: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as { target: Vector3; update: () => void } | null;
  useFrame((_, delta) => {
    if (!controls) return;
    const goal = -shift;
    const x = still ? goal : MathUtils.damp(controls.target.x, goal, 3, delta);
    const dx = x - controls.target.x;
    if (Math.abs(dx) < 1e-4) return;
    controls.target.x = x;
    camera.position.x += dx;
    controls.update();
  });
  return null;
}

// Company agent / harness optimizer: the glowing orb every report flows into.
function CompanyAgent({ pulseAt, still, onOpen, children }: { pulseAt: number | null; still: boolean; onOpen: () => void; children: ReactNode }) {
  const core = useRef<Mesh>(null);
  const coreMaterial = useRef<MeshStandardMaterial>(null);
  const shell = useRef<Mesh>(null);
  const haloA = useRef<Mesh>(null);
  const haloB = useRef<Mesh>(null);
  const shock = useRef<Mesh>(null);
  const shockMaterial = useRef<MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);
  useFrame(({ clock: c }, delta) => {
    const since = pulseAt === null ? Infinity : (performance.now() - pulseAt) / pulseMs;
    const flare = Math.max(0, 1 - since);
    if (coreMaterial.current) coreMaterial.current.emissiveIntensity = 1.1 + (still ? 0 : Math.sin(c.elapsedTime * 1.5) * 0.2) + flare * 2 + (hovered ? 0.4 : 0);
    if (core.current) core.current.scale.setScalar(1 + (still ? 0 : flare * 0.12));
    if (!still) {
      if (shell.current) { shell.current.rotation.y += delta * 0.25; shell.current.rotation.x += delta * 0.1; }
      if (haloA.current) haloA.current.rotation.z += delta * 0.5;
      if (haloB.current) haloB.current.rotation.z -= delta * 0.35;
    }
    if (shock.current && shockMaterial.current) {
      shock.current.visible = !still && since < 1;
      shock.current.scale.setScalar(1 + since * 3);
      shockMaterial.current.opacity = 0.9 * (1 - since);
    }
  });
  const hover = (on: boolean) => { setHovered(on); document.body.style.cursor = on ? "pointer" : ""; };
  return (
    <group onClick={(e) => { e.stopPropagation(); onOpen(); }} onPointerOver={(e) => { e.stopPropagation(); hover(true); }} onPointerOut={() => hover(false)}>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[1.6, 1.75, 0.12, 64]} />
        <meshStandardMaterial color="#0b1f1c" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.125, 0]}>
        <ringGeometry args={[1.48, 1.6, 96]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <mesh ref={shock} position={[0, 0.14, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[1.5, 1.65, 64]} />
        <meshBasicMaterial ref={shockMaterial} color="#2dd4bf" transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.12, 0.35, 1.3, 24]} />
        <meshStandardMaterial color="#134e4a" emissive="#0f766e" emissiveIntensity={0.5} />
      </mesh>
      <group position={[0, 2.05, 0]}>
        <mesh ref={core}>
          <sphereGeometry args={[0.72, 48, 48]} />
          <meshStandardMaterial ref={coreMaterial} color="#115e59" emissive="#2dd4bf" roughness={0.2} metalness={0.1} toneMapped={false} />
        </mesh>
        <mesh ref={shell}>
          <icosahedronGeometry args={[1.0, 1]} />
          <meshBasicMaterial color="#99f6e4" wireframe transparent opacity={0.28} toneMapped={false} />
        </mesh>
        <mesh ref={haloA} rotation-x={Math.PI / 2.3}>
          <torusGeometry args={[1.25, 0.025, 12, 96]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <mesh ref={haloB} rotation-x={Math.PI / 1.7} rotation-y={0.6}>
          <torusGeometry args={[1.4, 0.018, 12, 96]} />
          <meshBasicMaterial color="#a78bfa" transparent opacity={0.55} toneMapped={false} />
        </mesh>
      </group>
      <Label position={[0, 3.55, 0]} center distanceFactor={11} zIndexRange={[40, 30]}>{children}</Label>
    </group>
  );
}

// Faint beam from the company agent to a person's pad; brightens when that pad reports.
function Beam({ to, pulseAt, still }: { to: Vec3; pulseAt: number | undefined; still: boolean }) {
  const line = useRef<{ material: { opacity: number; linewidth: number } } | null>(null);
  const points = useMemo(() => [[to[0] * 0.3, 0.12, to[2] * 0.3], [to[0] * 0.72, 0.12, to[2] * 0.72]] as [number, number, number][], [to]);
  useFrame(({ clock: c }) => {
    if (!line.current) return;
    const since = pulseAt === undefined ? Infinity : (performance.now() - pulseAt) / pulseMs;
    const flare = Math.max(0, 1 - since);
    line.current.material.opacity = 0.28 + (still ? 0 : Math.sin(c.elapsedTime * 1.2 + to[0]) * 0.06) + flare * 0.7;
    line.current.material.linewidth = 1.4 + flare * 2.6;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Line ref={line as any} points={points} color="#2dd4bf" lineWidth={1.4} transparent opacity={0.3} toneMapped={false} />;
}

function Pad({ pad }: { pad: PadLayout }) {
  const [x, , z] = pad.center;
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
      <Label position={[0, 0.2, radius + 0.45]} center distanceFactor={10} zIndexRange={[4, 0]}>
        <div className="pad-label">
          <strong>{pad.label}</strong>
          <span>{padSummary(pad.agents.map((a) => a.view))}</span>
        </div>
      </Label>
    </group>
  );
}

function Robot({ view, position, freshAt, selected, onSelect, still }: { view: AgentView; position: Vec3; freshAt: number | undefined; selected: boolean; onSelect: () => void; still: boolean }) {
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
    const t = still ? phase : c.elapsedTime + phase;
    const s = view.status;
    body.current.position.y = 0.12 + (s === "working" ? Math.abs(Math.sin(t * 7)) * 0.05 : Math.sin(t * 1.2) * 0.02);
    body.current.rotation.x = MathUtils.damp(body.current.rotation.x, s === "blocked" ? 0.3 : 0, 4, delta);
    if (ring.current) ring.current.opacity = s === "blocked" ? 0.55 + Math.sin(t * 5) * 0.45 : s === "idle" ? 0.35 : 0.9;
    if (visor.current) visor.current.emissiveIntensity = s === "working" ? 1.4 + Math.sin(t * 18) * 0.5 : s === "idle" ? 0.4 : 1.3;
    if (shock.current && shockMaterial.current) {
      const p = freshAt === undefined ? Infinity : (performance.now() - freshAt) / 1400;
      shock.current.visible = !still && p < 1;
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
      <Label position={[0, 1.45, 0]} center distanceFactor={8} zIndexRange={hovered || selected ? [30, 20] : [10, 0]}>
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
              {view.files.length > 0 && <span><b>Files</b> <span className="mono">{view.files.slice(0, 6).join(", ")}</span></span>}
              <span><b>Last update</b> {view.updatedAt ? clock(view.updatedAt) : "not reported"}{view.idleMinutes !== null ? ` · ${view.idleMinutes}m ago` : ""}</span>
            </span>
          )}
        </button>
      </Label>
    </group>
  );
}

// A report travelling from the robot into the company brain.
function ReportPacket({ from, startedAt, color }: { from: Vec3; startedAt: number; color: string }) {
  // Packets are skipped entirely under reduced motion (see LiveScene).
  const mesh = useRef<Mesh>(null);
  const start = useMemo(() => new Vector3(from[0], 0.9, from[2]), [from]);
  const end = useMemo(() => new Vector3(0, 2.05, 0), []);
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

export function LiveScene({ views, pulseAt, fresh, selected, onSelect, still, shift, onOpenCompany, company }: Props) {
  const pads = useMemo(() => layoutTeam(views), [views]);
  const now = performance.now();
  return (
    <Canvas
      shadows
      camera={{ position: [0, 12.5, 14.5], fov: 44 }}
      onPointerMissed={(event) => {
        if ((event.target as Element | null)?.closest?.(".live-label, .company-label")) return;
        onSelect(null);
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#060913"]} />
      <fog attach="fog" args={["#060913", 22, 42]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 12, 6]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 3, 0]} intensity={22} color="#2dd4bf" distance={16} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color="#0a0f1c" roughness={0.9} />
      </mesh>
      <Grid position={[0, 0.01, 0]} args={[36, 36]} cellSize={0.6} cellThickness={0.5} cellColor="#13243a"
        sectionSize={3} sectionThickness={1} sectionColor="#1d4ed8" fadeDistance={30} fadeStrength={1.4} />

      <CompanyAgent pulseAt={pulseAt} still={still} onOpen={onOpenCompany}>{company}</CompanyAgent>
      {pads.map((pad) => (
        <group key={pad.person}>
          <Beam to={pad.center} still={still} pulseAt={pad.agents.reduce<number | undefined>((m, a) => {
            const at = fresh.get(a.view.identity);
            return at === undefined ? m : Math.max(m ?? 0, at);
          }, undefined)} />
          <Pad pad={pad} />
          {pad.agents.map(({ view, position }) => {
            const at = fresh.get(view.identity);
            return (
              <group key={view.identity}>
                <Robot view={view} position={position} freshAt={at !== undefined && now - at < 2000 ? at : undefined}
                  selected={selected === view.identity} onSelect={() => onSelect(view.identity)} still={still} />
                {!still && at !== undefined && now - at < 2000 && <ReportPacket from={position} startedAt={at} color={statusColor(view.status)} />}
              </group>
            );
          })}
        </group>
      ))}
      <OrbitControls makeDefault enablePan={false} minDistance={8} maxDistance={30} maxPolarAngle={1.25} target={[0, 0.6, 0]} />
      <CameraRig shift={shift} still={still} />
    </Canvas>
  );
}
