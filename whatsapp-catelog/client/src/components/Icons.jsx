/**
 * Inline SVG icons, stroke-based so they inherit currentColor and stay crisp
 * in both themes. Inlined rather than pulled from a package: the app uses ~30
 * icons and a dependency would cost more than it saves.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Icon({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...rest}>
      {children}
    </svg>
  );
}

export const IconDashboard = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const IconWhatsapp = (p) => (
  <Icon {...p}>
    <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5Z" />
    <path d="M8.6 9.2c.3 2.6 3.6 5.9 6.2 6.2l1.1-1.4-1.9-1.1-1 .8a6.6 6.6 0 0 1-2.7-2.7l.8-1L10 8.1 8.6 9.2Z" />
  </Icon>
);

export const IconPlug = (p) => (
  <Icon {...p}>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
    <path d="M12 17v5" />
  </Icon>
);

export const IconInbox = (p) => (
  <Icon {...p}>
    <path d="M3 12h5l1.5 3h5L16 12h5" />
    <path d="M4.6 5.3 3 12v6a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18v-6l-1.6-6.7A1.5 1.5 0 0 0 18 4H6a1.5 1.5 0 0 0-1.4 1.3Z" />
  </Icon>
);

export const IconCatalog = (p) => (
  <Icon {...p}>
    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10v16H5.5A2.5 2.5 0 0 1 3 17.5v-11Z" />
    <path d="M21 6.5A2.5 2.5 0 0 0 18.5 4H14v16h4.5a2.5 2.5 0 0 0 2.5-2.5v-11Z" />
  </Icon>
);

export const IconBox = (p) => (
  <Icon {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Icon>
);

export const IconTag = (p) => (
  <Icon {...p}>
    <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6l8 8a1.4 1.4 0 0 1 0 2.4Z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </Icon>
);

export const IconLayers = (p) => (
  <Icon {...p}>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
  </Icon>
);

export const IconSync = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
    <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
    <path d="M21 4v4h-4M3 20v-4h4" />
  </Icon>
);

export const IconBolt = (p) => (
  <Icon {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </Icon>
);

export const IconSettings = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Icon>
);

export const IconShield = (p) => (
  <Icon {...p}>
    <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconSearch = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const IconPlus = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconEdit = (p) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </Icon>
);

export const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6" />
  </Icon>
);

export const IconSend = (p) => (
  <Icon {...p}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
  </Icon>
);

export const IconCheck = (p) => (
  <Icon {...p}>
    <path d="m20 6-11 11-5-5" />
  </Icon>
);

export const IconCheckCircle = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Icon>
);

export const IconX = (p) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const IconAlert = (p) => (
  <Icon {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

export const IconInfo = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Icon>
);

export const IconRefresh = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Icon>
);

export const IconUpload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 9 5-5 5 5M12 4v12" />
  </Icon>
);

export const IconImage = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </Icon>
);

export const IconVideo = (p) => (
  <Icon {...p}>
    <rect x="2" y="5" width="14" height="14" rx="2" />
    <path d="m22 8-6 4 6 4V8Z" />
  </Icon>
);

export const IconChevronLeft = (p) => (
  <Icon {...p}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const IconChevronRight = (p) => (
  <Icon {...p}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const IconChevronDown = (p) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const IconMenu = (p) => (
  <Icon {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Icon>
);

export const IconLogout = (p) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Icon>
);

export const IconMoon = (p) => (
  <Icon {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
);

export const IconSun = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const IconClock = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const IconExternal = (p) => (
  <Icon {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </Icon>
);

export const IconLock = (p) => (
  <Icon {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const IconUser = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export const IconList = (p) => (
  <Icon {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);

export const IconFilter = (p) => (
  <Icon {...p}>
    <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />
  </Icon>
);

export const IconGlobe = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
  </Icon>
);
