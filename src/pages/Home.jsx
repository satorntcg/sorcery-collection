import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [cardCount,  setCardCount]  = useState(null)
  const [videoCount, setVideoCount] = useState(null)

  useEffect(() => {
    document.title = 'SatornTCG — Sorcery: Contested Realm Companion'

    async function fetchStats() {
      const [countRes, videoRes] = await Promise.all([
        supabase.from('cards').select('*', { count: 'exact', head: true }),
        supabase.from('youtube_openings').select('*', { count: 'exact', head: true }),
      ])
      if (countRes.count  != null) setCardCount(countRes.count)
      if (videoRes.count  != null) setVideoCount(videoRes.count)
    }

    fetchStats()
  }, [])

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>

      {/* Section 1 — Hero */}
      <section>
        <p style={{
          textTransform: 'uppercase',
          color: 'var(--gold)',
          fontSize: '12px',
          letterSpacing: '0.12em',
          marginBottom: '16px',
        }}>
          Sorcery: Contested Realm
        </p>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(32px, 5vw, 52px)',
          color: 'var(--text-primary)',
          lineHeight: 1.15,
          marginBottom: '16px',
        }}>
          Your Collection Companion
        </h1>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '16px',
          maxWidth: '480px',
          lineHeight: 1.7,
        }}>
          Browse card prices, master the rules, and track your collection. Built for Sorcery players.
        </p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap' }}>
          <Link to="/cards" className="btn btn-primary">
            Card Prices
          </Link>
          <Link to="/rules" className="btn btn-ghost">
            Rules Assistant
          </Link>
        </div>
      </section>

      {/* Section 2 — Stats bar */}
      <section style={{ marginTop: '56px' }}>
        <div className="panel" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          padding: '20px 32px',
          gap: '0',
        }}>
          {[
            { value: cardCount,  label: 'Cards Tracked' },
            { value: videoCount, label: 'Pack Opening Videos' },
            { value: '✓',        label: 'Live TCG Prices' },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: '8px 16px',
                borderRight: i < 2 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{
                color: 'var(--gold)',
                fontSize: '28px',
                fontWeight: 600,
                lineHeight: 1.2,
              }}>
                {stat.value != null ? stat.value : '—'}
              </div>
              <div style={{
                color: 'var(--text-muted)',
                fontSize: '12px',
                marginTop: '4px',
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3 — Feature cards */}
      <section style={{
        marginTop: '56px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px',
      }}>

        {/* Rules Assistant */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚔️</div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            color: 'var(--gold-light)',
            marginBottom: '8px',
          }}>
            Rules Assistant
          </div>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            marginBottom: '16px',
          }}>
            Ask any question about Sorcery rules. Powered by the official rulebook and AI.
          </p>
          <Link to="/rules" style={{
            color: 'var(--gold)',
            fontSize: '13px',
            textDecoration: 'none',
          }}>
            Ask the Assistant →
          </Link>
        </div>

        {/* Card Prices */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>🃏</div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            color: 'var(--gold-light)',
            marginBottom: '8px',
          }}>
            Card Prices
          </div>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            marginBottom: '16px',
          }}>
            Browse all cards with live TCGPlayer market prices and in-stock availability.
          </p>
          <Link to="/cards" style={{
            color: 'var(--gold)',
            fontSize: '13px',
            textDecoration: 'none',
          }}>
            View Card Prices →
          </Link>
        </div>

        {/* Pack Openings */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>📦</div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            color: 'var(--gold-light)',
            marginBottom: '8px',
          }}>
            Pack Openings
          </div>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: 1.65,
            marginBottom: '16px',
          }}>
            Watch pack opening videos and see exactly what cards were pulled, with live TCG values.
          </p>
          <Link to="/videos" style={{
            color: 'var(--gold)',
            fontSize: '13px',
            textDecoration: 'none',
          }}>
            Watch Openings →
          </Link>
        </div>

      </section>

      {/* Contact strip */}
      <section style={{
        marginTop: 56,
        padding: '28px 32px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--gold-light)', marginBottom: 4 }}>
            Questions or looking to buy?
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Get in touch and we'll get back to you as soon as possible.
          </p>
        </div>
        <Link to="/contact" className="btn btn-primary" style={{ flexShrink: 0 }}>
          Contact Us
        </Link>
      </section>

    </div>
  )
}
