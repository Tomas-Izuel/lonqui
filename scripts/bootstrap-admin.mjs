#!/usr/bin/env node
// Bootstrap del primer admin (D9, pipeline 2026-09-25-padron-roles-auditoria).
//
// Node ESM puro: sin TypeScript, sin imports de `src/` (corre standalone, sin
// depender de que exista un build de Next). Se ejecuta con:
//
//   node --env-file=.env.local scripts/bootstrap-admin.mjs [--force-change|--temporary]
//
// `db-reset.sh` lo llama al final de cada reset local, reenviando los flags.
//
// Modos:
//   (default, local)  usa DEV_ADMIN_EMAIL/DEV_ADMIN_PASSWORD/DEV_ADMIN_NAME de
//                     .env.local, nace con must_change_password = false
//                     (comodidad de desarrollo).
//   --force-change    igual, pero nace con el flag prendido: para probar el
//                     flujo de cambio obligatorio en local.
//   --temporary       (hosted) ignora DEV_ADMIN_PASSWORD, genera una temporal,
//                     la imprime UNA sola vez por stdout y nace con el flag
//                     prendido. Pensado para correr una única vez contra el
//                     proyecto hosted.
//
// Idempotente: si el email ya existe en Auth y en `app_users`, no falla ni
// rota la contraseña — solo lo confirma.
//
// Actor de auditoría: este INSERT queda con `actor_source = 'system'` (sin
// `actor_id`) porque no hay una RPC para fijar `set_config('app.actor_id', …)`
// antes de escribir con `service_role` — ver el dev log de B1
// (docs/pipelines/2026-09-25-padron-roles-auditoria/02-development-backend-b1.md)
// para la RPC que haría falta si se quiere actor explícito.

import { createClient } from '@supabase/supabase-js'

function fail(message) {
  console.error(`[bootstrap-admin] ${message}`)
  process.exit(1)
}

const flags = new Set(process.argv.slice(2))
const forceChange = flags.has('--force-change')
const temporary = flags.has('--temporary')

if (forceChange && temporary) {
  fail('--force-change y --temporary no se usan juntos: --temporary ya nace con el flag prendido.')
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY
const rawEmail = process.env.DEV_ADMIN_EMAIL
const displayName = process.env.DEV_ADMIN_NAME
const password = process.env.DEV_ADMIN_PASSWORD

if (!SUPABASE_URL) fail('Falta NEXT_PUBLIC_SUPABASE_URL (¿corriste con --env-file=.env.local?).')
if (!SECRET_KEY) fail('Falta SUPABASE_SECRET_KEY: sin esta clave no se puede crear el primer admin.')
if (!rawEmail) fail('Falta DEV_ADMIN_EMAIL.')
if (!displayName) fail('Falta DEV_ADMIN_NAME.')
if (!temporary && !password) fail('Falta DEV_ADMIN_PASSWORD (no hace falta con --temporary).')

const email = rawEmail.trim().toLowerCase()

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// -----------------------------------------------------------------------------
// Mismo alfabeto y forma que `generateTemporaryPassword` de `src/lib/passwords.ts`.
// No se importa de ahí a propósito (este script no depende de `src/`): si se
// cambia uno, hay que cambiar el otro a mano.
// -----------------------------------------------------------------------------
const LETTERS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALPHABET = LETTERS + DIGITS
const PASSWORD_LENGTH = 12

function randomIndex(max) {
  const limit = 256 - (256 % max)
  const buffer = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % max
  }
}

function generateTemporaryPassword() {
  const chars = Array.from({ length: PASSWORD_LENGTH }, () => ALPHABET[randomIndex(ALPHABET.length)])
  const letterSlot = randomIndex(PASSWORD_LENGTH)
  let digitSlot = randomIndex(PASSWORD_LENGTH - 1)
  if (digitSlot >= letterSlot) digitSlot += 1
  chars[letterSlot] = LETTERS[randomIndex(LETTERS.length)]
  chars[digitSlot] = DIGITS[randomIndex(DIGITS.length)]
  return chars.join('')
}

/** `listUsers` no tiene filtro por email: hay que paginar hasta encontrarlo o agotar. */
async function findAuthUserByEmail(targetEmail) {
  const perPage = 200
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) fail(`No pudimos listar usuarios de Auth: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail)
    if (found) return found
    if (!data.nextPage) return null
    page = data.nextPage
  }
}

async function main() {
  const existingAuthUser = await findAuthUserByEmail(email)

  let userId
  let printedTemporary = null

  if (existingAuthUser) {
    userId = existingAuthUser.id
    console.log(`[bootstrap-admin] Ya existe en Auth (user_id=${userId}). No se toca la contraseña.`)
  } else {
    const initialPassword = temporary ? generateTemporaryPassword() : password

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
    })
    if (error || !data?.user) {
      fail(`No pudimos crear el usuario en Auth: ${error?.message ?? 'sin detalle'}`)
    }

    userId = data.user.id
    if (temporary) printedTemporary = initialPassword
    console.log(`[bootstrap-admin] Usuario de Auth creado (user_id=${userId}).`)
  }

  const { data: existingRow, error: selectError } = await admin
    .from('app_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (selectError) fail(`No pudimos leer app_users: ${selectError.message}`)

  const mustChangePassword = temporary || forceChange

  if (existingRow) {
    // Idempotente de verdad: una fila que YA existe no se toca, ni siquiera
    // para volver a prender `must_change_password`. Si esto llamara a
    // `mark_password_reset` acá, un segundo `--temporary` contra el proyecto
    // hosted (por error, ya con el admin usando el sistema) le volvería a
    // exigir cambiar la contraseña sin haber tocado la real y sin imprimir
    // ninguna temporal nueva.
    console.log('[bootstrap-admin] Ya existe la fila en app_users. No se modifica nada.')
  } else {
    // service_role bypasea RLS. El actor de auditoría queda 'system' (ver
    // encabezado): no hay hoy una RPC para fijar un actor explícito acá.
    const { error: insertError } = await admin.from('app_users').insert({
      user_id: userId,
      email,
      display_name: displayName,
      role: 'admin',
      is_active: true,
      must_change_password: mustChangePassword,
    })
    if (insertError) fail(`No pudimos crear la fila en app_users: ${insertError.message}`)
    console.log(
      `[bootstrap-admin] Fila creada en app_users (role=admin, must_change_password=${mustChangePassword}).`,
    )

    if (mustChangePassword) {
      // Sin este marker, `confirm_password_changed()` no tiene contra qué
      // comparar el hash y la persona queda trabada la primera vez que
      // intente cambiar la contraseña. Solo tiene sentido junto con el INSERT
      // de arriba: es la fila recién creada la que nace con el flag prendido.
      const { error: rpcError } = await admin.rpc('mark_password_reset', { target_user_id: userId })
      if (rpcError) fail(`No pudimos preparar el cambio de contraseña obligatorio: ${rpcError.message}`)
      console.log('[bootstrap-admin] must_change_password prendido y marker guardado.')
    }
  }

  if (printedTemporary) {
    console.log('')
    console.log('[bootstrap-admin] Contraseña temporal (se muestra UNA sola vez, no se guarda en ningún lado):')
    console.log(printedTemporary)
    console.log('')
  }

  console.log(`[bootstrap-admin] Listo. user_id=${userId} email=${email}`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
