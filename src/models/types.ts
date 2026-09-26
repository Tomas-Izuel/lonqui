/**
 * Vocabulario del dominio. Solo tipos, sin runtime.
 *
 * Es el contrato que comparten modelos, controllers y vistas: si algo cambia
 * de forma, se cambia acá y TypeScript señala qué más tocar. Los nombres son
 * en inglés; las etiquetas en español viven en `src/views/shared/labels.ts`.
 *
 * Fechas: `string` ISO siempre. `YYYY-MM-DD` para `date` de Postgres (fechas de
 * vida, períodos), ISO completo para `timestamptz`. Nunca `Date`: no cruza el
 * borde server/client y arrastra la zona horaria del proceso.
 */

export type ISODate = string
export type ISODateTime = string

// -----------------------------------------------------------------------------
// Paginación keyset
// -----------------------------------------------------------------------------

export type Page<T> = {
  items: T[]
  /** Opaco para la vista: se devuelve tal cual en el próximo pedido. Null = no hay más. */
  nextCursor: string | null
}

// -----------------------------------------------------------------------------
// Usuarios internos y sesión
// -----------------------------------------------------------------------------

export type AppRole = 'admin' | 'editor' | 'consulta'

export type AppUser = {
  userId: string
  email: string
  displayName: string
  role: AppRole
  isActive: boolean
  /** Contraseña temporal pendiente: mientras sea true, RLS le cierra todo el dominio. */
  mustChangePassword: boolean
  passwordChangedAt: ISODateTime | null
  createdAt: ISODateTime
}

/**
 * Fila de /usuarios. `incomplete` = existe en Auth pero no tiene fila en
 * app_users (el alta falló a mitad de camino): no ve nada y se puede completar.
 * En ese caso los campos de app_users vienen con valores por defecto.
 */
export type AppUserListItem = AppUser & {
  authStatus: 'ok' | 'incomplete'
}

/**
 * Lo que sabe el servidor de quien está usando el panel. `role` es null si el
 * usuario de Auth no tiene fila en app_users o está desactivado.
 */
export type SessionInfo = {
  userId: string
  email: string
  displayName: string | null
  role: AppRole | null
  isActive: boolean
  mustChangePassword: boolean
}

// -----------------------------------------------------------------------------
// Catálogos
// -----------------------------------------------------------------------------

export type Discipline = {
  id: number
  name: string
  isActive: boolean
  sortOrder: number
}

export type Category = {
  id: number
  disciplineId: number
  name: string
  isActive: boolean
  sortOrder: number
}

/** Disciplina con sus categorías, para /ajustes y los selects del padrón. */
export type DisciplineWithCategories = Discipline & {
  categories: Category[]
}

export type Settings = {
  clubName: string
  /** Primer día de mes, o null si todavía no se activaron las cuotas. */
  billingStartPeriod: ISODate | null
}

// -----------------------------------------------------------------------------
// Padrón
// -----------------------------------------------------------------------------

export type MemberType = 'practicing' | 'non_practicing'
export type MemberStatus = 'active' | 'inactive'
export type MemberStatusEventType = 'admission' | 'withdrawal' | 'reactivation'

/** Estado del apto físico. `not_required` para mayores de 18. */
export type MedicalClearanceStatus = 'not_required' | 'missing' | 'valid' | 'expiring' | 'expired'

/** Fila de `members` en camelCase. */
export type Member = {
  id: number
  firstName: string
  lastName: string
  dni: string | null
  birthDate: ISODate | null
  address: string | null
  phone: string | null
  email: string | null
  memberType: MemberType
  categoryId: number | null
  familyGroupId: number | null
  isPaymentResponsible: boolean
  joinedOn: ISODate
  status: MemberStatus
  statusChangedOn: ISODate | null
  notes: string | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** Fila del listado del padrón. */
export type MemberSummary = {
  id: number
  /** "Apellido, Nombre". */
  fullName: string
  dni: string | null
  hasDni: boolean
  memberType: MemberType
  status: MemberStatus
  categoryName: string | null
  disciplineName: string | null
  familyGroupId: number | null
  isPaymentResponsible: boolean
  /** Derivado de birthDate en la zona del club. False si no hay fecha. */
  isMinor: boolean
  medicalClearanceStatus: MedicalClearanceStatus
}

export type MedicalClearance = {
  id: number
  memberId: number
  expiresOn: ISODate
  /** Ruta en el bucket, nunca una URL. Null si solo se cargó la fecha. */
  storagePath: string | null
  originalFilename: string | null
  notes: string | null
  createdAt: ISODateTime
}

export type FamilyGroup = {
  id: number
  name: string | null
  payerContactName: string | null
  payerContactPhone: string | null
  notes: string | null
}

export type FamilyGroupMember = {
  id: number
  fullName: string
  status: MemberStatus
  isPaymentResponsible: boolean
}

export type FamilyGroupSummary = FamilyGroup & {
  /** Nombre a mostrar: `name` o el apellido del responsable. */
  label: string
  members: FamilyGroupMember[]
  /** El grupo no tiene responsable activo: la UI lo avisa, la base no lo fuerza. */
  missingResponsible: boolean
}

export type MemberStatusEvent = {
  id: number
  eventType: MemberStatusEventType
  effectiveOn: ISODate
  reason: string
  notes: string | null
  createdByName: string | null
  createdAt: ISODateTime
}

/** Ficha completa de /socios/[id]. */
export type MemberDetail = Member & {
  fullName: string
  age: number | null
  isMinor: boolean
  categoryName: string | null
  disciplineId: number | null
  disciplineName: string | null
  familyGroup: FamilyGroupSummary | null
  /** El apto vigente: el de mayor vencimiento. */
  currentMedicalClearance: MedicalClearance | null
  medicalClearanceStatus: MedicalClearanceStatus
  /** URL firmada de 60 s del certificado vigente, solo si tiene adjunto. No se persiste. */
  medicalClearanceUrl: string | null
  medicalClearances: MedicalClearance[]
  statusHistory: MemberStatusEvent[]
}

export type MemberFilters = {
  q?: string
  categoryId?: number
  disciplineId?: number
  /** Por defecto 'active'. 'all' muestra también las bajas. */
  status?: MemberStatus | 'all'
  memberType?: MemberType
  /** Preparado para el slice 2 (cuotas). Hasta entonces se acepta y se ignora. */
  debt?: 'any' | 'up_to_date' | 'in_debt'
  cursor?: string | null
  /** Tope 100. */
  limit?: number
}

// -----------------------------------------------------------------------------
// Auditoría
// -----------------------------------------------------------------------------

export type AuditOp = 'INSERT' | 'UPDATE' | 'DELETE' | 'EXPORT'
export type AuditActorSource = 'session' | 'explicit' | 'system'

/** Tablas auditadas del slice 1, para el filtro de /auditoria. */
export type AuditedTable =
  | 'app_users'
  | 'settings'
  | 'disciplines'
  | 'categories'
  | 'family_groups'
  | 'members'
  | 'member_status_events'
  | 'medical_clearances'

export type AuditEntry = {
  id: number
  occurredAt: ISODateTime
  actorId: string | null
  /** Resuelto contra app_users; null si fue el sistema o un usuario sin fila. */
  actorName: string | null
  actorSource: AuditActorSource
  op: AuditOp
  tableName: string
  recordId: string | null
  changedFields: string[] | null
}

/** El detalle trae los datos completos; el listado no, para no mover jsonb de más. */
export type AuditEntryDetail = AuditEntry & {
  oldData: Record<string, unknown> | null
  newData: Record<string, unknown> | null
  context: Record<string, unknown> | null
}

export type AuditFilters = {
  tableName?: AuditedTable
  actorId?: string
  /** Rango en la zona del club, inclusive. */
  from?: ISODate
  to?: ISODate
  recordId?: string
  cursor?: string | null
  limit?: number
}
