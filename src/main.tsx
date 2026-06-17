import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Fade out + remove the brand boot loader once the app shell has mounted. A short
// minimum display keeps the coin from flashing-and-vanishing on a fast load.
const wcLoader = document.getElementById('wc-loader')
if (wcLoader) {
  window.setTimeout(() => {
    wcLoader.classList.add('wc-done')
    window.setTimeout(() => wcLoader.remove(), 650)
  }, 600)
}
