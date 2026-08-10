import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_GAME_SLUG } from '../lib/games'

const STORAGE_KEY = 'activeGameSlug'

const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [games, setGames] = useState([])
  const [activeGame, setActiveGameState] = useState(null)
  const [loading, setLoading] = useState(true)

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

  if (loading || !activeGame) {
    return <div className="loading" style={{ height: '100vh' }}>Loading…</div>
  }

  return (
    <GameContext.Provider value={{ games, activeGame, setActiveGame }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within a GameProvider')
  return ctx
}
