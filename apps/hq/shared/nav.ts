/** Canonical HQ page order; every page header renders exactly this list. */
export const navLinks = [
  { href: '/index.html', label: 'Live HQ' },
  { href: '/team.html', label: 'Team' },
  { href: '/graph.html', label: 'Dependencies' },
  { href: '/verified.html', label: 'Verified run' },
  { href: '/architecture.html', label: 'Architecture' },
  { href: '/slides/index.html', label: 'Slides' },
] as const;
