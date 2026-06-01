# CryptoBot — Simulador de Trading

Bot de trading simulado con precios reales via Kraken WebSocket + análisis de IA con Claude.

## Correr localmente

```bash
npm install
npm run dev
```

Abre http://localhost:3000

## Deploy en Railway

1. Sube esta carpeta a un repositorio de GitHub
2. En Railway: New Project → Deploy from GitHub repo
3. Selecciona el repo → Railway detecta automáticamente la configuración
4. ¡Listo! Te da una URL pública

## Tecnologías

- React + Vite
- Kraken WebSocket API (precios reales en tiempo real)
- Claude API (análisis de IA)
- Indicadores: EMA 9, EMA 21, RSI 14
