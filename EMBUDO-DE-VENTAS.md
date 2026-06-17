# 🧭 Embudo de Ventas — DigiAccount

> Mapa estratégico de adquisición de clientes para DigiAccount (SaaS contable/fiscal).
> Mercado inicial: **Venezuela**. Visión: **LATAM**. Autor del negocio: Luis Torres (Contador Público).
> Última actualización: junio 2026.

---

## 0. Idea central (el resumen de una frase)

> Atraigo **contadores y PYMEs** que sufren con el SENIAT → les doy valor gratis (calendario/clases) → capturo su **WhatsApp** → los llevo a la **prueba de 14 días** → los convierto en suscriptores → los retengo y los convierto en **referidores**.

El embudo no es para "vender un sistema". Es para **mover a una persona desde "no me conoce" hasta "paga todos los meses y me recomienda"**, un paso a la vez.

---

## 1. ¿A quién le vendo? (los 2 avatares)

| | **Avatar A — Contador / Firma** ⭐ PRIORIDAD | **Avatar B — PYME / Emprendedor** |
|---|---|---|
| Quién es | Contador público o firma con varias empresas a cargo | Dueño de negocio sin contador fijo |
| Su dolor | Repite tareas fiscales manuales, riesgo de multas, poco tiempo | No entiende el SENIAT, teme multas, lleva todo en cuadernos/Excel |
| Por qué priorizarlo | **Es canal de distribución**: 1 firma = 10–40 empresas detrás | Volumen alto pero venta más lenta y soporte más pesado |
| Dónde está | Colegio de Contadores, gremios, grupos de WhatsApp/Telegram de contadores, LinkedIn | Instagram, TikTok, grupos de emprendedores, ferias |

**Decisión:** Año 1 = foco en **Avatar A**. Cada contador convencido te arrastra a sus clientes (Avatar B) sin que tú los persigas uno a uno.

---

## 2. El embudo, etapa por etapa

```
        ┌─────────────────────────────────────────┐
TOFU →  │  1. ATRAER   (que me conozcan)           │   muchos
        ├─────────────────────────────────────────┤
        │  2. CAPTAR   (lead magnet → WhatsApp)    │
MOFU →  ├─────────────────────────────────────────┤
        │  3. NUTRIR   (interés → prueba 14 días)  │
        ├─────────────────────────────────────────┤
BOFU →  │  4. CONVERTIR (prueba → pago)            │
        ├─────────────────────────────────────────┤
        │  5. RETENER + REFERIR (pago → embajador) │   pocos, valiosos
        └─────────────────────────────────────────┘
```

### Etapa 1 · ATRAER (parte alta del embudo)
- **Objetivo:** que tu público objetivo te vea y te reconozca como autoridad fiscal.
- **Canales VE:** Reels/posts (Instagram, TikTok), grupos de WhatsApp/Telegram de contadores, charlas en el Colegio de Contadores.
- **Munición de contenido (tienes infinita):** vencimientos SENIAT, errores en libro de compras, cómo armar el TXT de retenciones, providencias nuevas, cambios de unidad tributaria.
- **Activo que ya tienes:** material de *Formación-Empresarial* (4 clases) → conviértelo en posts/clips.
- **KPI principal:** alcance e interacciones. **Meta inicial:** 3 publicaciones/semana, crecer la comunidad de forma constante.

### Etapa 2 · CAPTAR (el lead magnet)
- **Objetivo:** cambiar valor gratis por un **dato de contacto (WhatsApp > email en Venezuela)**.
- **Lead magnets recomendados (de mayor a menor potencia):**
  1. **Calendario fiscal 2026 descargable** (vencimientos IVA/ISLR/retenciones). Ya está la data en tu dashboard.
  2. Plantilla de comprobante de retención lista para usar.
  3. Mini-clase gratis (extracto de tu Formación-Empresarial).
- **Dónde vive:** una landing simple (Vercel/Netlify, HTTPS gratis) con UN solo botón: "Descárgalo gratis por WhatsApp".
- **KPI principal:** **tasa de conversión de la landing** (visitas → leads). **Meta sana:** 20–35 %.

### Etapa 3 · NUTRIR (parte media)
- **Objetivo único:** que el lead **active la prueba de 14 días**. (Todavía NO vendes el plan.)
- **Motor:** secuencia automatizada por **WhatsApp** (con N8N, ya está en tu guía).
- **Ejemplo de secuencia:**
  - Día 0: entrega del lead magnet + "¿sabías que DigiAccount te arma esto solo? Pruébalo gratis 14 días 👉".
  - Día 2: caso de dolor ("cuánto cuesta una multa por libro mal llevado").
  - Día 4: invitación directa al trial + enlace.
- **KPI principal:** **lead → trial**. **Meta:** 10–20 % de los leads activan prueba.

### Etapa 4 · CONVERTIR (parte baja)
- **Objetivo:** que el usuario en prueba **pague** antes/cuando termine el trial.
- **Durante los 14 días (onboarding = la venta real):**
  - Día 1: bienvenida + "registra tu primera empresa".
  - Día 3: "carga tu primera factura / mira el OCR".
  - Día 7: "tu reporte de IVA ya está listo, mira" (momento ajá ✨).
  - Día 12: "tu prueba termina en 2 días — activa hoy con X % de descuento".
- **Pago VE:** precio anclado en **USD** (estabilidad), cobro en **Pago Móvil / USDT**. Descuento por pago **anual**.
- **KPI principal:** **trial → pago**. **Meta sana SaaS:** 15–25 % (con buen onboarding, más).

### Etapa 5 · RETENER + REFERIR
- **Objetivo:** que se queden y que **traigan a otros**.
- **Retención:** soporte por WhatsApp, que el producto les ahorre tiempo real cada mes (vencimientos, TXT, comprobantes).
- **Referidos (clave para crecer barato):** el contador que trae 5 PYMEs gana descuento o comisión. Tu Avatar A se vuelve tu fuerza de ventas.
- **KPI principal:** **churn mensual** (cancelaciones). **Meta:** < 5 % mensual. Y **% de clientes que refieren**.

---

## 3. Tablero de métricas (revísalo cada mes)

| Etapa | Métrica | Cómo se calcula | Meta inicial realista |
|---|---|---|---|
| Atraer | Alcance / nuevos seguidores | Métricas de la red | Crecimiento constante semanal |
| Captar | Conversión de landing | Leads ÷ visitas | 20–35 % |
| Nutrir | Lead → Trial | Trials ÷ leads | 10–20 % |
| Convertir | Trial → Pago | Pagos ÷ trials | 15–25 % |
| Retener | Churn mensual | Cancelan ÷ activos | < 5 % |
| Negocio | CAC | $ gastado ÷ clientes nuevos | Que sea < 1/3 del valor anual del cliente |
| Negocio | LTV | Precio mensual ÷ churn | Apunta a LTV ≥ 3× CAC |

> Regla de oro SaaS: **LTV ≥ 3× CAC**. Si gastas $30 en traer un cliente, ese cliente debe dejarte ≥ $90 en su vida útil.

### Ejemplo numérico (para visualizar el embudo)
Si en un mes logras **1.000 visitas** a tu landing:
- 25 % convierten → **250 leads** (WhatsApp capturados)
- 15 % activan trial → **37 trials**
- 20 % pagan → **~7 clientes nuevos** ese mes

7 clientes/mes parece poco, pero si cada uno es un **contador con 15 empresas**, el impacto real es enorme. Por eso el Avatar A es la prioridad.

---

## 4. Plan de los primeros 90 días

**Mes 1 — Fundaciones**
- Terminar backend mínimo para que el **trial de 14 días funcione de verdad** (Supabase + auth + guardar datos). Sin esto, el embudo no cierra.
- Crear el lead magnet #1 (calendario fiscal descargable).
- Montar la landing de captura (Vercel/Netlify).

**Mes 2 — Encender el embudo**
- Publicar contenido 3x/semana (reusar Formación-Empresarial).
- Conectar la secuencia de WhatsApp con N8N (lead magnet → trial).
- Entrar a 3–5 grupos/gremios de contadores y aportar valor (no vender aún).

**Mes 3 — Medir y ajustar**
- Llenar el tablero de métricas con datos reales.
- Identificar el cuello de botella (¿pocos leads? ¿pocos trials? ¿pocos pagos?) y atacar SOLO ese.
- Lanzar el programa de **referidos** para los primeros contadores contentos.

---

## 5. Reglas de oro para Venezuela (y luego LATAM)

1. **WhatsApp es el canal, no el email.** Todo el embudo gira en torno a WhatsApp.
2. **Tu título de Contador Público es tu mayor activo de confianza.** Úsalo en todo (eres par de tu cliente, no un vendedor de software).
3. **Precio en USD, cobro en Pago Móvil/USDT.** Estabilidad para ti, comodidad para el cliente.
4. **Vende el ahorro de tiempo y la tranquilidad ante el SENIAT**, no "funciones".
5. **Un mercado a la vez.** Domina Venezuela primero; el modelo replicado (con ajustes fiscales locales) es lo que llevas a Colombia, Perú, etc.

---

## 6. Próximas piezas a construir (orden sugerido)
1. ☐ Lead magnet #1 (calendario fiscal descargable) + landing de captura.
2. ☐ Secuencia de WhatsApp (lead → trial → pago) en N8N.
3. ☐ Estructura final de planes y precios + programa de referidos.
4. ☐ Backend del trial (sin esto nada del embudo cierra).
