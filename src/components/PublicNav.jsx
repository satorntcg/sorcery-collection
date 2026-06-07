import { useState, useEffect } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'

const navLinkStyle = (isActive) => ({
  display: 'block',
  padding: '6px 14px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '13px',
  textDecoration: 'none',
  color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
  background: isActive ? 'rgba(201,168,76,0.08)' : 'transparent',
  transition: 'all var(--transition)',
})

export default function PublicNav({ session }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  const location = useLocation()

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const links = [
    { to: '/cards',   label: 'Card Catalogue' },
    { to: '/videos',  label: 'Pack Openings' },
    { to: '/rules',   label: 'Rules Assistant' },
    { to: '/contact', label: 'Contact' },
  ]

  return (
    <>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        height: '56px',
        background: 'var(--bg-deep)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px',
      }}>
        {/* Logo */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <img src="/favicon.png" alt="SatornTCG" width={28} height={28} style={{ borderRadius: '6px', display: 'block' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', letterSpacing: '0.04em' }}>
            SatornTCG
          </span>
        </Link>

        {/* Desktop links */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {links.map(l => (
              <NavLink key={l.to} to={l.to} style={({ isActive }) => navLinkStyle(isActive)}>
                {l.label}
              </NavLink>
            ))}
          </div>
        )}

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isMobile && (
            session
              ? <Link to="/dashboard" className="btn btn-primary btn-sm">Dashboard →</Link>
              : <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          )}
          {isMobile && (
            <button
              onClick={() => setMenuOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--text-secondary)' }}
              aria-label="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen
                  ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                  : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
                }
              </svg>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile dropdown */}
      {isMobile && menuOpen && (
        <div style={{
          position: 'fixed', top: 56, left: 0, right: 0, zIndex: 99,
          background: 'var(--bg-deep)',
          borderBottom: '1px solid var(--border)',
          padding: '8px 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} style={({ isActive }) => navLinkStyle(isActive)}>
              {l.label}
            </NavLink>
          ))}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            {session
              ? <Link to="/dashboard" className="btn btn-primary btn-sm" style={{ display: 'block', textAlign: 'center' }}>Dashboard →</Link>
              : <Link to="/login" className="btn btn-ghost btn-sm" style={{ display: 'block', textAlign: 'center' }}>Sign in</Link>
            }
          </div>
        </div>
      )}
    </>
  )
}
