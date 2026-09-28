import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  IconBolt,
  IconBox,
  IconCatalog,
  IconDashboard,
  IconInbox,
  IconLayers,
  IconLock,
  IconMenu,
  IconMoon,
  IconPlug,
  IconShield,
  IconSun,
  IconSettings,
  IconSync,
  IconTag,
  IconWhatsapp,
  IconX,
} from './Icons';

const NAV = [
  {
    items: [{ to: '/', label: 'Dashboard', icon: IconDashboard, end: true }],
  },
  {
    label: 'WhatsApp',
    items: [
      { to: '/whatsapp/setup', label: 'Connection', icon: IconPlug },
      { to: '/whatsapp/settings', label: 'Settings', icon: IconSettings },
      { to: '/whatsapp/inbox', label: 'Inbox', icon: IconInbox },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/catalog', label: 'Overview', icon: IconCatalog, end: true },
      { to: '/catalog/products', label: 'Products', icon: IconBox },
      { to: '/catalog/categories', label: 'Categories', icon: IconTag },
      { to: '/catalog/collections', label: 'Collections', icon: IconLayers },
      { to: '/catalog/sync', label: 'Sync', icon: IconSync },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/automation', label: 'Automation', icon: IconBolt },
      { to: '/audit', label: 'Audit log', icon: IconShield },
      { to: '/settings/meta', label: 'Meta credentials', icon: IconLock },
    ],
  },
];

/**
 * Title for the current route.
 *
 * Derived from NAV so the sidebar and the topbar can never disagree, with the
 * few routes that have no sidebar entry (the product editor) listed explicitly.
 */
const EXTRA_TITLES = [
  { match: /^\/catalog\/products\/create$/, label: 'Add product', section: 'Catalog' },
  { match: /^\/catalog\/products\/[^/]+\/edit$/, label: 'Edit product', section: 'Catalog' },
];

function resolvePageTitle(pathname) {
  const extra = EXTRA_TITLES.find((entry) => entry.match.test(pathname));
  if (extra) return extra;

  for (const section of NAV) {
    for (const item of section.items) {
      const isMatch = item.end ? pathname === item.to : pathname.startsWith(item.to);
      if (isMatch) return { label: item.label, section: section.label };
    }
  }
  return { label: '', section: null };
}

/** Connection pill in the sidebar footer - the app's honest health light. */
function ConnectionPill({ status }) {
  if (!status) {
    return (
      <span className="conn-pill">
        <span className="dot" />
        Checking…
      </span>
    );
  }

  const connected = status.connectedAccounts > 0;
  const partial = connected && (!status.catalogs || !status.webhookSubscribed);

  const tone = !connected ? 'conn-bad' : partial ? 'conn-warn' : 'conn-ok';
  const label = !connected
    ? 'Not connected'
    : !status.catalogs
      ? 'No catalog linked'
      : !status.webhookSubscribed
        ? 'Webhook inactive'
        : 'WhatsApp connected';

  return (
    <NavLink to="/whatsapp/setup" className="conn-pill">
      <span className={`dot ${tone}`} />
      <span className="grow truncate">{label}</span>
    </NavLink>
  );
}

/** Theme toggle - the only thing that used to live in the account menu. */
function ThemeToggle() {
  const { theme, toggleTheme } = useApp();

  return (
    <button
      className="btn btn-ghost btn-sm btn-icon"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}

export default function Layout() {
  const { status } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const title = resolvePageTitle(location.pathname);

  // Navigating on a phone should dismiss the drawer.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell">
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-logo">
            <IconWhatsapp size={18} />
          </span>
          <div className="grow">
            <div className="sidebar-brand-text">Catalog Manager</div>
            <div className="sidebar-brand-sub">WhatsApp Business</div>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-icon hide-lg"
            onClick={() => setNavOpen(false)}
            style={{ color: 'inherit', display: navOpen ? 'inline-flex' : 'none' }}
            aria-label="Close menu"
          >
            <IconX size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((section, index) => (
            <div className="nav-section" key={section.label || index}>
              {section.label && <div className="nav-section-label">{section.label}</div>}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <item.icon size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ConnectionPill status={status} />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <IconMenu size={18} />
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="topbar-title truncate">{title.label}</div>
            {title.section && <div className="topbar-sub">{title.section}</div>}
          </div>
          <ThemeToggle />
        </header>

        <Outlet />
      </div>
    </div>
  );
}
