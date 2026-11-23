import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/fonts.css'
import './theme/base.css'
import './theme/classic.css'
import './theme/amber.css'
import './theme/neon.css'
import './theme/draft.css'
import './theme/motion.css'
import './theme/root.css'
import { App } from './app/App'
import { installOneShotCleanup } from './fx/moments'

installOneShotCleanup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
