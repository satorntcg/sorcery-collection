import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd = n => n == null ? '—' : `$${Number(n).toFixed(2)}`

function getYouTubeId(url) {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return m?.[1] ?? null
}

export default function PublicVideos() {
  const [videos,  setVideos]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Pack Openings — SatornTCG'
    supabase
      .from('v_youtube_opening_summary')
      .select('*')
      .order('filmed_at', { ascending: false })
      .then(({ data }) => { setVideos(data ?? []); setLoading(false) })
  }, [])


  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">Pack Openings</h1>
          <p className="page-subtitle">Sorcery: Contested Realm pack opening videos</p>
        </div>
        <a
          href="https://www.youtube.com/@SatornTCG"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#FF0000', color: '#fff',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 16px',
            textDecoration: 'none',
            fontSize: 13, fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          Subscribe
        </a>
      </div>


      {/* Grid */}
      {loading ? (
        <div className="loading" style={{ marginTop: 40 }}>Loading videos…</div>
      ) : videos.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>No videos yet — check back soon!</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 20,
          marginTop: 20,
        }}>
          {videos.map(v => {
            const ytId      = getYouTubeId(v.youtube_url)
            const thumb     = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null
            const pnlPos    = (v.opening_pnl ?? 0) >= 0
            const filmed    = v.filmed_at
              ? new Date(v.filmed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : null

            if (!thumb) return null
            return (
              <div key={v.id} className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                {/* Thumbnail */}
                <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--bg-raised)', flexShrink: 0 }}>
                  {thumb ? (
                    <img src={thumb} alt={v.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No thumbnail
                    </div>
                  )}
                  {/* Play overlay */}
                  {v.youtube_url && (
                    <a href={v.youtube_url} target="_blank" rel="noreferrer" style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.3)',
                      opacity: 0,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                    >
                      <div style={{
                        width: 52, height: 52, borderRadius: '50%',
                        background: '#FF0000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    </a>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 3 }}>
                      {v.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {[v.box_name, v.set_name, filmed].filter(Boolean).join(' · ')}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {v.packs_in_video != null && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Packs </span>{v.packs_in_video}
                      </div>
                    )}
                    {v.total_tcg_value != null && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Value </span>
                        <span style={{ color: 'var(--gold)' }}>{usd(v.total_tcg_value)}</span>
                      </div>
                    )}
                    {v.opening_pnl != null && (
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>P&L </span>
                        <span style={{ color: pnlPos ? 'var(--success)' : 'var(--danger)' }}>
                          {pnlPos ? '+' : ''}{usd(v.opening_pnl)}
                        </span>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
