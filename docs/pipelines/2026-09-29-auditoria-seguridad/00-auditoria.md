# Auditoría de seguridad — 2026-09-29

Cuatro agentes en paralelo, solo lectura: endpoints/auth, secretos,
Storage/costos y estándares (OWASP Top 10 / ASVS L2). Análisis estático del
código y las migraciones: el stack local no estaba levantado, así que **no se
probó anon contra PostgREST/Storage en vivo**. La configuración del proyecto
hosted y de Vercel no se puede ver desde el repo.

**Veredicto**: ningún recurso accesible sin sesión, ningún secreto en git ni en
el bundle, adjuntos sin acceso anónimo. Sin hallazgos críticos en el código.

## Resuelto en esta tanda

| # | Hallazgo | Acción |
|---|---|---|
| 1 | Next.js 16.3.3 afectado por avisos de seguridad (RCE en `next/og` `ImageResponse`, GHSA-vcvr-r3jv-pc5j, `>=16.2.0 <16.3.6`; tanda de 9 CVEs en 16.3.7). La app no usa `next/og` | `next` y `eslint-config-next` a **16.3.7**. typecheck, lint, tests y build verdes |

## Pendiente — código (necesita pipeline)

| # | Sev. | Hallazgo | Dónde | Arreglo propuesto |
|---|---|---|---|---|
| 2 | Media | El editor sube a Storage directo desde el browser; la policy solo mira el prefijo. Puede llenar la cuota (5 GB contractuales) con basura que nadie puede borrar | `supabase/migrations/20260925120300_storage.sql:19-25` (`attachments_insert`) | Migración: `name ~ '^(medical-clearances\|payment-receipts)/[0-9]+/[0-9a-f-]{36}\.(jpg\|png\|webp\|pdf)$'`. Job que reporte objetos huérfanos |
| 3 | Media | Errores no-dominio se loguean con `message`/`stack` completos: una unique violation de Postgres trae `Key (dni)=(…)`. Viola Ley 25.326 / regla de no loguear PII | `src/lib/log.ts:24-32`, `src/lib/errors.ts` (`toApiError`) | Para errores de PostgREST/pg loguear solo `code` + constraint/tabla, nunca `message`/`details`/`hint` |
| 4 | Media | Login sin throttling propio. `signInWithPassword` corre en la Server Action: GoTrue ve la IP de Vercel. O el límite de 30/5 min es global (lockout de todos) o no frena a nadie | `src/controllers/auth.actions.ts:20-59`, `config.toml` `[auth.rate_limit]` | CAPTCHA (Turnstile) en Auth hosted + regla de rate limit del WAF de Vercel sobre el POST de login. Verificar cómo llega la IP real a GoTrue |
| 5 | Baja | `log_export` (SECURITY DEFINER) deja que cualquier rol con `reports.export` (incluido `consulta`) inserte filas EXPORT ilimitadas con `filters`/`row_count` elegidos por el cliente en un log append-only | `supabase/migrations/20260927130200_accounts.sql:715-750` | Escribir la fila EXPORT desde la misma RPC que devuelve los datos, con `row_count` real; o rate limit por actor |
| 6 | Baja | `resetUserPassword` y `completeUser` cambian la contraseña de Auth antes de verificar que existe la fila de `app_users`: si falla, queda un reseteo sin auditoría ni `must_change_password` | `src/controllers/users.actions.ts:94-100`, `:130-141` | Verificar `getAppUser(userId)` (o `markPasswordReset`) antes de `setPassword` |
| 7 | Baja | El path del comprobante solo se valida por prefijo: un pago puede apuntar al comprobante de otro socio. `medical_clearances.storage_path` no tiene CHECK | `src/models/payments.model.ts:77-94`, `members.actions.ts:262-282` | Exigir `payment-receipts/<memberId>/…` del socio del pago; CHECK en `medical_clearances.storage_path` |
| 8 | Baja | `DomainError(error.message)` sin allow-list: el texto crudo de una constraint puede llegar a la UI | `src/models/member-categories.model.ts:108`, `src/models/fee-prices.model.ts:177` | Allow-list por `error.code` como en `fees.model.ts:60` |
| 9 | Baja | Sin CSP de scripts (solo `frame-ancestors`) ni HSTS explícito | `next.config.ts:12-21` | CSP con nonce vía `proxy.ts`, o mínima: `default-src 'self'; img-src 'self' data: blob: <supabase>; connect-src 'self' <supabase>; object-src 'none'; base-uri 'self'; form-action 'self'`. HSTS `max-age=63072000; includeSubDomains` |
| 10 | Baja | Cursores de `.or()`: `typeof === 'number'` acepta `1e21`. Sin impacto (RLS acota), endurecer | `src/models/members.model.ts:311-318` (y `audit.model.ts:684`, `payments.model.ts:402`) | `Number.isSafeInteger` |
| 11 | Baja | `sizeBytes`/`mimeType` los declara el cliente; Storage valida el Content-Type, no los magic bytes | `src/models/medical-clearances.model.ts:37-42` | `download: true` en `createSignedUrl` para que nunca se renderice inline |
| 12 | Baja | Actions que reciben `id: number` suelto sin Zod (`updateMember`, `updateDiscipline`, `updateCategory`, `updateMedicalClearance`). Sin exploit (RLS + `.eq` codificado) | `src/controllers/*.actions.ts` | `z.number().int().positive()` |
| 13 | Info | `public/Logo.png` (1,6 MB, sin trackear, no usado) se serviría sin auth y con tráfico facturable | `public/Logo.png` | No commitearlo así; achicarlo o usar `next/image` |
| 14 | Info | `graphql_public` expuesto en `[api] schemas` | `supabase/config.toml` | Si no se usa GraphQL, sacarlo y desactivar `pg_graphql` en hosted |

## Pendiente — feature todavía no construido

**Exportación CSV** (Fase 1, contrato 10.2). Cuando se construya:
- Escapar inyección de fórmulas: prefijar con `'` toda celda que empiece con
  `= + - @ \t \r` (nombres, domicilios y motivos son texto del usuario).
- Auditar la exportación desde la misma RPC que devuelve los datos (ver #5).
- Exportación completa del club como script, no como proyecto.

## Pendiente — operativo (fuera del repo)

**Máquina del desarrollador**
- `.env.prod` tiene la secret key hosted, la contraseña de la base y
  `DEV_ADMIN_PASSWORD` en texto plano. Nunca entró a git. Mover a Vercel /
  gestor de contraseñas y borrar el archivo, o como mínimo `chmod 600`.
- `DEV_ADMIN_PASSWORD` es igual en `.env.local` y `.env.prod`: si el admin
  hosted usa esa contraseña, rotarla y usar `--temporary`.
- Opcional: `permissions.deny` de `Read(.env*)` en la config de Claude Code
  (lo decide Tomás).

**Dashboard de Supabase hosted** (`config.toml` solo manda en local)
- `[auth] enable_signup` apagado; anonymous sign-ins apagado.
- Data API expone solo `public` (nunca `private`: `authenticated` tiene EXECUTE
  sobre helpers de ahí).
- `site_url` y redirect URLs con el dominio real, sin localhost.
- `secure_password_change` coherente con el flujo de `changePassword`.
- CAPTCHA (Turnstile/hCaptcha) y rate limit de sign-in más bajo (5–10).
- Leaked password protection (HaveIBeenPwned, Pro).
- MFA TOTP para `admin` (datos de menores).
- Spend cap y alerta de uso de Storage.
- No crear claves de acceso S3.

**Vercel**
- Regla de WAF con rate limit sobre el login y los POST de Server Actions.
- Confirmar HSTS en el dominio propio.

**Dependencias**
- Renovate o Dependabot para no volver a quedar atrás en los releases de
  seguridad de Next.
- `npm audit`: 0 en producción; 2 moderadas en vitest/@vitest/mocker (solo
  dev, el fix es vitest 5, breaking).

## Sin verificar

- Pruebas en vivo con la publishable key contra `127.0.0.1` (REST, RPC,
  Storage) y `pg_default_acl`. Cerrar con `npm run db:start` + `npm test`
  (`tests/db/grants-and-lockdown.test.ts`, `tests/db/storage.test.ts`).
- Toda la configuración hosted listada arriba.

## Verificado OK

- **Server Actions**: todas llaman a `requireRole`/`requirePermission` antes de
  hacer nada y parsean con Zod `.strict()`. Excepciones intencionales:
  `signIn`, `signOut`, `changePassword`.
- **Rutas**: no hay `route.ts` ni `src/app/api`. Toda page del panel pasa por
  `requirePanelAccess`/`requirePanelPermission`, y las de `(admin)` se guardan
  solas.
- **`proxy.ts`** solo refresca la sesión, así que un bypass de middleware
  (CVE-2025-29927) no rompe nada.
- **Admin client**: solo en `auth-admin.service.ts`, detrás de
  `requireRole('admin')` + Zod. Storage usa siempre el cliente de sesión.
- **RLS y grants**:
  - Las 14 tablas tienen RLS activado y forzado.
  - `anon` no tiene ningún grant. No hay `grant delete` sobre ninguna tabla.
  - Los grants son por columna.
  - Ninguna policy usa `using (true)`.
  - Los INSERT exigen `created_by = auth.uid()`.
- **SECURITY DEFINER**: todas con `set search_path = ''`. Las de `public`
  chequean el permiso en el cuerpo y no tienen EXECUTE para `public`/`anon`.
- **Auditoría**:
  - Trigger `enable always` que rechaza UPDATE/DELETE/TRUNCATE.
  - SELECT solo para admin.
  - El actor sale de `auth.uid()`.
- **Storage**:
  - Bucket privado, 10 MiB, allowlist de MIME.
  - Sin policies de UPDATE/DELETE.
  - URLs firmadas de 60 s, construidas desde el path en la base (sin IDOR).
  - Path armado en el servidor con UUID (sin path traversal).
  - Subida directa desde el browser, así que no aplica el límite de 4,5 MB de
    Vercel.
- **Imágenes**: sin `remotePatterns`, el optimizador no es un proxy abierto.
- **Secretos**:
  - Nada en el historial de git.
  - `.gitignore` cubre `.env*`, `docs/relevamiento/`, `.pem`, dumps.
  - El bundle del cliente solo tiene la publishable key.
  - `server-only` en `env.server.ts` y `admin.ts`.
  - CI con placeholders.
- **Errores**: `DomainError` vs genérico; `zodToApiError` devuelve el primer
  issue.
- **Web**:
  - X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy,
    `poweredByHeader: false`.
  - `robots` en noindex.
  - `safe-redirect.ts` robusto contra open redirect.
  - El login no enumera usuarios.
  - CSRF cubierto por el chequeo de Origin de Next en las Server Actions.
  - Sin `dangerouslySetInnerHTML`.
