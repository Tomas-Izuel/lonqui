/**
 * Traducciones específicas de `/auditoria`. `views/shared/labels.ts` ya trae
 * `auditOpLabels` (INSERT/UPDATE/DELETE/EXPORT → Creó/Modificó/Eliminó/
 * Exportó): se reusa desde acá. Lo que falta —tabla auditada y nombre de
 * columna— es propio de esta vista, así que vive acá y no en `views/shared`.
 */

import type { AuditedTable } from '@/models/types'

/** Filtro "tabla" de /auditoria (spec F3: "etiquetas en español"). */
export const AUDITED_TABLE_OPTIONS: { value: AuditedTable; label: string }[] = [
  { value: 'members', label: 'Socios' },
  { value: 'member_status_events', label: 'Altas y bajas' },
  { value: 'medical_clearances', label: 'Aptos físicos' },
  { value: 'family_groups', label: 'Grupos familiares' },
  { value: 'disciplines', label: 'Disciplinas' },
  { value: 'categories', label: 'Categorías' },
  { value: 'app_users', label: 'Usuarios' },
  { value: 'settings', label: 'Ajustes del club' },
  { value: 'member_categories', label: 'Inscripciones a categorías' },
  { value: 'fee_prices', label: 'Valores de cuota' },
  { value: 'fees', label: 'Cargos' },
  { value: 'payments', label: 'Pagos' },
]

/** Para componer "Creó/Modificó <entidad>" en el listado y el detalle. */
const ENTITY_LABELS: Record<AuditedTable, string> = {
  members: 'un socio',
  member_status_events: 'un evento de alta/baja',
  medical_clearances: 'un apto físico',
  family_groups: 'un grupo familiar',
  disciplines: 'una disciplina',
  categories: 'una categoría',
  app_users: 'un usuario',
  settings: 'los ajustes del club',
  member_categories: 'una inscripción a categoría',
  fee_prices: 'un valor de cuota',
  fees: 'un cargo',
  payments: 'un pago',
}

export function auditEntityLabel(tableName: string): string {
  return ENTITY_LABELS[tableName as AuditedTable] ?? tableName
}

/**
 * Complemento con el NOMBRE del registro ("a Ejemplo, Lucía", "la categoría
 * Fútbol masculino · 5ta") para componer con un verbo de `auditOpLabels`
 * ("Modificó a Ejemplo, Lucía"). Sin `recordLabel` (todavía null mientras el
 * backend lo puebla, o una tabla sin nombre propio como `settings`) cae al
 * genérico de `auditEntityLabel` ("un socio"), nunca al id crudo — el id es
 * secundario y solo aparece en el detalle (finish review, fix 3).
 */
const RECORD_PHRASE: Partial<Record<AuditedTable, (label: string) => string>> = {
  members: (label) => `a ${label}`,
  member_status_events: (label) => `un movimiento de alta o baja de ${label}`,
  medical_clearances: (label) => `el apto físico de ${label}`,
  family_groups: (label) => `el grupo familiar ${label}`,
  disciplines: (label) => `la disciplina ${label}`,
  categories: (label) => `la categoría ${label}`,
  app_users: (label) => `al usuario ${label}`,
}

export function auditRecordPhrase(tableName: string, recordLabel: string | null): string {
  if (!recordLabel) return auditEntityLabel(tableName)
  const phrase = RECORD_PHRASE[tableName as AuditedTable]
  return phrase ? phrase(recordLabel) : recordLabel
}

/** Solo el nombre del registro, sin preposición: para una columna propia (Qué) que ya lleva su verbo al lado (Operación). */
export function auditRecordName(tableName: string, recordLabel: string | null): string {
  return recordLabel ?? auditEntityLabel(tableName)
}

/**
 * Nombre en español de cada columna, por tabla. Cubre las columnas que
 * cambian en la práctica (según las migraciones `0001_foundation`,
 * `0002_catalogs`, `0003_members`); una columna nueva que no esté acá cae al
 * fallback (snake_case → "con espacios"), legible pero sin traducir — si
 * hace falta, se agrega acá, no se reinventa por vista.
 */
const FIELD_LABELS: Partial<Record<AuditedTable, Record<string, string>>> = {
  app_users: {
    display_name: 'nombre',
    role: 'rol',
    is_active: 'estado',
    must_change_password: 'contraseña temporal',
  },
  members: {
    first_name: 'nombre',
    last_name: 'apellido',
    dni: 'DNI',
    birth_date: 'fecha de nacimiento',
    address: 'domicilio',
    phone: 'teléfono',
    email: 'email',
    member_type: 'tipo de socio',
    category_id: 'categoría',
    family_group_id: 'grupo familiar',
    is_payment_responsible: 'responsable de pago',
    notes: 'notas',
    status: 'estado',
    status_changed_on: 'fecha de baja o reactivación',
  },
  member_status_events: {
    event_type: 'tipo de evento',
    effective_on: 'fecha',
    reason: 'motivo',
    notes: 'notas',
  },
  medical_clearances: {
    expires_on: 'vencimiento',
    storage_path: 'certificado',
    original_filename: 'archivo',
    notes: 'notas',
  },
  family_groups: {
    name: 'nombre',
    payer_contact_name: 'contacto de pago',
    payer_contact_phone: 'teléfono de contacto',
    notes: 'notas',
  },
  disciplines: { name: 'nombre', is_active: 'estado', sort_order: 'orden' },
  categories: { name: 'nombre', is_active: 'estado', sort_order: 'orden', discipline_id: 'disciplina' },
  settings: { club_name: 'nombre del club', billing_start_period: 'inicio de facturación' },
  // Slice 2 (cuotas y pagos): mismas columnas y mismo texto que
  // `AUDIT_FIELD_LABELS` en `src/models/audit.model.ts` — no se importa de
  // ahí (views/** no puede importar `@/models/*.model`, lint de
  // `eslint.config.mjs`), así que queda duplicado a propósito, como avisó el
  // agente de backend que lo dejó documentado.
  member_categories: {
    category_id: 'categoría',
    joined_on: 'fecha de alta en la categoría',
    left_on: 'fecha de baja de la categoría',
    left_reason: 'motivo de baja',
  },
  fee_prices: {
    scope: 'alcance',
    member_type: 'tipo de socio',
    category_id: 'categoría',
    amount_cents: 'monto',
    valid_from: 'vigente desde',
    notes: 'notas',
  },
  fees: {
    period: 'período',
    kind: 'tipo de cargo',
    amount_cents: 'monto',
    description: 'descripción',
    category_id: 'categoría',
    voided_at: 'anulación',
    void_reason: 'motivo de anulación',
  },
  payments: {
    amount_cents: 'monto',
    paid_on: 'fecha de pago',
    method: 'medio de pago',
    receipt_storage_path: 'comprobante',
    receipt_filename: 'archivo',
    notes: 'notas',
    voided_at: 'anulación',
    void_reason: 'motivo de anulación',
  },
}

function prettifyColumn(column: string): string {
  return column.replaceAll('_', ' ')
}

export function auditFieldLabel(tableName: string, column: string): string {
  return FIELD_LABELS[tableName as AuditedTable]?.[column] ?? prettifyColumn(column)
}
