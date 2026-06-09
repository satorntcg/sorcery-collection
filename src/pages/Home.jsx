import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import WeeklyMovers from '../components/Weeklymovers'


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
      <section style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', paddingTop: 4, paddingBottom: 4 }}>

        {/* Left: text */}
        <div style={{ flex: '1 1 280px', maxWidth: 460 }}>
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
            fontSize: 'clamp(32px, 4.5vw, 52px)',
            color: 'var(--text-primary)',
            lineHeight: 1.1,
            marginBottom: '12px',
          }}>
            Track. Price. Sell.
          </h1>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '15px',
            lineHeight: 1.65,
            margin: '0 0 20px',
          }}>
            Live TCGPlayer prices, eBay sales data, and pack opening stats — all in one place. Built for Sorcery: Contested Realm players.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {/* eBay Follow */}
            <a
              href="https://www.ebay.com/str/satorntcg"
              target="_blank" rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: '#0064D2', color: '#fff',
                padding: '8px 16px', borderRadius: 6,
                textDecoration: 'none', fontSize: 13, fontWeight: 600,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              Follow on eBay
            </a>
            {/* YouTube Subscribe */}
            <a
              href="https://www.youtube.com/@SatornTCG?sub_confirmation=1"
              target="_blank" rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: '#FF0000', color: '#fff',
                padding: '8px 16px', borderRadius: 6,
                textDecoration: 'none', fontSize: 13, fontWeight: 600,
              }}
            >
              <svg width="16" height="12" viewBox="0 0 24 17" fill="white">
                <path d="M23.5 2.7A3 3 0 0 0 21.4.6C19.5.1 12 .1 12 .1S4.5.1 2.6.6A3 3 0 0 0 .5 2.7C0 4.6 0 8.5 0 8.5s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 12.4 24 8.5 24 8.5s0-3.9-.5-5.8zM9.8 12V5l6.3 3.5L9.8 12z"/>
              </svg>
              Subscribe
            </a>
          </div>

        </div>

        {/* Right: card fan */}
        {heroCards.length > 0 && (
          <div style={{ flex: '0 0 auto', position: 'relative', height: 300, width: 340, maxWidth: '100%' }}>
            {heroCards.slice(0, 5).map((card, i) => {
              const total   = Math.min(heroCards.length, 5)
              const mid     = (total - 1) / 2
              const angle   = (i - mid) * 12
              const xOffset = (i - mid) * 28
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
                    width: 140, height: 196,
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
        marginTop: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px',
      }}>

        {/* Card Catalogue */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bg-void)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', marginBottom: '8px' }}>Card Catalogue</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: '16px' }}>
            Browse all cards with live TCGPlayer market prices and in-stock availability.
          </p>
          <Link to="/cards" style={{ color: 'var(--gold)', fontSize: '13px', textDecoration: 'none' }}>View Card Catalogue →</Link>
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

        {/* eBay Store */}
        <div className="panel" style={{ padding: '24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bg-void)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold-light)', marginBottom: '8px' }}>eBay Store</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: '16px' }}>
            Buy singles directly from SatornTCG. Competitively priced Gothic, Beta, Alpha, and Arthurian Legends cards.
          </p>
          <a href="https://www.ebay.com/str/satorntcg" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', fontSize: '13px', textDecoration: 'none' }}>Shop the Store →</a>
        </div>

      </section>

      {/* Section 3 — This Week's Movers */}
      <section style={{ marginTop: 40 }}>
        <WeeklyMovers publicLinks />
      </section>

      {/* Section 4 — Latest Shorts */}
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
