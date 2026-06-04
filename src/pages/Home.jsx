import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [heroCards, setHeroCards] = useState([])
  const [shorts,    setShorts]    = useState([])

  useEffect(() => {
    document.title = 'SatornTCG — Sorcery: Contested Realm Companion'

    async function fetchStats() {
      const [heroRes, shortsRes] = await Promise.all([
        supabase
          .from('v_inventory_dashboard')
          .select('id, name, rarity, image_url, tcgplayer_id')
          .in('rarity', ['unique', 'elite'])
          .not('tcgplayer_id', 'is', null)
          .order('tcgplayer_market', { ascending: false })
          .limit(5),
        supabase
          .from('youtube_openings')
          .select('id, title, shorts_url, filmed_at')
          .not('shorts_url', 'is', null)
          .order('filmed_at', { ascending: false })
          .limit(4),
      ])
      setHeroCards(heroRes.data ?? [])
      setShorts(shortsRes.data ?? [])
    }

    fetchStats()
  }, [])

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '16px 24px' }}>

      {/* Section 1 — Hero */}
      <section style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>

        {/* Left: text */}
        <div style={{ flex: '1 1 300px' }}>
          <p style={{
            textTransform: 'uppercase',
            color: 'var(--gold)',
            fontSize: '12px',
            letterSpacing: '0.12em',
            marginBottom: '8px',
          }}>
            Sorcery: Contested Realm
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 5vw, 52px)',
            color: 'var(--text-primary)',
            lineHeight: 1.15,
            marginBottom: '10px',
          }}>
            Track. Price. Sell.
          </h1>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '16px',
            lineHeight: 1.6,
          }}>
            Live TCGPlayer prices, eBay sales data, and pack opening stats — all in one place. Built for Sorcery: Contested Realm players.
          </p>
        </div>

        {/* Right: card fan */}
        {heroCards.length > 0 && (
          <div style={{ flex: '0 0 auto', position: 'relative', height: 360, width: 380 }}>
            {heroCards.slice(0, 5).map((card, i) => {
              const total   = Math.min(heroCards.length, 5)
              const mid     = (total - 1) / 2
              const angle   = (i - mid) * 12
              const xOffset = (i - mid) * 32
              const imgSrc  = card.image_url || `https://product-images.tcgplayer.com/fit-in/400x558/${card.tcgplayer_id}.jpg`
              return (
                <Link
                  key={card.id}
                  to={`/cards/${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/${card.id}`}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: `translate(calc(-50% + ${xOffset}px), -50%) rotate(${angle}deg)`,
                    transformOrigin: 'bottom center',
                    zIndex: i === Math.floor(mid) ? 5 : 4 - Math.abs(i - Math.floor(mid)),
                    transition: 'transform 0.2s, z-index 0s',
                    display: 'block',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = `translate(calc(-50% + ${xOffset}px), calc(-50% - 16px)) rotate(${angle}deg) scale(1.07)`; e.currentTarget.style.zIndex = 10 }}
                  onMouseLeave={e => { e.currentTarget.style.transform = `translate(calc(-50% + ${xOffset}px), -50%) rotate(${angle}deg)`; e.currentTarget.style.zIndex = i === Math.floor(mid) ? 5 : 4 - Math.abs(i - Math.floor(mid)) }}
                >
                  <div style={{
                    width: 160, height: 224,
                    borderRadius: 12,
                    overflow: 'hidden',
                    border: '2px solid var(--bg-deep)',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
                  }}>
                    <img
                      src={imgSrc}
                      alt={card.name}
                      style={{
                        width: '100%', height: '100%',
                        objectFit: 'cover',
                        transform: 'scale(1.05)',
                        display: 'block',
                      }}
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        )}

      </section>

      {/* Section 2 — Feature cards */}
      <section style={{
        marginTop: '16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px',
      }}>

        {/* Rules Assistant */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bg-void)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', marginBottom: '8px' }}>Rules Assistant</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: '16px' }}>
            Ask any question about Sorcery rules. Powered by the official rulebook and AI.
          </p>
          <Link to="/rules" style={{ color: 'var(--gold)', fontSize: '13px', textDecoration: 'none' }}>Ask the Assistant →</Link>
        </div>

        {/* Card Prices */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bg-void)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', marginBottom: '8px' }}>Card Prices</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: '16px' }}>
            Browse all cards with live TCGPlayer market prices and in-stock availability.
          </p>
          <Link to="/cards" style={{ color: 'var(--gold)', fontSize: '13px', textDecoration: 'none' }}>View Card Prices →</Link>
        </div>

        {/* Pack Openings */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--bg-void)" stroke="none">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', marginBottom: '8px' }}>Pack Openings</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: '16px' }}>
            Watch pack opening videos and see exactly what cards were pulled, with live TCG values.
          </p>
          <Link to="/videos" style={{ color: 'var(--gold)', fontSize: '13px', textDecoration: 'none' }}>Watch Openings →</Link>
        </div>

      </section>

      {/* Section 3 — Latest Shorts */}
      {shorts.length > 0 && (
        <section style={{ marginTop: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--gold-light)', letterSpacing: '0.04em' }}>Latest Shorts</div>
            <a href="https://www.youtube.com/@SatornTCG/shorts" target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
              View all on YouTube ↗
            </a>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {shorts.map(s => {
              const m   = s.shorts_url?.match(/shorts\/([a-zA-Z0-9_-]{11})/) || s.shorts_url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
              const ytId = m?.[1]
              const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null
              return (
                <a key={s.id} href={s.shorts_url} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', flex: '1 1 140px', maxWidth: 180 }}>
                  <div style={{
                    borderRadius: 12, overflow: 'hidden',
                    border: '1px solid var(--border)',
                    aspectRatio: '9/16',
                    background: 'var(--bg-raised)',
                    position: 'relative',
                  }}>
                    {thumb && (
                      <img src={thumb} alt={s.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)',
                      display: 'flex', alignItems: 'flex-end', padding: '10px 10px',
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#FF0000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                    {s.title}
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      )}


      {/* Contact strip */}
      <section style={{
        marginTop: 24,
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
