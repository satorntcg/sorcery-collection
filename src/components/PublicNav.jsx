import { NavLink, Link } from 'react-router-dom'

export default function PublicNav({ session }) {
  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      height: '56px',
      background: 'var(--bg-deep)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
    }}>
      {/* Left: Logo */}
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
        <img
          src="/favicon.png"
          alt="SatornTCG"
          width={28}
          height={28}
          style={{ borderRadius: '6px', display: 'block' }}
        />
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: '15px',
          color: 'var(--gold-light)',
          letterSpacing: '0.04em',
        }}>
          SatornTCG
        </span>
      </Link>

      {/* Middle: Nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <NavLink
          to="/cards"
          style={({ isActive }) => ({
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            textDecoration: 'none',
            color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(201,168,76,0.08)' : 'transparent',
            transition: 'all var(--transition)',
          })}
        >
          Cards
        </NavLink>
        <NavLink
          to="/rules"
          style={({ isActive }) => ({
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            textDecoration: 'none',
            color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(201,168,76,0.08)' : 'transparent',
            transition: 'all var(--transition)',
          })}
        >
          Rules Assistant
        </NavLink>
        <NavLink
          to="/contact"
          style={({ isActive }) => ({
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            textDecoration: 'none',
            color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(201,168,76,0.08)' : 'transparent',
            transition: 'all var(--transition)',
          })}
        >
          Contact
        </NavLink>
      </div>

      {/* Right: Auth action */}
      <div>
        {session ? (
          <Link to="/dashboard" className="btn btn-primary btn-sm">
            Dashboard →
          </Link>
        ) : (
          <Link to="/login" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  )
}
