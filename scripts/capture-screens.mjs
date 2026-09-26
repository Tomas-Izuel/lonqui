#!/usr/bin/env node
/**
 * Capturas reales del panel a 390×844 (celular, el diseño de referencia) y
 * 1440×900 (escritorio), contra el servidor que esté corriendo en BASE_URL.
 *
 * Existe porque el navegador compartido de los agentes no baja de ~600px de
 * ancho: "mobile first indispensable" se verifica a 390px de verdad, en un
 * contexto aislado (cookies propias), no a ojo.
 *
 * Uso:
 *   npm run build && npx next start -p 3210 &
 *   BASE_URL=http://localhost:3210 node scripts/capture-screens.mjs [--out dir]
 *
 * Además prueba un caso que un screenshot no muestra: si a un usuario le
 * prenden el flag de contraseña temporal con la sesión abierta, su próximo
 * click en la navegación lo tiene que llevar a /cambiar-contrasena.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3210'
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex > -1 ? process.argv[outIndex + 1] : '.impeccable/review/screens'
const ADMIN = { email: 'admin@lonqui.test', password: process.env.DEV_ADMIN_PASSWORD ?? 'lonqui-dev-1234' }
const EDITOR = { email: 'editor@lonqui.test', password: 'lonqui-dev-1234' }

const VIEWPORTS = [
  { name: '390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
]

function psql(sql) {
  return execFileSync('docker', ['exec', 'supabase_db_lonqui', 'psql', '-U', 'postgres', '-tAc', sql], {
    encoding: 'utf8',
  }).trim()
}

async function login(page, { email, password }) {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

async function shoot(page, name, viewport) {
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(OUT, `${name}-${viewport}.png`), fullPage: true })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const memberId = psql("select id from public.members where status = 'active' and family_group_id is not null order by id limit 1")

  const browser = await chromium.launch()
  try {
    for (const vp of VIEWPORTS) {
      const { name: _name, ...contextOptions } = vp
      const context = await browser.newContext(contextOptions)
      const page = await context.newPage()

      await page.goto(`${BASE_URL}/login`)
      await shoot(page, 'login', vp.name)

      await login(page, ADMIN)
      const routes = [
        ['inicio', '/'],
        ['socios', '/socios'],
        ['socios-nuevo', '/socios/nuevo'],
        ['socio', `/socios/${memberId}`],
        ['socio-editar', `/socios/${memberId}/editar`],
        ['usuarios', '/usuarios'],
        ['ajustes', '/ajustes'],
        ['auditoria', '/auditoria'],
      ]
      for (const [name, path] of routes) {
        await page.goto(`${BASE_URL}${path}`)
        await shoot(page, name, vp.name)
      }
      console.log(`viewport ${vp.name}: innerWidth = ${await page.evaluate(() => window.innerWidth)}px`)

      // Overflow horizontal: en el celular no puede haber scroll de costado.
      if (vp.isMobile) {
        for (const [name, path] of routes) {
          await page.goto(`${BASE_URL}${path}`)
          await page.waitForLoadState('networkidle')
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          console.log(`${overflow > 0 ? '✗' : '✓'} overflow horizontal ${name} @390: ${overflow}px`)
        }
      }

      await context.close()
    }

    // Flag de contraseña temporal prendido a mitad de sesión.
    const { name: _mobileName, ...mobileOptions } = VIEWPORTS[0]
    const context = await browser.newContext(mobileOptions)
    const page = await context.newPage()
    await login(page, EDITOR)
    await page.goto(`${BASE_URL}/`)
    await page.waitForLoadState('networkidle')
    psql("update public.app_users set must_change_password = true where email = 'editor@lonqui.test'")
    try {
      await page.getByRole('navigation').getByRole('link', { name: 'Socios' }).first().click()
      // Navegación del lado del cliente: no dispara 'load', hay que esperar la URL.
      await page.waitForURL((url) => url.pathname === '/cambiar-contrasena', { timeout: 10_000 }).catch(() => {})
      const landed = new URL(page.url()).pathname
      console.log(`${landed === '/cambiar-contrasena' ? '✓' : '✗'} flag a mitad de sesión → ${landed}`)
      await shoot(page, 'flag-mid-session', '390')
    } finally {
      psql("update public.app_users set must_change_password = false where email = 'editor@lonqui.test'")
      await context.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`Capturas en ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
