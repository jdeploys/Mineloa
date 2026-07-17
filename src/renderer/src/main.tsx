import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/globals.css'
import './styles/app.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
