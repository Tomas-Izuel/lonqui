import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, fakeSupabase, ok } from '../stubs/supabase-mock'

/**
 * `audit.model.ts` para las tres tablas de la caja (`cash_movements`,
 * `sponsors`, `cash_concepts`): lista de tablas auditables, etiqueta legible
 * del registro ("Concepto · Sponsor · $X · dd/mm/aaaa") resuelta con consultas
 * BATCH (una por tabla, sin N+1) y degradación elegante cuando un nombre no se
 * puede resolver (nunca un id crudo en pantalla).
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const { getAuditPage, getAuditEntry, AUDITED_TABLES, AUDIT_FIELD_LABELS } = await import('@/models/audit.model')

beforeEach(() => createClientMock.mockReset())

function auditRow(tableName: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    occurred_at: '2026-09-28T12:00:00Z',
    actor_id: null,
    actor_source: 'session',
    op: 'INSERT',
    table_name: tableName,
    record_id: '1',
    changed_fields: null,
    ...overrides,
  }
}

describe('tablas auditables de la caja', () => {
  it('cash_concepts, sponsors y cash_movements están en la lista que se puede filtrar en /auditoria', () => {
    for (const table of ['cash_concepts', 'sponsors', 'cash_movements']) {
      expect(AUDITED_TABLES).toContain(table)
    }
  })

  it('cada tabla tiene etiquetas de campo en español, y ninguna es el actor (created_by/voided_by/deactivated_by)', () => {
    for (const table of ['cash_concepts', 'sponsors', 'cash_movements'] as const) {
      const labels = AUDIT_FIELD_LABELS[table]
      expect(labels, table).toBeDefined()
      for (const hidden of ['created_by', 'voided_by', 'deactivated_by']) {
        expect(Object.keys(labels ?? {}), `${table}.${hidden}`).not.toContain(hidden)
      }
    }
    expect(AUDIT_FIELD_LABELS.cash_movements).toMatchObject({ amount_cents: 'monto', void_reason: 'motivo de anulación' })
    expect(AUDIT_FIELD_LABELS.sponsors).toMatchObject({ deactivation_reason: 'motivo de baja' })
  })
})

describe('getAuditPage: etiqueta de cash_movements', () => {
  it('"Concepto · Sponsor · $X · dd/mm/aaaa" con una consulta batch por tabla aunque haya varias filas (sin N+1)', async () => {
    const fake = fakeSupabase({
      from: {
        audit_log: [
          ok([
            auditRow('cash_movements', { id: 3, new_concept_id: '2', new_sponsor_id: '9', new_amount_cents: '1500000', new_occurred_on: '2026-09-15' }),
            auditRow('cash_movements', { id: 2, new_concept_id: '2', new_sponsor_id: '9', new_amount_cents: '500000', new_occurred_on: '2026-09-16' }),
            auditRow('cash_movements', { id: 1, new_concept_id: '4', new_sponsor_id: null, new_amount_cents: '250000', new_occurred_on: '2026-09-17' }),
          ]),
        ],
        cash_concepts: [ok([{ id: 2, name: 'Sponsor' }, { id: 4, name: 'Evento' }])],
        sponsors: [ok([{ id: 9, name: 'Corralón Inventado' }])],
      },
    })
    createClientMock.mockResolvedValue(fake.client)

    const page = await getAuditPage({})

    const labels = page.items.map((i) => i.recordLabel)
    expect(labels[0]).toMatch(/^Sponsor · Corralón Inventado · \$\s?15\.000 · 15\/09\/2026$/)
    expect(labels[1]).toMatch(/^Sponsor · Corralón Inventado · \$\s?5\.000 · 16\/09\/2026$/)
    // Sin sponsor: se omite ese tramo, no queda un "null" ni un doble separador.
    expect(labels[2]).toMatch(/^Evento · \$\s?2\.500 · 17\/09\/2026$/)
    expect(fake.count('from:cash_concepts')).toBe(1)
    expect(fake.count('from:sponsors')).toBe(1)
  })

  it('un UPDATE (anulación) toma los datos del old_data cuando new_data no los trae y sigue etiquetado', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({
        from: {
          audit_log: [ok([auditRow('cash_movements', { op: 'UPDATE', old_concept_id: '4', old_amount_cents: '250000', old_occurred_on: '2026-09-17' })])],
          cash_concepts: [ok([{ id: 4, name: 'Evento' }])],
        },
      }).client,
    )
    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toMatch(/^Evento · \$\s?2\.500 · 17\/09\/2026$/)
  })

  it('concepto y sponsor que no se pueden resolver (RLS o inexistentes): queda lo que sí se sabe, nunca un id crudo', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({
        from: {
          audit_log: [ok([auditRow('cash_movements', { new_concept_id: '77', new_sponsor_id: '88', new_amount_cents: '100000', new_occurred_on: '2026-09-01' })])],
          cash_concepts: [ok([])],
          sponsors: [ok([])],
        },
      }).client,
    )
    const page = await getAuditPage({})
    const label = page.items[0].recordLabel ?? ''
    expect(label).toMatch(/^\$\s?1\.000 · 01\/09\/2026$/)
    expect(label).not.toMatch(/77|88/)
  })

  it('sin ningún dato resoluble: label null', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { audit_log: [ok([auditRow('cash_movements', {})])] } }).client)
    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBeNull()
  })

  it('si las consultas auxiliares fallan, el error se propaga (no se muestra una etiqueta a medias)', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({
        from: {
          audit_log: [ok([auditRow('cash_movements', { new_concept_id: '2', new_amount_cents: '1', new_occurred_on: '2026-09-01' })])],
          cash_concepts: [fail('42501', 'permission denied')],
        },
      }).client,
    )
    await expect(getAuditPage({})).rejects.toMatchObject({ code: '42501' })
  })
})

describe('getAuditPage: etiqueta de sponsors y cash_concepts', () => {
  it('usan el nombre, y no consultan otras tablas para resolverlo', async () => {
    const fake = fakeSupabase({
      from: {
        audit_log: [
          ok([
            auditRow('sponsors', { id: 2, new_name: 'Panadería Inventada' }),
            auditRow('cash_concepts', { id: 1, new_name: 'Rifa' }),
          ]),
        ],
      },
    })
    createClientMock.mockResolvedValue(fake.client)
    const page = await getAuditPage({})
    expect(page.items.map((i) => i.recordLabel)).toEqual(['Panadería Inventada', 'Rifa'])
    expect(fake.count('from:sponsors')).toBe(0)
    expect(fake.count('from:cash_concepts')).toBe(0)
  })

  it('una baja o reactivación (UPDATE) conserva el nombre desde old_data', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { audit_log: [ok([auditRow('sponsors', { op: 'UPDATE', old_name: 'Panadería Inventada' })])] } }).client,
    )
    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Panadería Inventada')
  })
})

describe('getAuditEntry (detalle) de cash_movements', () => {
  it('resuelve la misma etiqueta desde el jsonb, con una consulta por tabla', async () => {
    const fake = fakeSupabase({
      from: {
        audit_log: [
          ok({
            id: 5,
            occurred_at: '2026-09-28T12:00:00Z',
            actor_id: null,
            actor_source: 'session',
            op: 'UPDATE',
            table_name: 'cash_movements',
            record_id: '8',
            changed_fields: ['voided_at', 'voided_by', 'void_reason'],
            old_data: { concept_id: 2, sponsor_id: 9, amount_cents: 1_500_000, occurred_on: '2026-09-15', void_reason: null },
            new_data: { concept_id: 2, sponsor_id: 9, amount_cents: 1_500_000, occurred_on: '2026-09-15', void_reason: 'Cargado dos veces' },
          }),
        ],
        cash_concepts: [ok([{ id: 2, name: 'Sponsor' }])],
        sponsors: [ok([{ id: 9, name: 'Corralón Inventado' }])],
      },
    })
    createClientMock.mockResolvedValue(fake.client)

    const entry = await getAuditEntry(5)

    expect(entry?.recordLabel).toMatch(/^Sponsor · Corralón Inventado · \$\s?15\.000 · 15\/09\/2026$/)
    expect(fake.count('from:cash_concepts')).toBe(1)
    expect(fake.count('from:sponsors')).toBe(1)
  })
})
