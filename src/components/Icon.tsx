import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z" />,
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="0.6" fill="currentColor" />
      <circle cx="4" cy="12" r="0.6" fill="currentColor" />
      <circle cx="4" cy="18" r="0.6" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  gauge: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l3.5-4.5" />
    </>
  ),
  bars: <path d="M5 20v-8M12 20V6M19 20v-11" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m14 6-6 6 6 6" />,
  chevronRight: <path d="m10 6 6 6-6 6" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M15.5 12.5H21" />
    </>
  ),
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19Z" />,
  backspace: (
    <>
      <path d="M8 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H8l-5-7Z" />
      <path d="m11 9.5 5 5M16 9.5l-5 5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37 1 .608 2.296.07 2.572-1.065Z" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 19.5h16" />,
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="M8 5.5v13l10-6.5Z" />,
  coffee: (
    <>
      <path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" />
      <path d="M16 9h2a2 2 0 0 1 0 4h-2" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
      <path d="M3 4h2l2.4 11h10.2L20 8H6" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="4" width="14" height="13" rx="2.5" />
      <path d="M5 11h14" />
      <circle cx="9" cy="14.5" r="1.1" />
      <circle cx="15" cy="14.5" r="1.1" />
      <path d="M8 20l-1 1.5M16 20l1 1.5" />
    </>
  ),
  fork: (
    <>
      <path d="M8 4v5a2.5 2.5 0 0 0 5 0V4" />
      <path d="M10.5 4v16" />
      <path d="M17 4c-1.4 1.6-2 3.6-2 6h2.5v10" />
    </>
  ),
  film: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 5v14M16 5v14M4 10h4M4 14h4M16 10h4M16 14h4" />
    </>
  ),
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />,
  bag: (
    <>
      <path d="M6 8h12l-1 12H7Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  homecat: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-4M4 13a8 8 0 0 0 14 4" />
      <path d="M20 4v4h-4M4 20v-4h4" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.6 2.2 3.9 4.9 3.9 8S14.6 17.8 12 20c-2.6-2.2-3.9-4.9-3.9-8S9.4 6.2 12 4Z" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12V19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z" />
      <path d="M9 8h6M9 11.5h6" />
    </>
  ),
  arrowDown: <path d="M12 5v12m0 0-4.5-4.5M12 17l4.5-4.5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.2" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  arrowUp: <path d="M12 19V7m0 0-4.5 4.5M12 7l4.5 4.5" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  )
}

export function Icon({
  name,
  size = 22,
  strokeWidth = 1.8
}: {
  name: string
  size?: number
  strokeWidth?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.dots}
    </svg>
  )
}
