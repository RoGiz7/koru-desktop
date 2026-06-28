# Koru Desktop — Investigación de comunidad (features deseadas)

> **Origen:** notas recopiladas por RoGiz7 de la comunidad de EVE Online (2026-06-26).
> **Pendiente:** validar/ampliar con **nuestra propia búsqueda** en la comunidad (qué herramientas
> usan y aman de verdad: Pyfa, jEveAssets, EVE-O Preview, intel/local scanners, etc.) antes de
> comprometer módulos grandes. Este documento es un **menú de ideas**, no un compromiso.

---

## 0. Contraste rápido con lo que YA tiene Koru Desktop (v0.6.0)

**Ya cubierto (en mayor o menor grado):**
- Autenticación EVE SSO OAuth2 **PKCE** + refresh tokens en el keychain del SO. ✅
- BD local SQLite (datos dinámicos) + SDE local **selectivo** (`neweden.json`, `system-factions.json`).
  ⚠️ NO incrustamos el SDE completo (2-3 GB) a propósito: filosofía ligera/local-first.
- Skills: cola de entrenamiento + SP totales (display). ✅ (faltan alertas/optimizador/inyectores)
- Wallet: balance, ingresos/gastos, **libro visual** (tendencia mensual con scrub) + transacciones
  persistidas. ✅ (Módulo 4 "Libro de contabilidad visual" prácticamente hecho)
- Comercio: monitor de **órdenes propias**. ✅ (falta aviso de "te han superado el precio")
- Minería: ledger acumulado + ISK estimado. ✅ (faltan calculadoras de refinado/overlay)
- Personaje: header rico (atributos, implantes, clones, bio). ✅
- Standings/Contactos + capa de mapa por facción. ✅
- Mapa con overlays (kills/jumps 1h, soberanía, FW, incursiones, assets, minería, standings). ✅
- Tema oscuro sci-fi, auto-update, instancia única. ✅ (falta modo overlay "siempre al frente")

**Candidatos NUEVOS de alto valor (a evaluar):**
- **Intel / local scanner** (Módulo 5): pegar el local del juego → zKillboard → clasificar amenazas.
  Muy querido por la comunidad y encaja con local-first. *Ojo TOS: solo leer portapapeles que el
  usuario copia; nada de leer logs/automatizar el cliente.*
- **Alertas de skill queue** (<24 h) con notificación nativa de escritorio. Contenido, alto valor.
- **Calculadora de inyectores** (SP objetivo → nº de injectors con rendimiento decreciente).
- **Calculadora de refinado/reprocesado** (fórmula oficial con skills/implante/estación).
- **Aviso de orden superada** en Comercio (color cuando te outbidean).
- **Modo overlay / "siempre al frente"** para cronómetros y alertas (UI).
- **Build vs Buy / costes de industria** (SCI vía `/industry/systems/`): potente pero pesado
  (necesita SDE de blueprints) → ligado al módulo Fabricación que ya aplazamos.
- **Ship fitting / simulador (Pyfa-like)**: enorme; probablemente fuera de alcance (ya existe Pyfa).
- **Multi-boxing thumbnail grid**: nicho; TOS estricto (sin input broadcasting). A valorar.

---

## 1. Introducción y contexto
EVE Online es un entorno impulsado por datos, donde las decisiones estratégicas dependen de
información precisa en tiempo real. Software de escritorio avanzado para New Eden usando la API
oficial (EVE ESI) y el volcado de datos estáticos (EVE SDE).

## 2. Arquitectura base y pilares

### 2.1 Autenticación y seguridad (EVE SSO)
- OAuth 2.0 vía SSO oficial de CCP. Redirigir al navegador para autorizar scopes; capturar
  `access_token` y `refresh_token`.
- Almacenamiento local cifrado (AES o herramientas nativas del SO / Windows Credential Manager).

### 2.2 Gestión de BD híbrida
- **Estáticos (SDE):** SQLite local incrustada (~2-3 GB) para nombres de naves, planos, atributos.
- **Dinámicos (ESI):** consultas HTTPS asíncronas solo para datos mutables (billetera, mercado,
  ubicación, habilidades).

## 3. Módulos del sistema

### 📊 Módulo 1: Personajes y entrenamiento (Skills)
- **Rastreador de colas:** `/characters/{id}/skillqueue/`; diferencia entre hora del servidor y fin.
- **Alertas inteligentes:** servicio en segundo plano que vigila colas de varios alts; notificación
  nativa si quedan <24 h.
- **Optimizador de atributos:** distribución óptima de remap para minimizar el tiempo total.
- **Calculadora de inyectores:** SP totales (`/characters/{id}/skills/`) + rendimiento decreciente
  oficial → nº exacto de Skill Injectors para un fit.

### 🎯 Módulo 2: Simulación de naves y combate (Ship Fitting)
- **Motor de simulación:** módulos, cargas, drones, implantes; rendimientos decrecientes oficiales.
- **Simulador de condensador:** curva de regen de cap (ecuaciones diferenciales); "Estable" o tiempo
  exacto hasta vaciarse.
- **Portapapeles EFT/Pyfa:** importar/exportar fits en texto plano estándar (Regex).

### ⛏️ Módulo 3: Minería, reprocesamiento e industria
- **Overlay de extracción:** cronómetros semitransparentes por tipo de láser + skills.
- **Calculadora de refinado:** `% = EficienciaEstación × (1+Reprocessing) × (1+Eficiencia) × (1+Implante)`.
- **Costes de fabricación:** `/industry/systems/` (System Cost Index) + impuestos de estructura →
  coste de instalación antes de empezar.
- **Build vs Buy:** comparar coste de fabricación vs precio de venta en Jita 4-4; marcar pérdidas.

### 📈 Módulo 4: Comercio y logística (Trading)
- **Monitor de órdenes:** `/characters/{id}/orders/`; color cuando te superan el precio.
- **Libro de contabilidad visual:** `/characters/{id}/wallet/transactions/`; rendimiento neto diario
  deduciendo corretaje e impuestos.
- **Escáner de logística (hauling):** brechas de precio Null/Low ↔ hubs (Jita/Amarr) con margen >15%.

### 🚨 Módulo 5: Inteligencia y seguridad (Intel)
- **Analizador del local:** leer el portapapeles cuando el usuario copia la lista del canal local.
- **zKillboard:** K/D, naves usadas, actividad reciente de los pilotos detectados.
- **Clasificador de amenazas:** "Hunter", "Bait", picos de destrucción (`/map/kills/`).

### 🖥️ Módulo 6: Multi-boxing
- **Cuadrícula de miniaturas** en vivo de los clientes (Desktop Window Manager).
- **Enfoque veloz** de una ventana al clicar su miniatura.
- **TOS estricto:** prohibido input broadcasting (1 acción del jugador = 1 acción en 1 cliente).

## 4. Directrices UI/UX
- Estética: temas oscuros, tipografías compactas, estilo militar sci-fi.
- **Modo overlay:** paneles semitransparentes "siempre al frente" (cronómetros, intel local).
- **Multi-pantalla:** arrastrar sub-paneles a pantallas secundarias con render mínimo.
