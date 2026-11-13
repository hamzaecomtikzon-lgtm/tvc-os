import { BRAND } from "../lib/brand.js";

export const PATHS = {
  shield: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  blocks: <><rect width="7" height="7" x="14" y="3" rx="1" /><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" /></>,
  chart: <><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  play: <><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" /><path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" /><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
  gear: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  menu: <path d="M4 12h16M4 6h16M4 18h16" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  bell: <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
  calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>,
  chev: <path d="m6 9 6 6 6-6" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  wa: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  edit: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>,
  plus: <path d="M5 12h14M12 5v14" />,
  send: <><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></>,
  card: <><rect width="20" height="14" x="2" y="5" rx="2" /><path d="M2 10h20" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  hash: <path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" />,
  chat: <path d="M5 5h14v10H9l-4 4z" />,
  flame: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" />,
  party: <><path d="M4 20l5-14 9 9z" /><path d="M14 4v2M19 9h2M17 6l1.5-1.5" /></>,
  wave: <path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V6a1.5 1.5 0 0 1 3 0v6c0 4-2.5 8-6.5 8S5 17 4 14l-1-3a1.5 1.5 0 0 1 2.7-1.2L7 12" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  plug: <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />,
  server: <><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /><path d="M8 7.5h.01M8 16.5h.01" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  redo: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
};

export function Icon({ name, size }) {
  return (
    <svg className="k-ico" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ href = "#home", className = "k-logo" }) {
  return (
    <a className={className} href={href} aria-label={BRAND + " home"}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#b8336a" />
        <path d="M11 8.5v15" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M21.5 8.5 14.6 16l6.9 7.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="23.6" cy="16" r="2.1" fill="#f4eefa" />
      </svg>
      <b>{BRAND}</b>
    </a>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }} aria-hidden="true">
      <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z" />
      <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.9V7H2.7a10 10 0 0 0 0 9z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7l3.5 2.7C7 7.8 9.3 6 12 6z" />
    </svg>
  );
}

/** Discord-style bot message used in the product previews. */
export function BotMessage({ time, children }) {
  return (
    <div className="k-msg">
      <div className="k-av">G</div>
      <div style={{ minWidth: 0 }}>
        <div className="k-who">Glow Bot <small>APP</small> <time>{time}</time></div>
        {children}
      </div>
    </div>
  );
}
