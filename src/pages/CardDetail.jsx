import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd = n => n == null ? '—' : `$${Number(n).toFixed(2)}`

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
  const [loading,      setLoading]     = useState(true)
  const [notFound,     setNotFound]    = useState(false)

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      setNotFound(false)
      const [{ data, error }, { data: ebayData }] = await Promise.all([
        supabase.from('v_inventory_dashboard').select('*').eq('id', id).single(),
        supabase
          .from('ebay_listings')
          .select('ebay_url, listed_price, shipping_cost')
          .eq('status', 'active')
          .eq('card_id', id)
          .order('listed_price')
          .limit(1)
          .maybeSingle(),
      ])
      if (error || !data) {
        setNotFound(true)
      } else {
        setCard(data)
        setEbayListing(ebayData ?? null)
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

      {/* Card layout */}
      <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* LEFT: Image */}
        <div style={{ flexShrink: 0 }}>
          {card.image_url ? (
            <img
              src={card.image_url}
              alt={card.name}
              style={{
                width: '200px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                display: 'block',
              }}
            />
          ) : (
            <div style={{
              width: '200px',
              height: '280px',
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
        </div>

        {/* RIGHT: Details */}
        <div style={{ flex: 1, minWidth: '280px' }}>

          {/* Name */}
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '24px',
            color: 'var(--text-primary)',
            marginBottom: '4px',
          }}>
            {card.name}
          </h1>

          {/* Set + foil row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="set-cell">{card.set_name}</span>
            {card.foil && (
              <span className="badge badge-ok">✦ Foil</span>
            )}
          </div>

          {/* Rarity */}
          {card.rarity && (
            <div style={{ marginTop: '8px' }}>
              <span className={`badge badge-${card.rarity}`}>{card.rarity}</span>
            </div>
          )}

          {/* Condition */}
          {card.condition && (
            <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
              Condition: {conditionLabel(card.condition)}
            </div>
          )}

          {/* Prices panel */}
          <div className="panel" style={{ marginTop: '24px', padding: '16px 20px' }}>
            <div style={{
              textTransform: 'uppercase',
              fontSize: '11px',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              marginBottom: '12px',
            }}>
              Prices
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              {/* TCG Market */}
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  TCG Market
                </div>
                <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--gold)' }}>
                  {usd(card.tcgplayer_market)}
                </div>
              </div>
              {/* TCG Low */}
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  TCG Low
                </div>
                <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {usd(card.tcgplayer_low)}
                </div>
              </div>
              {/* eBay Sold Avg */}
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  eBay Sold Avg
                </div>
                <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {usd(card.ebay_sold_avg)}
                </div>
              </div>
            </div>
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
                <span style={{ color: 'var(--text-muted)' }}>Out of stock</span>
              )}
            </div>
          </div>

          {/* eBay listing */}
          {ebayListing && (
            <div className="panel" style={{ marginTop: '12px', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Listed on eBay
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)' }}>
                    {usd(ebayListing.listed_price)}
                    {ebayListing.shipping_cost > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                        + {usd(ebayListing.shipping_cost)} shipping
                      </span>
                    )}
                  </div>
                </div>
                {ebayListing.ebay_url && (
                  <a
                    href={ebayListing.ebay_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Buy on eBay ↗
                  </a>
                )}
              </div>
            </div>
          )}

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
