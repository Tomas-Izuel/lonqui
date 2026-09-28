#!/usr/bin/env node
/**
 * Capturas + verificación del panel inicial DEFINITIVO (F3, fase 2) contra
 * el `next dev` compartido en :3000 — no levanta ni mata servidor.
 *
 * Uso: node scripts/capture-inicio-final.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = 'docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-final'
const ADMIN = { email: 'admin@lonqui.test', password: process.env.DEV_ADMIN_PASSWORD ?? 'lonqui-dev-1234' }

const VIEWPORTS = [
  { name: '390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
].map((vp) => ({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', ...vp }))

function contextOptionsOf(vp) {
  const options = { ...vp }
  delete options.name
  return options
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Contraseña', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({ args: ['--lang=es-AR'] })
  const consoleErrors = []
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext(contextOptionsOf(vp))
      const page = await context.newPage()
      await login(page)

      // Los listeners de consola arrancan DESPUÉS del login a propósito: el
      // login (`/login`) tiene un warning de hidratación preexistente
      // (`method="post"` vs. `"POST"`, ajeno a esta ronda) que no aporta
      // señal sobre el panel inicial — acá solo importa lo que pasa en `/`.
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`[${vp.name}] ${msg.text()}`)
      })
      page.on('pageerror', (err) => consoleErrors.push(`[${vp.name}] pageerror: ${err.message}`))

      await page.goto(`${BASE_URL}/`)
      await page.waitForLoadState('networkidle')

      await page.screenshot({ path: join(OUT, `inicio-${vp.name}.png`), fullPage: true })
      if (vp.name === '390') {
        await page.screenshot({ path: join(OUT, `inicio-${vp.name}-viewport.png`) })
      }

      // Targets táctiles: los dos accesos de la cabecera.
      const buttons = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Pago' || a.textContent?.trim() === 'Alta')
        return links.map((l) => {
          const r = l.getBoundingClientRect()
          return { text: l.textContent?.trim(), width: r.width, height: r.height }
        })
      })
      console.log(vp.name, 'botones cabecera:', JSON.stringify(buttons))

      // Overflow horizontal.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      console.log(vp.name, 'overflow horizontal:', overflow)

      // Placeholder del buscador legible (no cortado).
      const searchPlaceholder = await page.evaluate(() => {
        const input = document.querySelector('input[type="search"]')
        return input ? input.getAttribute('placeholder') : null
      })
      console.log(vp.name, 'placeholder buscador:', searchPlaceholder)

      if (vp.name === '390') {
        // Barra inferior de admin: `MobileBottomNav` es la fija abajo — el
        // `DesktopNavList` comparte el mismo `aria-label` y está antes en el
        // DOM (oculto por CSS, no ausente), así que hay que apuntar al
        // contenedor fijo, no al primer `nav` que matchee el aria-label.
        const bottomNav = await page.evaluate(() => {
          const nav = document.querySelector('nav.fixed.inset-x-0.bottom-0')
          return nav ? [...nav.querySelectorAll('button, a')].map((el) => el.textContent?.trim()).join(' · ') : null
        })
        console.log(vp.name, 'barra inferior:', bottomNav)
      }

      await context.close()
    }

    console.log('---')
    console.log('errores de consola:', consoleErrors.length ? consoleErrors : 'ninguno')
    console.log(`Capturas guardadas en ${OUT}/`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
