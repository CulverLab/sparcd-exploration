import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Join } from './Join'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Join />
  </StrictMode>,
)
