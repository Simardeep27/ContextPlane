import { navLinks } from '../../shared/nav.ts';
/** Shared page nav. `current` marks the active page with aria-current. */
export function AppNav({ current, className = 'app-nav' }: { current: (typeof navLinks)[number]['href']; className?: string }) {
  return <nav className={className} aria-label="Pages">{navLinks.map(l =>
    <a key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined}>{l.label}</a>)}</nav>;
}
