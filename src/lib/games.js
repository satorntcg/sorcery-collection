// Per-game vocabulary and constants. Adding a new game = one row in the
// `games` table (see supabase/migrations/20260810_multi_game_support.sql)
// plus one entry here keyed by that row's `slug`.
export const GAME_CONFIG = {
  sorcery: {
    displayName: 'Sorcery TCG',
    rarities: ['ordinary', 'exceptional', 'elite', 'unique'],
    cardTypes: ['site', 'minion', 'magic', 'artifact', 'avatar'],
    sets: ['Alpha', 'Beta', 'Arthurian Legends', 'Gothic', 'Other'],
    defaultSet: 'Gothic',
    defaultRarity: 'elite',
    tcgplayerSlug: 'sorcery-contested-realm',
    // Flat estimate for the "ordinary" filler card in every pack, used by BoxEV's
    // pack-EV math since those cards rarely get individually priced/tracked.
    fillerCardValue: 1.00,
    rarityMap: {
      ordinary: 'ordinary', o: 'ordinary',
      exceptional: 'exceptional', e: 'exceptional',
      elite: 'elite', el: 'elite',
      unique: 'unique', u: 'unique',
    },
    // Listing Suggestions tiers:
    // - eligibleRarities: rarities worth individually tracking for lot-building (excludes the base filler tier)
    // - soloRarities: get their own foil/non-foil lot tiers, highest first
    // - secondaryRarity: one more non-foil tier below the solo rarities
    // - pooledSpecialType/pooledSpecialLabel: a card_type that always gets its own pool regardless of rarity (Sorcery's "site" cards)
    grouping: {
      eligibleRarities: ['exceptional', 'elite', 'unique'],
      soloRarities: ['unique'],
      secondaryRarity: 'elite',
      pooledSpecialType: 'site',
      pooledSpecialLabel: 'Site',
    },
  },
  riftbound: {
    displayName: 'Riftbound',
    rarities: ['common', 'uncommon', 'rare', 'epic', 'overnumbered'],
    cardTypes: ['champion', 'legend', 'unit', 'rune', 'spell', 'gear', 'battlefield', 'token'],
    sets: ['Origins', 'Other'],
    defaultSet: 'Origins',
    defaultRarity: 'rare',
    // Best-guess TCGPlayer product-line slug — verify once a Riftbound card is
    // actually looked up on TCGPlayer and correct if the real slug differs.
    tcgplayerSlug: 'riftbound',
    // Placeholder — no real market data yet, tune once you have pull data.
    fillerCardValue: 1.00,
    rarityMap: {
      common: 'common', c: 'common',
      uncommon: 'uncommon', unc: 'uncommon',
      rare: 'rare', r: 'rare',
      epic: 'epic',
      overnumbered: 'overnumbered', on: 'overnumbered',
    },
    grouping: {
      eligibleRarities: ['uncommon', 'rare', 'epic', 'overnumbered'],
      soloRarities: ['epic', 'overnumbered'],
      secondaryRarity: 'rare',
      pooledSpecialType: null,
      pooledSpecialLabel: null,
    },
  },
}

export const DEFAULT_GAME_SLUG = 'sorcery'

export function gameConfig(slug) {
  return GAME_CONFIG[slug] || GAME_CONFIG[DEFAULT_GAME_SLUG]
}
