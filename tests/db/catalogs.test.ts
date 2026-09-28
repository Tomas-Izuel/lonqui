import { describe, expect, it } from 'vitest'
import {
  actAs,
  createCategory,
  createDiscipline,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  withRollback,
} from './helpers'

/**
 * S2 (`01-tasks.md`): disciplinas y categorías. Son datos, no enums: el club
 * las administra desde `/ajustes`, pero solo `admin` escribe.
 */
const dbAvailable = await isDbAvailable()

describe.skipIf(!dbAvailable)('disciplines / categories: RLS y unicidad', () => {
  it('consulta puede leer pero no insertar', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)

      const read = await client.query('select count(*) from public.disciplines')
      expect(Number(read.rows[0].count)).toBeGreaterThan(0)

      const err = await expectQueryError(client, `insert into public.disciplines (name) values ('Nueva Disciplina')`)
      expect(err.message).toMatch(/permission denied|row-level security/i)
    })
  })

  it('editor no puede insertar disciplinas (solo admin)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const insertErr = await expectQueryError(client, `insert into public.disciplines (name) values ('Handball')`)
      expect(insertErr.message).toMatch(/permission denied|row-level security/i)
    })
  })

  it('editor "puede" ejecutar el UPDATE de una disciplina (tiene el grant de columna) pero la RLS no le deja tocar NINGUNA fila', async () => {
    // Distinción importante: el grant de UPDATE es de tabla (§6.5 lo otorga a
    // `authenticated` en general), pero la policy `USING (is_admin())` filtra
    // qué filas puede ver para actualizar. Con RLS, eso no tira un error: el
    // UPDATE "tiene éxito" pero afecta cero filas. Un test que solo mirara
    // "no tira excepción" daría un falso verde a un agujero de seguridad.
    await withRollback(async (client) => {
      const discipline = await createDiscipline(client, { name: 'Fútbol de Prueba Editor' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const result = await client.query(`update public.disciplines set name = 'Nombre Cambiado' where id = $1`, [
        discipline,
      ])
      expect(result.rowCount).toBe(0)

      await actAs(client, userId) // rol sigue siendo editor, solo confirmamos que la fila no cambió
      const row = await client.query('select name from public.disciplines where id = $1', [discipline])
      expect(row.rows[0].name).toBe('Fútbol de Prueba Editor')
    })
  })

  it('editor no puede insertar categorías', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Vóley de Prueba Editor' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const insertErr = await expectQueryError(
        client,
        `insert into public.categories (discipline_id, name) values ($1, 'Sub 20')`,
        [disciplineId],
      )
      expect(insertErr.message).toMatch(/permission denied|row-level security/i)
    })
  })

  it('editor "puede" ejecutar el UPDATE de una categoría pero la RLS no le deja tocar ninguna fila', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Vóley de Prueba Editor 2' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Sub 18' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const result = await client.query(`update public.categories set name = 'Otro Nombre' where id = $1`, [
        categoryId,
      ])
      expect(result.rowCount).toBe(0)
    })
  })

  it('admin puede crear una disciplina y una categoría', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)

      const disciplineId = await createDiscipline(client, { name: 'Handball de Prueba Admin' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Mayores' })
      expect(categoryId).toBeGreaterThan(0)
    })
  })

  it('nombre duplicado en la misma disciplina, con distinto case, es unique_violation', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)

      const disciplineId = await createDiscipline(client, { name: 'Vóley de Prueba Dup' })
      await createCategory(client, { disciplineId, name: 'Sub 18' })

      const err = await expectQueryError(
        client,
        `insert into public.categories (discipline_id, name) values ($1, '  SUB 18  ')`,
        [disciplineId],
      )
      expect(err.code).toBe('23505')
    })
  })

  it('el mismo nombre de categoría en OTRA disciplina no choca (unicidad es por disciplina)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)

      const d1 = await createDiscipline(client, { name: 'Fútbol A de Prueba' })
      const d2 = await createDiscipline(client, { name: 'Fútbol B de Prueba' })

      await createCategory(client, { disciplineId: d1, name: 'Sub 18' })
      const categoryId = await createCategory(client, { disciplineId: d2, name: 'Sub 18' })
      expect(categoryId).toBeGreaterThan(0)
    })
  })

  it('disciplina duplicada (case-insensitive) también es unique_violation', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      await createDiscipline(client, { name: 'Básquet de Prueba' })
      const err = await expectQueryError(client, `insert into public.disciplines (name) values ('BÁSQUET DE PRUEBA')`)
      expect(err.code).toBe('23505')
    })
  })

  it('"dar de baja" una categoría es is_active=false, la fila sigue existiendo', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)

      const disciplineId = await createDiscipline(client, { name: 'Hockey de Prueba' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Mayores' })

      await client.query(`update public.categories set is_active = false where id = $1`, [categoryId])

      const row = await client.query('select is_active from public.categories where id = $1', [categoryId])
      expect(row.rowCount).toBe(1)
      expect(row.rows[0].is_active).toBe(false)
    })
  })
})
