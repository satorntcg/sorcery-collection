import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_GAME_SLUG } from '../lib/games'

const STORAGE_KEY = 'activeGameSlug'

const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [games, setGames] = useState([])
  const [activeGame, setActiveGameState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('games')
        .select('id, name, slug, sort_order')
        .eq('is_active', true)
        .order('sort_order')
      const list = data ?? []
      setGames(list)
      const savedSlug = localStorage.getItem(STORAGE_KEY) || DEFAULT_GAME_SLUG
      setActiveGameState(list.find(g => g.slug === savedSlug) || list[0] || null)
      setLoading(false)
    }
    load()
  }, [])

  function setActiveGame(game) {
    setActiveGameState(game)
    if (game) localStorage.setItem(STORAGE_KEY, game.slug)
  }

  function decrementAlertCount(n = 1) {
    setAlertCount(c => Math.max(0, c - n))
  }

  useEffect(() => {
    if (!activeGame) return
    async function fetchAlertCount() {
      const { count } = await supabase
        .from('v_active_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', activeGame.id)
        .gte('new_price', 1)
      setAlertCount(count ?? 0)
    }
    fetchAlertCount()
    const channel = supabase
      .channel(`alert-count-${activeGame.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_alerts' }, fetchAlertCount)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [activeGame])

  if (loading || !activeGame) {
    return <div className="loading" style={{ height: '100vh' }}>Loading…</div>
  }

  return (
    <GameContext.Provider value={{ games, activeGame, setActiveGame, alertCount, decrementAlertCount }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within a GameProvider')
  return ctx
}
