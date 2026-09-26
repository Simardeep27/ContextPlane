// Company Harness brand: one brain-in-a-hexagon mark shared by every page (and public/favicon.svg).
const brainPaths = [
  "M9.5 3.5a2.5 2.5 0 0 0-2.45 2A2.75 2.75 0 0 0 4.5 8.25c0 .5.13.97.36 1.38A3 3 0 0 0 4 15.5a3 3 0 0 0 2.5 2.96A2.75 2.75 0 0 0 9.25 20.5c.97 0 1.82-.5 2.25-1.25V4.9A2.5 2.5 0 0 0 9.5 3.5Z",
  "M14.5 3.5a2.5 2.5 0 0 1 2.45 2 2.75 2.75 0 0 1 2.55 2.75c0 .5-.13.97-.36 1.38A3 3 0 0 1 20 15.5a3 3 0 0 1-2.5 2.96 2.75 2.75 0 0 1-2.75 2.04c-.97 0-1.82-.5-2.25-1.25V4.9a2.5 2.5 0 0 1 2-1.4Z",
  "M7.5 9.5c1 0 1.75.6 2 1.5M16.5 9.5c-1 0-1.75.6-2 1.5M7 14.5c1.2 0 2 .8 2.3 1.8M17 14.5c-1.2 0-2 .8-2.3 1.8",
];

/** Company brain: inline SVG, deliberately not a person/agent avatar. */
export function BrainIcon({ size = 22, className = "brain-icon", label = "Company brain" }: { size?: number; className?: string; label?: string | null }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label ?? undefined} aria-hidden={label ? undefined : true}>
      {brainPaths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <path d="M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9Z" fill="#0b1f1c" stroke="#2dd4bf" strokeWidth="1.8" strokeLinejoin="round" />
      <g transform="translate(6.4 6.4) scale(0.8)" fill="none" stroke="#99f6e4" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {brainPaths.map((d) => <path key={d} d={d} />)}
      </g>
    </svg>
  );
}
