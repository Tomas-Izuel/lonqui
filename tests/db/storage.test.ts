import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'

/**
 * S4 (`01-tasks.md`): bucket `attachments` privado. Las policies de
 * `storage.objects` son la defensa real (Ley 25.326: nunca un bucket
 * público). Probamos directo contra Postgres, igual que el resto de
 * `tests/db/`: `storage.objects` no tiene FORCE RLS, pero sigue aplicando
 * para cualquier rol que no sea el dueño de la tabla (`authenticated` no lo
 * es), así que esto prueba la defensa de verdad, no un detalle de
 * implementación de la API HTTP de Storage.
 */
const dbAvailable = await isDbAvailable()

const STORAGE_URL = 'http://127.0.0.1:54321/storage/v1'
// Clave secreta del stack LOCAL (la del CLI de Supabase). No se escribe en el
// repo: el push protection de GitHub la trata como un secreto real, y una
// clave hardcodeada es una mala costumbre aunque esta sea de demo.
// Orden: `LONQUI_TEST_SECRET_KEY` (override explícito) > `supabase status`
// (la clave del stack que de verdad está corriendo) > `SUPABASE_SECRET_KEY`.
// Esta última va al final a propósito: en CI el job la define con un
// placeholder (`ci-placeholder-secret-key`) solo para que compile el build de
// Next, y el Storage local la rechaza con "Invalid Compact JWS". Si ganara el
// env, estos tests pegarían con una clave inválida.
function localSecretKey(): string | undefined {
  if (process.env.LONQUI_TEST_SECRET_KEY) return process.env.LONQUI_TEST_SECRET_KEY
  try {
    const status = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const fromStatus = (JSON.parse(status) as { SECRET_KEY?: string }).SECRET_KEY
    if (fromStatus) return fromStatus
  } catch {
    // sin CLI o sin stack: caemos al env.
  }
  return process.env.SUPABASE_SECRET_KEY
}
const SERVICE_ROLE_KEY = dbAvailable ? localSecretKey() : undefined

describe.skipIf(!dbAvailable)('storage.objects: RLS del bucket attachments', () => {
  it('el bucket attachments es privado y tiene el límite/MIME esperados (S4)', async () => {
    await withRollback(async (client) => {
      const bucket = await client.query(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'`,
      )
      expect(bucket.rowCount).toBe(1)
      expect(bucket.rows[0].public).toBe(false)
      expect(Number(bucket.rows[0].file_size_limit)).toBe(10 * 1024 * 1024)
      expect(bucket.rows[0].allowed_mime_types.sort()).toEqual(
        ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].sort(),
      )
    })
  })

  it('consulta NO puede insertar un objeto', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into storage.objects (bucket_id, name) values ('attachments', $1)`,
        [`medical-clearances/1/${crypto.randomUUID()}.jpg`],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('editor SÍ puede insertar en el prefijo medical-clearances/', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const result = await client.query(
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2) returning id`,
        [`medical-clearances/1/${crypto.randomUUID()}.jpg`, userId],
      )
      expect(result.rowCount).toBe(1)
    })
  })

  it('editor SÍ puede insertar en el prefijo payment-receipts/ (slice 2, ya habilitado en la policy)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const result = await client.query(
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2) returning id`,
        [`payment-receipts/1/${crypto.randomUUID()}.pdf`, userId],
      )
      expect(result.rowCount).toBe(1)
    })
  })

  it('editor NO puede insertar fuera de los prefijos conocidos', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`,
        [`otra-carpeta/1/${crypto.randomUUID()}.jpg`, userId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('admin también puede insertar (no es exclusivo de editor)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)

      const result = await client.query(
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2) returning id`,
        [`medical-clearances/2/${crypto.randomUUID()}.png`, userId],
      )
      expect(result.rowCount).toBe(1)
    })
  })

  it('cualquier rol activo puede LEER (para poder firmar URLs)', async () => {
    await withRollback(async (client) => {
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const path = `medical-clearances/3/${crypto.randomUUID()}.jpg`
      await client.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
        path,
        editorId,
      ])

      await actAsSuperuser(client)
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const read = await client.query(`select name from storage.objects where bucket_id = 'attachments' and name = $1`, [
        path,
      ])
      expect(read.rowCount).toBe(1)
    })
  })

  it('nadie actualiza un objeto ya subido (sin policy de UPDATE: 0 filas afectadas, no un reemplazo silencioso)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const path = `medical-clearances/4/${crypto.randomUUID()}.jpg`
      await client.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
        path,
        userId,
      ])

      const result = await client.query(`update storage.objects set name = $1 where bucket_id = 'attachments' and name = $2`, [
        `${path}-renombrado`,
        path,
      ])
      expect(result.rowCount).toBe(0)
    })
  })

  it('nadie borra un objeto ya subido: storage tiene su PROPIO guard append-only, más estricto que "0 filas"', async () => {
    // Hallazgo al escribir este test: `storage.objects` no se queda solo en
    // "sin policy de DELETE" (que daría 0 filas en silencio) — Supabase le
    // agrega un trigger propio que RECHAZA el DELETE directo con un mensaje
    // explícito, incluso antes de que RLS entre en juego. Doble defensa.
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const path = `medical-clearances/5/${crypto.randomUUID()}.jpg`
      await client.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
        path,
        userId,
      ])

      const err = await expectQueryError(client, `delete from storage.objects where bucket_id = 'attachments' and name = $1`, [
        path,
      ])
      expect(err.message).toMatch(/not allowed|permission denied|row-level security/i)

      await actAsSuperuser(client)
      const stillThere = await client.query(`select 1 from storage.objects where bucket_id = 'attachments' and name = $1`, [
        path,
      ])
      expect(stillThere.rowCount).toBe(1)
    })
  })
})

describe.skipIf(!dbAvailable)('storage.objects: prefijo cash-receipts/ (caja de otros ingresos)', () => {
  const cashPath = () => `cash-receipts/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`

  it('editor y admin pueden subir a cash-receipts/ (income.register)', async () => {
    await withRollback(async (client) => {
      for (const role of ['editor', 'admin'] as const) {
        const { userId } = await createUserWithRole(client, role)
        await actAs(client, userId)
        const result = await client.query(
          `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2) returning id`,
          [cashPath(), userId],
        )
        expect(result.rowCount, role).toBe(1)
        await actAsSuperuser(client)
      }
    })
  })

  it('consulta NO puede subir a cash-receipts/ (solo tiene income.read)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const err = await expectQueryError(
        client,
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`,
        [cashPath(), userId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('anon NO puede subir ni leer cash-receipts/', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const path = cashPath()
      await client.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [path, userId])

      await actAsSuperuser(client)
      await client.query('set local role anon')
      const read = await client.query(`select name from storage.objects where bucket_id = 'attachments' and name = $1`, [path])
      expect(read.rowCount).toBe(0)
      const err = await expectQueryError(
        client,
        `insert into storage.objects (bucket_id, name) values ('attachments', $1)`,
        [cashPath()],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('un usuario sin rol (user_metadata.role = admin) no sube a cash-receipts/', async () => {
    await withRollback(async (client) => {
      const ghost = crypto.randomUUID()
      await actAs(client, ghost, { extraClaims: { user_metadata: { role: 'admin' } } })
      const err = await expectQueryError(
        client,
        `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`,
        [cashPath(), ghost],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('el prefijo se compara exacto: "cash-receipts-x/" y un cash-receipts anidado no pasan', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      for (const name of [`cash-receipts-x/1/${crypto.randomUUID()}.pdf`, `otro/cash-receipts/${crypto.randomUUID()}.pdf`]) {
        const err = await expectQueryError(client, `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [name, userId])
        expect(err.message, name).toMatch(/row-level security|permission denied/i)
      }
    })
  })

  it('consulta SÍ lee lo subido a cash-receipts/ (para firmar la URL), y los prefijos viejos siguen habilitados para editor', async () => {
    await withRollback(async (client) => {
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const path = cashPath()
      await client.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [path, editorId])
      for (const prefix of ['medical-clearances', 'payment-receipts']) {
        const ok = await client.query(
          `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2) returning id`,
          [`${prefix}/1/${crypto.randomUUID()}.jpg`, editorId],
        )
        expect(ok.rowCount, prefix).toBe(1)
      }

      await actAsSuperuser(client)
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const read = await client.query(`select name from storage.objects where bucket_id = 'attachments' and name = $1`, [path])
      expect(read.rowCount).toBe(1)
    })
  })

  it('consulta sigue sin poder subir a los prefijos viejos (no se aflojó nada)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      for (const prefix of ['medical-clearances', 'payment-receipts']) {
        const err = await expectQueryError(client, `insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [
          `${prefix}/1/${crypto.randomUUID()}.jpg`,
          userId,
        ])
        expect(err.message, prefix).toMatch(/row-level security|permission denied/i)
      }
    })
  })

  it('el bucket sigue siendo privado', async () => {
    await withRollback(async (client) => {
      const bucket = await client.query(`select public from storage.buckets where id = 'attachments'`)
      expect(bucket.rows[0].public).toBe(false)
    })
  })
})

/**
 * Estos pegan a la API HTTP real de Storage (no solo a Postgres): la
 * validación de `allowed_mime_types`/`file_size_limit` la hace el servicio de
 * Storage al recibir el archivo, no una policy de RLS ni un CHECK de la
 * base — así que sin esto, un MIME fuera de la lista nunca se prueba de
 * verdad. Se saltea si no hay `service_role` key disponible (mismo criterio
 * que el resto: nunca bloquear `npm test` sin el stack).
 */
describe.skipIf(!dbAvailable || !SERVICE_ROLE_KEY)('Storage API: el bucket rechaza lo que no debería aceptar', () => {
  it('un MIME fuera de la lista (application/zip) es rechazado por el bucket', async () => {
    const path = `medical-clearances/999/${crypto.randomUUID()}.zip`
    const response = await fetch(`${STORAGE_URL}/object/attachments/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY!}`,
        apikey: SERVICE_ROLE_KEY!,
        'Content-Type': 'application/zip',
      },
      body: new Uint8Array([1, 2, 3, 4]),
    })
    const text = await response.text()
    expect(response.ok, text).toBe(false)
    // Que sea el rechazo por MIME y no cualquier 4xx (una clave inválida
    // también devuelve 4xx y dejaría pasar el test en falso).
    let body: { error?: string; code?: string } = {}
    try {
      body = JSON.parse(text)
    } catch {
      // body no JSON: las aserciones de abajo fallan con el texto crudo.
    }
    expect(
      body.error === 'invalid_mime_type' || body.code === 'InvalidMimeType',
      `se esperaba invalid_mime_type, llegó ${response.status}: ${text}`,
    ).toBe(true)
  })

  it('un MIME de la lista (image/png) es aceptado por el bucket', async () => {
    const path = `medical-clearances/999/${crypto.randomUUID()}.png`
    // 1x1 PNG válido mínimo.
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
        '53de0000000c4944415408d763f8cfc0c00000030101003a9c3873000000004945' +
        '4e44ae426082',
      'hex',
    )
    const response = await fetch(`${STORAGE_URL}/object/attachments/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY!}`,
        apikey: SERVICE_ROLE_KEY!,
        'Content-Type': 'image/png',
      },
      body: pngBytes,
    })
    const text = await response.text()
    try {
      expect(response.ok, `upload png: ${response.status} ${text}`).toBe(true)
    } finally {
      // Limpieza: el objeto de prueba no debe quedar en el bucket real.
      await fetch(`${STORAGE_URL}/object/attachments/${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY!}`, apikey: SERVICE_ROLE_KEY! },
      })
    }
  })
})
