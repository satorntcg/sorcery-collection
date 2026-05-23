import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Alerts from './pages/Alerts'
import Listings from './pages/Ebaylistings'
import Boxes from './pages/Boxes'
import Market from './pages/Market'
import Settings from './pages/Settings'
import Import from './pages/Import'
import Login from './pages/Login'
import YouTube from './pages/YouTube'
import ListingSuggestions from './pages/ListingSuggestions'

export default function App() {
  const [session, setSession]       = useState(undefined)
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    async function fetchAlertCount() {
      const { count } = await supabase
        .from('price_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('dismissed', false)
      setAlertCount(count ?? 0)
    }
    fetchAlertCount()
    const channel = supabase
      .channel('alert-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_alerts' }, fetchAlertCount)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [session])

  if (session === undefined) {
    return <div className="loading" style={{ height: '100vh' }}>Loading…</div>
  }

  if (!session) return <Login />

  return (
    <div className="app-shell">
      <Sidebar alertCount={alertCount} onSignOut={() => supabase.auth.signOut()} />
      <main className="main-content">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/alerts"    element={<Alerts onDismiss={() => setAlertCount(c => Math.max(0, c - 1))} />} />
          <Route path="/listings"  element={<Listings />} />
          <Route path="/boxes"     element={<Boxes />} />
          <Route path="/market"    element={<Market />} />
          <Route path="/youtube"   element={<YouTube />} />
          <Route path="/import"    element={<Import />} />
          <Route path="/settings"  element={<Settings />} />
          <Route path="/suggestions" element={<ListingSuggestions />} />
          <Route path="*"          element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}