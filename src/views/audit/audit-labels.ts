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
}

export function auditEntityLabel(tableName: string): string {
  return ENTITY_LABELS[tableName as AuditedTable] ?? tableName
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
}

function prettifyColumn(column: string): string {
  return column.replaceAll('_', ' ')
}

export function auditFieldLabel(tableName: string, column: string): string {
  return FIELD_LABELS[tableName as AuditedTable]?.[column] ?? prettifyColumn(column)
}
