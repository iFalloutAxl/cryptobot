// Singleton WebSocket — vive fuera de React, no se ve afectado por re-renders
let ws = null
let pingTimer = null
let reconnectTimer = null
let currentPair = 'XBT/USD'
let onPriceCallback = null
let onStatusCallback = null
let destroyed = false

function clearTimers() {
  if (pingTimer)     { clearInterval(pingTimer);  pingTimer = null }
  if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null }
}

function connect() {
  if (destroyed) return
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    ws.close()
  }

  onStatusCallback?.({ connected: false, label: 'Conectando a Kraken...' })

  ws = new WebSocket('wss://ws.kraken.com')

  ws.onopen = () => {
    console.log('[Kraken] Conexión abierta, suscribiendo a', currentPair)
    ws.send(JSON.stringify({
      event: 'subscribe',
      pair: [currentPair],
      subscription: { name: 'trade' }
    }))
    // Ping cada 20s para mantener viva la conexión
    clearTimers()
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'ping' }))
        console.log('[Kraken] Ping enviado')
      }
    }, 20000)
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)

      if (msg.event === 'pong' || msg.event === 'heartbeat') {
        console.log('[Kraken] Keepalive:', msg.event)
        return
      }

      if (msg.event === 'subscriptionStatus') {
        console.log('[Kraken] subscriptionStatus:', msg.status, msg.pair)
        if (msg.status === 'subscribed') {
          onStatusCallback?.({ connected: true, label: 'Kraken WS ✓' })
        }
        if (msg.status === 'error') {
          console.error('[Kraken] Error:', msg.errorMessage)
          onStatusCallback?.({ connected: false, label: `Error: ${msg.errorMessage}` })
        }
        return
      }

      if (msg.event === 'systemStatus') {
        console.log('[Kraken] systemStatus:', msg.status)
        return
      }

      // Datos de trades: [channelID, [[price, vol, time, side, type, misc]], "trade", "XBT/USD"]
      if (Array.isArray(msg) && msg[2] === 'trade') {
        const tradeList = msg[1]
        const last = tradeList[tradeList.length - 1]
        const price = parseFloat(last[0])
        if (!isNaN(price) && price > 0) {
          onStatusCallback?.({ connected: true, label: 'Kraken WS ✓' })
          onPriceCallback?.(price)
        }
      }
    } catch (err) {
      console.error('[Kraken] Error parseando mensaje:', err)
    }
  }

  ws.onclose = (e) => {
    console.log('[Kraken] Conexión cerrada — code:', e.code, 'reason:', e.reason)
    clearTimers()
    if (!destroyed) {
      onStatusCallback?.({ connected: false, label: `Reconectando en 4s... (code ${e.code})` })
      reconnectTimer = setTimeout(connect, 4000)
    }
  }

  ws.onerror = (e) => {
    console.error('[Kraken] WebSocket error:', e)
    onStatusCallback?.({ connected: false, label: 'Error — reintentando...' })
  }
}

export function startKraken(pair, onPrice, onStatus) {
  destroyed = false
  currentPair = pair
  onPriceCallback = onPrice
  onStatusCallback = onStatus
  connect()
}

export function changePair(pair) {
  currentPair = pair
  onStatusCallback?.({ connected: false, label: 'Cambiando par...' })
  clearTimers()
  if (ws) ws.close()
  // connect() se llama desde onclose
}

export function stopKraken() {
  destroyed = true
  clearTimers()
  if (ws) { ws.close(); ws = null }
}
