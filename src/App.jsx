import { useState, useEffect, useCallback } from 'react'
import { startKraken, changePair, stopKraken } from './krakenSocket.js'

const COINS = [
  { wsName: 'XBT/USD', label: 'BTC/USD', short: 'BTC' },
  { wsName: 'ETH/USD', label: 'ETH/USD', short: 'ETH' },
  { wsName: 'SOL/USD', label: 'SOL/USD', short: 'SOL' },
  { wsName: 'ADA/USD', label: 'ADA/USD', short: 'ADA' },
]

function calcEMA(prices, period) {
  if (prices.length < period) return null
  const k = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k)
  return ema
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null
  const changes = prices.slice(-(period + 1)).map((p, i, a) => i > 0 ? p - a[i - 1] : 0).slice(1)
  const avgGain = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) / period
  const avgLoss = changes.filter(c => c < 0).map(Math.abs).reduce((a, b) => a + b, 0) / period
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

function getSignal(prices) {
  if (prices.length < 22) return { signal: 'ESPERANDO', color: '#888888', reason: `Acumulando datos... (${prices.length}/22)` }
  const ema9  = calcEMA(prices, 9)
  const ema21 = calcEMA(prices, 21)
  const rsi   = calcRSI(prices, 14)
  const prev9  = calcEMA(prices.slice(0, -1), 9)
  const prev21 = calcEMA(prices.slice(0, -1), 21)
  if (!ema9 || !ema21 || !rsi) return { signal: 'CALCULANDO', color: '#888888', reason: 'Procesando...' }
  if (prev9 <= prev21 && ema9 > ema21 && rsi < 70) return { signal: 'COMPRAR',      color: '#00ff88', reason: `EMA cruzó ↑ | RSI: ${rsi.toFixed(1)}` }
  if (prev9 >= prev21 && ema9 < ema21 && rsi > 30) return { signal: 'VENDER',       color: '#ff4466', reason: `EMA cruzó ↓ | RSI: ${rsi.toFixed(1)}` }
  if (rsi < 30) return { signal: 'SOBREVENDIDO',  color: '#ffaa00', reason: `RSI: ${rsi.toFixed(1)} — posible rebote` }
  if (rsi > 70) return { signal: 'SOBRECOMPRADO', color: '#ff6600', reason: `RSI: ${rsi.toFixed(1)} — posible caída` }
  return { signal: ema9 > ema21 ? 'ALCISTA' : 'BAJISTA', color: ema9 > ema21 ? '#44aaff' : '#aa66ff', reason: `RSI: ${rsi.toFixed(1)} | EMA9 ${ema9 > ema21 ? '>' : '<'} EMA21` }
}

function Sparkline({ prices, color }) {
  if (prices.length < 2) return null
  const w = 300, h = 48
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ')
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export default function App() {
  const [coinIdx, setCoinIdx]       = useState(0)
  const [price, setPrice]           = useState(null)
  const [prevPrice, setPrevPrice]   = useState(null)
  const [prices, setPrices]         = useState([])
  const [signal, setSignal]         = useState({ signal: 'CONECTANDO...', color: '#44aaff', reason: 'Iniciando WebSocket...' })
  const [connected, setConnected]   = useState(false)
  const [wsLabel, setWsLabel]       = useState('Iniciando...')
  const [tickCount, setTickCount]   = useState(0)
  const [balance, setBalance]       = useState(1000)
  const [position, setPosition]     = useState(null)
  const [trades, setTrades]         = useState([])
  const [pnl, setPnl]               = useState(0)
  const [autoTrade, setAutoTrade]   = useState(false)
  const [tradeSize, setTradeSize]   = useState(50)
  const [stopLoss, setStopLoss]     = useState(0.3)
  const [takeProfit, setTakeProfit] = useState(0.5)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [loadingAI, setLoadingAI]   = useState(false)

  // Usar refs para valores dentro del callback del WS
  const stateRef = { autoTrade, position, balance, tradeSize, stopLoss, takeProfit, coinIdx }

  const onPrice = useCallback((newPrice) => {
    setPrice(prev => { setPrevPrice(prev ?? newPrice); return newPrice })
    setTickCount(t => t + 1)
    setPrices(prev => {
      const updated = [...prev, newPrice].slice(-200)
      setSignal(getSignal(updated))
      return updated
    })
  }, [])

  const onStatus = useCallback(({ connected, label }) => {
    setConnected(connected)
    setWsLabel(label)
  }, [])

  // Arrancar WebSocket al montar
  useEffect(() => {
    startKraken(COINS[0].wsName, onPrice, onStatus)
    return () => stopKraken()
  }, [])

  // Cambiar par
  const handleCoinChange = (idx) => {
    setCoinIdx(idx)
    setPrices([])
    setPrice(null)
    setPrevPrice(null)
    setTickCount(0)
    setSignal({ signal: 'CAMBIANDO...', color: '#44aaff', reason: 'Suscribiendo nuevo par...' })
    changePair(COINS[idx].wsName)
  }

  // Auto trading — separado del WS para usar state actualizado
  useEffect(() => {
    if (!autoTrade || !price || prices.length < 22) return
    const sig = getSignal(prices)

    if (!position && sig.signal === 'COMPRAR' && balance >= tradeSize) {
      const newPos = { entryPrice: price, qty: tradeSize / price, size: tradeSize, time: Date.now() }
      setPosition(newPos)
      setBalance(b => b - tradeSize)
    }

    if (position) {
      const pct = ((price - position.entryPrice) / position.entryPrice) * 100
      if (pct >= takeProfit || pct <= -stopLoss) {
        const val    = position.qty * price
        const profit = val - position.size
        setTrades(t => [{
          symbol: COINS[coinIdx].label, entry: position.entryPrice, exit: price,
          profit: profit.toFixed(4), pct: pct.toFixed(3),
          time: new Date().toLocaleTimeString(), result: profit > 0 ? 'WIN' : 'LOSS'
        }, ...t].slice(0, 50))
        setPnl(p => p + profit)
        setBalance(b => b + val)
        setPosition(null)
      }
    }
  }, [price]) // se ejecuta en cada precio nuevo

  const manualBuy = () => {
    if (!price || position) return
    const size = Math.min(tradeSize, balance)
    setPosition({ entryPrice: price, qty: size / price, size, time: Date.now() })
    setBalance(b => b - size)
  }

  const manualSell = () => {
    if (!price || !position) return
    const val    = position.qty * price
    const profit = val - position.size
    const pct    = ((price - position.entryPrice) / position.entryPrice) * 100
    setTrades(t => [{
      symbol: COINS[coinIdx].label, entry: position.entryPrice, exit: price,
      profit: profit.toFixed(4), pct: pct.toFixed(3),
      time: new Date().toLocaleTimeString(), result: profit > 0 ? 'WIN' : 'LOSS'
    }, ...t].slice(0, 50))
    setPnl(p => p + profit)
    setBalance(b => b + val)
    setPosition(null)
  }

  const getAIAnalysis = async () => {
    if (!price || prices.length < 10) return
    setLoadingAI(true); setAiAnalysis('')
    const rsi  = calcRSI(prices, 14)
    const ema9 = calcEMA(prices, 9)
    const ema21= calcEMA(prices, 21)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          messages: [{ role: 'user', content:
            `Eres analista de trading cripto experto. En máx 4 oraciones en español analiza ${COINS[coinIdx].label}:
            Precio: $${price.toFixed(2)}, RSI(14): ${rsi?.toFixed(1)}, EMA9: $${ema9?.toFixed(2)}, EMA21: $${ema21?.toFixed(2)},
            Señal: ${signal.signal}, Balance simulado: $${balance.toFixed(2)}, PnL: $${pnl.toFixed(4)}, Trades: ${trades.length}.
            Di: 1) Qué pasa con el precio, 2) Si la señal es confiable, 3) Qué haría un trader prudente.`
          }]
        })
      })
      const d = await res.json()
      setAiAnalysis(d.content?.[0]?.text ?? 'Sin respuesta.')
    } catch { setAiAnalysis('Error al conectar con Claude.') }
    setLoadingAI(false)
  }

  const coin       = COINS[coinIdx]
  const priceUp    = price && prevPrice ? price >= prevPrice : true
  const currentPnL = position && price ? (position.qty * price) - position.size : 0
  const winRate    = trades.length > 0 ? ((trades.filter(t => t.result === 'WIN').length / trades.length) * 100).toFixed(0) : 0
  const rsi        = calcRSI(prices, 14)
  const ema9       = calcEMA(prices, 9)
  const ema21      = calcEMA(prices, 21)

  return (
    <div style={{ minHeight: '100vh', background: '#050a0e' }}>

      {/* Header */}
      <div style={{ background: '#070d14', borderBottom: '1px solid #1e3a5f', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 900, fontSize: 20, color: '#00ff88', letterSpacing: 4 }}>CRYPTOBOT</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#00ff88' : '#ff4466', boxShadow: connected ? '0 0 10px #00ff88' : '0 0 10px #ff4466' }} className={connected ? 'pulse' : ''} />
          <span style={{ fontSize: 11, color: connected ? '#00ff88' : '#ff6644', fontFamily: "'Space Mono', monospace" }}>
            {connected ? `${wsLabel} · tick #${tickCount}` : wsLabel}
          </span>
        </div>
      </div>

      <div style={{ padding: '16px', maxWidth: 900, margin: '0 auto' }}>

        {/* Coin selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {COINS.map((c, i) => (
            <button key={c.short} className="btn" onClick={() => handleCoinChange(i)} style={{
              padding: '8px 18px', fontSize: 12,
              background: coinIdx === i ? '#00ff88' : '#0d1f30',
              color: coinIdx === i ? '#050a0e' : '#6688aa',
              border: `1px solid ${coinIdx === i ? '#00ff88' : '#1e3a5f'}`
            }}>{c.short}</button>
          ))}
        </div>

        {/* Price + Signal */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#070d14', border: '1px solid #1e3a5f', borderRadius: 10, padding: '20px 22px' }}>
            <div style={{ fontSize: 9, color: '#445566', letterSpacing: 3, marginBottom: 8 }}>PRECIO · {coin.label}</div>
            <div style={{ fontSize: 32, fontFamily: "'Orbitron', sans-serif", fontWeight: 900, color: priceUp ? '#00ff88' : '#ff4466', transition: 'color 0.3s', marginBottom: 4 }}>
              ${price ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}
            </div>
            <div style={{ fontSize: 10, color: priceUp ? '#00ff8866' : '#ff446666', marginBottom: 10 }}>{priceUp ? '▲ subiendo' : '▼ bajando'}</div>
            <Sparkline prices={prices.slice(-60)} color={priceUp ? '#00ff8888' : '#ff446688'} />
          </div>

          <div style={{ background: '#070d14', border: `2px solid ${signal.color}55`, borderRadius: 10, padding: '20px 22px' }}>
            <div style={{ fontSize: 9, color: '#445566', letterSpacing: 3, marginBottom: 8 }}>SEÑAL DEL BOT</div>
            <div style={{ fontSize: 26, fontFamily: "'Orbitron', sans-serif", fontWeight: 900, color: signal.color, marginBottom: 8 }}>{signal.signal}</div>
            <div style={{ fontSize: 11, color: '#6688aa', lineHeight: 1.6, marginBottom: 14 }}>{signal.reason}</div>
            {rsi && (
              <>
                <div style={{ fontSize: 9, color: '#334455', marginBottom: 4 }}>RSI {rsi.toFixed(1)}</div>
                <div style={{ height: 4, background: '#0d1f30', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${Math.min(rsi, 100)}%`, background: rsi > 70 ? '#ff6600' : rsi < 30 ? '#ffaa00' : '#44aaff', transition: 'width 0.5s', borderRadius: 2 }} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 12 }}>
          {[
            { l: 'EMA 9',   v: ema9  ? `$${ema9.toFixed(0)}`  : '—', c: '#c8d8e8' },
            { l: 'EMA 21',  v: ema21 ? `$${ema21.toFixed(0)}` : '—', c: ema9 && ema21 ? (ema9 > ema21 ? '#00ff88' : '#ff4466') : '#c8d8e8' },
            { l: 'BALANCE', v: `$${balance.toFixed(2)}`,              c: '#c8d8e8' },
            { l: 'PnL',     v: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, c: pnl >= 0 ? '#00ff88' : '#ff4466' },
            { l: 'WIN %',   v: `${winRate}%`,                         c: parseInt(winRate) >= 50 ? '#00ff88' : '#ff6600' },
          ].map(s => (
            <div key={s.l} style={{ background: '#070d14', border: '1px solid #1e3a5f', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 2 }}>{s.l}</div>
              <div style={{ fontSize: 15, fontFamily: "'Orbitron', sans-serif", fontWeight: 700, color: s.c, marginTop: 5 }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Open position */}
        {position && (
          <div className="slide-in" style={{ background: '#0a1a0a', border: '1px solid #00ff8844', borderRadius: 10, padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: '#00ff88', letterSpacing: 3, marginBottom: 10 }}>📊 POSICIÓN ABIERTA</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              {[
                { l: 'Entrada', v: `$${position.entryPrice.toFixed(2)}` },
                { l: 'Actual',  v: `$${price?.toFixed(2) ?? '—'}` },
                { l: 'Tamaño', v: `$${position.size.toFixed(2)}` },
                { l: 'P&L',    v: `${currentPnL >= 0 ? '+' : ''}$${currentPnL.toFixed(4)}`, c: currentPnL >= 0 ? '#00ff88' : '#ff4466' },
                { l: 'Cambio', v: `${price ? (((price - position.entryPrice) / position.entryPrice) * 100).toFixed(3) : 0}%`, c: currentPnL >= 0 ? '#00ff88' : '#ff4466' },
              ].map(x => (
                <div key={x.l}><span style={{ color: '#445566', fontSize: 9 }}>{x.l}: </span><span style={{ color: x.c ?? '#c8d8e8' }}>{x.v}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#070d14', border: '1px solid #1e3a5f', borderRadius: 10, padding: '16px' }}>
            <div style={{ fontSize: 9, color: '#445566', letterSpacing: 3, marginBottom: 12 }}>TRADING MANUAL</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <button className="btn" onClick={manualBuy}  disabled={!!position || !price} style={{ flex: 1, padding: '12px', fontSize: 12, background: '#00ff88', color: '#050a0e' }}>▲ COMPRAR</button>
              <button className="btn" onClick={manualSell} disabled={!position || !price}  style={{ flex: 1, padding: '12px', fontSize: 12, background: '#ff4466', color: '#fff' }}>▼ CERRAR</button>
            </div>
            <div style={{ fontSize: 9, color: '#445566', marginBottom: 6 }}>TAMAÑO: <span style={{ color: '#00ff88' }}>${tradeSize}</span></div>
            <input type="range" min="10" max="500" step="10" value={tradeSize} onChange={e => setTradeSize(+e.target.value)} />
          </div>

          <div style={{ background: '#070d14', border: '1px solid #1e3a5f', borderRadius: 10, padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: '#445566', letterSpacing: 3 }}>AUTO TRADING</div>
              <button className="btn" onClick={() => setAutoTrade(a => !a)} style={{ padding: '8px 16px', fontSize: 11, background: autoTrade ? '#ff4466' : '#00ff88', color: autoTrade ? '#fff' : '#050a0e' }}>
                {autoTrade ? '⏹ DETENER' : '▶ ACTIVAR'}
              </button>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: '#445566', marginBottom: 5 }}>STOP LOSS: <span style={{ color: '#ff4466' }}>{stopLoss}%</span></div>
              <input type="range" min="0.1" max="2" step="0.1" value={stopLoss} onChange={e => setStopLoss(+e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#445566', marginBottom: 5 }}>TAKE PROFIT: <span style={{ color: '#00ff88' }}>{takeProfit}%</span></div>
              <input type="range" min="0.1" max="3" step="0.1" value={takeProfit} onChange={e => setTakeProfit(+e.target.value)} />
            </div>
          </div>
        </div>

        {/* AI Analysis */}
        <div style={{ background: '#070d14', border: '1px solid #44aaff33', borderRadius: 10, padding: '16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: '#44aaff', letterSpacing: 3 }}>🤖 ANÁLISIS IA (Claude)</div>
            <button className="btn" onClick={getAIAnalysis} disabled={loadingAI || prices.length < 10} style={{ padding: '7px 14px', fontSize: 11, background: '#44aaff22', color: '#44aaff', border: '1px solid #44aaff44' }}>
              {loadingAI ? 'ANALIZANDO...' : 'ANALIZAR AHORA'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#8899aa', lineHeight: 1.8, minHeight: 48 }}>
            {loadingAI
              ? <span className="pulse" style={{ color: '#44aaff' }}>Consultando modelo de IA...</span>
              : aiAnalysis || <span style={{ color: '#334455' }}>Espera ~2 min para acumular datos, luego presiona "ANALIZAR AHORA".</span>}
          </div>
        </div>

        {/* Trade history */}
        <div style={{ background: '#070d14', border: '1px solid #1e3a5f', borderRadius: 10, padding: '16px' }}>
          <div style={{ fontSize: 9, color: '#445566', letterSpacing: 3, marginBottom: 12 }}>
            HISTORIAL — {trades.length} trades · {trades.filter(t => t.result === 'WIN').length} wins
          </div>
          {trades.length === 0
            ? <div style={{ color: '#334455', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Sin trades aún. Compra manualmente o activa Auto Trading.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {trades.map((t, i) => (
                  <div key={i} className={i === 0 ? 'slide-in' : ''} style={{
                    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
                    padding: '9px 12px', borderRadius: 6, fontSize: 11,
                    background: t.result === 'WIN' ? '#0a1a0a' : '#1a0a0a',
                    border: `1px solid ${t.result === 'WIN' ? '#00ff8822' : '#ff446622'}`
                  }}>
                    <span style={{ color: '#44aaff' }}>{t.symbol}</span>
                    <span style={{ color: '#6688aa' }}>${parseFloat(t.entry).toFixed(2)} → ${parseFloat(t.exit).toFixed(2)}</span>
                    <span style={{ color: t.result === 'WIN' ? '#00ff88' : '#ff4466', fontWeight: 700 }}>
                      {parseFloat(t.profit) >= 0 ? '+' : ''}{t.profit} USD ({t.pct}%)
                    </span>
                    <span style={{ color: '#334455' }}>{t.time}</span>
                  </div>
                ))}
              </div>}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, color: '#1a2a3a' }}>
          ⚠ SIMULACIÓN — PRECIOS REALES VÍA KRAKEN WEBSOCKET — SIN DINERO REAL
        </div>
      </div>
    </div>
  )
}
