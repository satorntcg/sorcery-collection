import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const usd = n => (n == null || Number(n) === 0) ? '—' : `$${Number(n).toFixed(2)}`

const conditionLabel = raw => {
  if (!raw) return null
  return raw
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function CardDetail() {
  const { id } = useParams()
  const navigate  = useNavigate()
  const [card,         setCard]        = useState(null)
  const [ebayListing,  setEbayListing] = useState(null)
  const [snapshots,    setSnapshots]   = useState([])
  const [latestEbay,   setLatestEbay]  = useState(null)
  const [priceChange,  setPriceChange] = useState(null)
  const [loading,      setLoading]     = useState(true)
  const [notFound,     setNotFound]    = useState(false)

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      setNotFound(false)
      const [{ data, error }, { data: singleListing }, { data: lotListings }, { data: snapData }, { data: changeData }] = await Promise.all([
        supabase.from('v_inventory_dashboard').select('*').eq('id', id).single(),
        // single-card listings
        supabase
          .from('ebay_listings')
          .select('ebay_url, listed_price, shipping_cost')
          .eq('status', 'active')
          .eq('card_id', id)
          .order('listed_price')
          .limit(1)
          .maybeSingle(),
        // lot listings containing this card
        supabase
          .from('ebay_listing_cards')
          .select('ebay_listings!listing_id(ebay_url, listed_price, shipping_cost, status, card_id)')
          .eq('card_id', id),
        supabase
          .from('price_snapshots')
          .select('checked_at, tcgplayer_market, tcgplayer_low, ebay_sold_avg, ebay_sold_low, ebay_sold_high')
          .eq('card_id', id)
          .order('checked_at', { ascending: true }),
        supabase.from('v_price_gainers_losers').select('current_price, price_7d_ago').eq('card_id', id).maybeSingle(),
      ])
      if (error || !data) {
        setNotFound(true)
      } else {
        // Merge single + lot listings, pick lowest price
        const candidates = []
        if (singleListing) candidates.push(singleListing)
        for (const lc of (lotListings ?? [])) {
          const l = lc.ebay_listings
          if (l && l.status === 'active' && l.card_id === null)
            candidates.push({ ebay_url: l.ebay_url, listed_price: l.listed_price, shipping_cost: l.shipping_cost })
        }
        candidates.sort((a, b) => (a.listed_price ?? 0) - (b.listed_price ?? 0))

        setCard(data)
        setEbayListing(candidates[0] ?? null)
        if (changeData) {
          const ch = Number(changeData.current_price) - Number(changeData.price_7d_ago)
          setPriceChange(Math.abs(ch) >= 0.05 ? ch : null)
        }
        const snaps = snapData ?? []
        setSnapshots(snaps.map(s => ({
          date: new Date(s.checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          'TCG Market': s.tcgplayer_market != null ? Number(s.tcgplayer_market) : null,
          'eBay Avg':   s.ebay_sold_avg ? Number(s.ebay_sold_avg) : null,
        })))
        const lastEbaySnap = [...snaps].reverse().find(s => s.ebay_sold_avg > 0)
        setLatestEbay(lastEbaySnap ?? null)
        document.title = `${data.name} · ${data.set_name} — SatornTCG`
      }
      setLoading(false)
    }
    fetchAll()
  }, [id])

  if (loading) {
    return (
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="loading">Loading…</div>
      </div>
    )
  }

  if (notFound || !card) {
    return (
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="empty-state">Card not found.</div>
      </div>
    )
  }

  const priceFreshness = card.price_checked_at
    ? new Date(card.price_checked_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '32px 24px' }}>

      {/* Back button */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => navigate('/cards')}
        style={{ marginBottom: '24px' }}
      >
        ← Back to Cards
      </button>

      {/* Card header — name/meta above both columns */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--text-primary)', marginBottom: '4px' }}>
          {card.name}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span className="set-cell">{card.set_name}</span>
          {card.foil && <span className="badge badge-ok">✦ Foil</span>}
          {card.rarity && <span className={`badge badge-${card.rarity}`}>{card.rarity}</span>}
          {card.condition && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{conditionLabel(card.condition)}</span>}
        </div>
      </div>

      {/* Card layout */}
      <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* LEFT: Image */}
        <div style={{ flexShrink: 0, width: 'min(300px, 100%)' }}>
          {(card.image_url || card.tcgplayer_id) ? (
            <div style={{
              width: 'min(300px, 100%)', height: 'auto', aspectRatio: '5/7',
              borderRadius: 20,
              overflow: 'hidden',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <img
                src={card.image_url || `https://product-images.tcgplayer.com/fit-in/400x558/${card.tcgplayer_id}.jpg`}
                alt={card.name}
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  transform: 'scale(1.05)',
                  display: 'block',
                }}
              />
            </div>
          ) : (
            <div style={{
              width: '300px',
              height: '420px',
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
            }}>
              No image
            </div>
          )}
          {card.tcgplayer_id && (
            <a
              href={`https://www.tcgplayer.com/product/${card.tcgplayer_id}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ display: 'block', textAlign: 'center', marginTop: 6, textDecoration: 'none', width: '100%', boxSizing: 'border-box' }}
            >
              View on TCGPlayer ↗
            </a>
          )}
        </div>

        {/* RIGHT: Details */}
        <div style={{ flex: 1, minWidth: '280px' }}>

          {/* Prices panel */}
          <div className="panel" style={{ padding: '16px 20px' }}>
            <div style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '12px' }}>
              TCGPlayer
            </div>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: 4 }}>
                Market Price
                <span title="Rolling average of recent completed sales on TCGplayer" style={{ cursor: 'help', opacity: 0.6, fontSize: 10 }}>ⓘ</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '20px', fontWeight: 600, color: 'var(--gold)' }}>{usd(card.tcgplayer_market)}</span>
                {priceChange != null && (
                  <span style={{ fontSize: 11, color: priceChange > 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                    {priceChange > 0 ? '▲' : '▼'} ${Math.abs(priceChange).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              <div style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '12px' }}>
                eBay Sold
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Avg</div>
                  <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' }}>{usd(latestEbay?.ebay_sold_avg)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Low</div>
                  <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' }}>{usd(latestEbay?.ebay_sold_low)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>High</div>
                  <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' }}>{usd(latestEbay?.ebay_sold_high)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Price history chart */}
          <div className="panel" style={{ marginTop: '12px', padding: '16px 20px' }}>
            <div style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Price History
            </div>
            {snapshots.length < 2 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                Price history will appear here as data is collected.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={snapshots} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={40} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                    formatter={v => [`$${Number(v).toFixed(2)}`]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="TCG Market" stroke="var(--gold)" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="eBay Avg"   stroke="#7eb8d4" strokeWidth={2} connectNulls
                    dot={(props) => {
                      const { cx, cy, value } = props
                      if (value == null) return null
                      return <circle key={`ebay-dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill="#7eb8d4" stroke="none" />
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stock panel */}
          <div className="panel" style={{ marginTop: '12px', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                In Stock
              </span>
              {(card.quantity_owned ?? 0) > 0 ? (
                <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                  {card.quantity_owned} available
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>None</span>
              )}
            </div>
          </div>

          {/* Buy button — eBay listing or TCGPlayer fallback */}
          {ebayListing ? (
            <div className="panel" style={{ marginTop: '12px', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Available on eBay
                <span style={{ marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>· Free shipping</span>
              </div>
              {ebayListing.ebay_url ? (
                <a
                  href={ebayListing.ebay_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#E53935', color: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 0',
                    textDecoration: 'none',
                    fontSize: 15, fontWeight: 700,
                    width: '100%',
                  }}
                >
                  Buy Now — {usd(ebayListing.listed_price)}
                </a>
              ) : (
                <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)' }}>
                  {usd(ebayListing.listed_price)}
                </div>
              )}
            </div>
          ) : null}

          {/* Price freshness */}
          {priceFreshness && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
              Prices updated {priceFreshness}
            </p>
          )}

        </div>
      </div>
    </div>
  )
}
