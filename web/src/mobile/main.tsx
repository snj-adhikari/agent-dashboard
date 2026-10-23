import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { MobileApp } from './MobileApp'

navigator.serviceWorker?.register('/sw.js', { scope: '/m/' }).catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
)
