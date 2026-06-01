import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Sin StrictMode para evitar doble montaje que rompe WebSocket
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
