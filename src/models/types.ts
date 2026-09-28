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
/**
 * Catálogo de permisos (00-architecture.md del pipeline 2026-09-27, §6.8).
 * Claves estables: se agregan, nunca se renombran. La fuente de verdad del
 * mapeo rol → permisos es SQL (`private.permissions_for_role`); la app los
 * lee con `my_permissions()` y no duplica el mapa.
 */
export type Permission =
  | 'members.read'
  | 'members.write'
  | 'members.status'
  | 'payments.read'
  | 'payments.register'
  | 'payments.void'
  | 'billing.configure'
  | 'settings.manage'
  | 'users.manage'
  | 'audit.read'
  | 'reports.read'
  | 'reports.export'

export type SessionInfo = {
  userId: string
  email: string
  displayName: string | null
  role: AppRole | null
  isActive: boolean
  mustChangePassword: boolean
  /**
   * Lo que el usuario puede hacer. Vacío sin rol activo o con contraseña
   * temporal. Desde el slice 2 la UI decide con esto, nunca con `role`.
   */
  permissions: Permission[]
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

/**
 * DERIVADO: lo escribe la base (trigger sobre member_categories). Practicante
 * = al menos una inscripción abierta. La app nunca lo manda.
 */
export type MemberType = 'practicing' | 'non_practicing'
export type MemberStatus = 'active' | 'inactive'
export type MemberStatusEventType = 'admission' | 'withdrawal' | 'reactivation'

/** Estado del apto físico. `not_required` para mayores de 18. */
export type MedicalClearanceStatus = 'not_required' | 'missing' | 'valid' | 'expiring' | 'expired'

/** Una categoría en la que el socio está inscripto (abierta). */
export type MemberCategoryRef = {
  categoryId: number
  categoryName: string
  disciplineId: number
  disciplineName: string
}

/** Una inscripción de `member_categories`, abierta o cerrada (historia). */
export type MemberCategoryMembership = MemberCategoryRef & {
  id: number
  joinedOn: ISODate
  /** Null mientras sigue en la categoría. Es el último día en ella. */
  leftOn: ISODate | null
  leftReason: string | null
  /** Null si la cerró el sistema o no hay fila en app_users. */
  leftByName: string | null
}

/** Cambio de categorías en bloque (RPC set_member_categories). Una por disciplina. */
export type SetMemberCategoriesInput = {
  memberId: number
  categoryIds: number[]
  /** "A partir de". Default: hoy en la zona del club. */
  effectiveOn?: ISODate
}

/** "Dar de baja de <categoría>" desde la ficha. */
export type LeaveCategoryInput = {
  membershipId: number
  leftOn: ISODate
  reason?: string | null
}

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
  /** Inscripciones abiertas, ordenadas por disciplina y categoría. Vacío = no practicante. */
  categories: MemberCategoryRef[]
  familyGroupId: number | null
  isPaymentResponsible: boolean
  /** Derivado de birthDate en la zona del club. False si no hay fecha. */
  isMinor: boolean
  medicalClearanceStatus: MedicalClearanceStatus
  /**
   * Derivados de cargos y pagos (campos calculados de PostgREST). Solo vienen
   * si el usuario tiene `payments.read`: sin ese permiso ni se consultan.
   */
  debtStatus?: DebtStatus
  balanceCents?: number
  monthsDue?: number
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
  /** Inscripciones abiertas. */
  categories: MemberCategoryRef[]
  /** Todas las inscripciones, abiertas y cerradas, de la más nueva a la más vieja. */
  categoryHistory: MemberCategoryMembership[]
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
  /** Socios con inscripción ABIERTA en esa categoría. */
  categoryId?: number
  /** Socios con inscripción abierta en alguna categoría de esa disciplina. */
  disciplineId?: number
  /** Por defecto 'active'. 'all' muestra también las bajas. */
  status?: MemberStatus | 'all'
  memberType?: MemberType
  /** 'up_to_date' incluye a los que tienen saldo a favor. */
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

/** Tablas auditadas, para el filtro de /auditoria. */
export type AuditedTable =
  | 'app_users'
  | 'settings'
  | 'disciplines'
  | 'categories'
  | 'family_groups'
  | 'members'
  | 'member_status_events'
  | 'medical_clearances'
  | 'member_categories'
  | 'fee_prices'
  | 'fees'
  | 'payments'

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
  /**
   * Nombre humano del registro, para que la auditoría hable en el idioma del
   * club y no en ids: "Ejemplo, Lucía", "Fútbol masculino · 5ta", "Admin de
   * desarrollo". Se deriva de old_data/new_data en el servidor. Null si la
   * tabla no tiene un nombre que mostrar (p. ej. settings).
   */
  recordLabel: string | null
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

// -----------------------------------------------------------------------------
// Cuotas, pagos y estado de cuenta (slice 2)
//
// Montos en centavos enteros (number). Un saldo negativo es saldo a favor: se
// informa como `credit`, nunca como deuda negativa.
// -----------------------------------------------------------------------------

export type FeePriceScope = 'default' | 'member_type' | 'category'

export type FeePrice = {
  id: number
  scope: FeePriceScope
  memberType: MemberType | null
  categoryId: number | null
  categoryName: string | null
  amountCents: number
  /** Primer día del mes desde el que aplica. */
  validFrom: ISODate
  notes: string | null
  createdAt: ISODateTime
}

export type FeePriceInput = {
  scope: FeePriceScope
  memberType?: MemberType | null
  categoryId?: number | null
  amountCents: number
  validFrom: ISODate
  notes?: string | null
}

/** El valor vigente hoy en cada nivel, y la historia completa. */
export type FeePricesOverview = {
  current: {
    default: FeePrice | null
    byMemberType: FeePrice[]
    byCategory: FeePrice[]
  }
  /** Programados para meses futuros (todavía no vigentes). */
  upcoming: FeePrice[]
  history: FeePrice[]
}

export type FeeKind = 'monthly' | 'opening_balance' | 'adjustment'

export type Fee = {
  id: number
  memberId: number
  period: ISODate
  kind: FeeKind
  amountCents: number
  description: string | null
  /** Cuota por deporte: la categoría congelada al generar. Null en la social y el saldo anterior. */
  categoryId: number | null
  categoryName: string | null
  disciplineName: string | null
  createdAt: ISODateTime
  voidedAt: ISODateTime | null
  voidReason: string | null
}

export type FeeStatementStatus = 'paid' | 'partial' | 'due' | 'voided'

/** Una fila de `member_fee_statement`: cada cargo con cuánto lo cubren los pagos. */
export type FeeStatementLine = {
  feeId: number
  period: ISODate
  kind: FeeKind
  description: string | null
  amountCents: number
  coveredCents: number
  categoryId: number | null
  categoryName: string | null
  disciplineName: string | null
  status: FeeStatementStatus
  voidedAt: ISODateTime | null
  voidReason: string | null
}

export type PaymentMethod = 'cash' | 'transfer'

export type Payment = {
  id: number
  memberId: number
  amountCents: number
  paidOn: ISODate
  method: PaymentMethod
  hasReceipt: boolean
  receiptFilename: string | null
  notes: string | null
  /** Pagos cargados en un mismo cobro (p. ej. un padre por sus hijos). */
  batchId: string
  createdByName: string | null
  createdAt: ISODateTime
  voidedAt: ISODateTime | null
  voidReason: string | null
}

export type PaymentListItem = Payment & {
  memberFullName: string
  voided: boolean
}

export type DebtStatus = 'up_to_date' | 'in_debt' | 'credit'

export type CurrentFeeLine = {
  /** Null = cuota social. */
  categoryId: number | null
  /** "Cuota social" cuando categoryId es null. */
  categoryName: string
  disciplineName: string | null
  amountCents: number
}

/** Una fila de `member_accounts` en camelCase. */
export type MemberAccount = {
  memberId: number
  fullName: string
  status: MemberStatus
  memberType: MemberType
  /** Inscripciones abiertas. */
  categories: MemberCategoryRef[]
  familyGroupId: number | null
  isPaymentResponsible: boolean
  chargedCents: number
  paidCents: number
  /** Positivo = debe; negativo = saldo a favor. */
  balanceCents: number
  monthsDue: number
  oldestDuePeriod: ISODate | null
  lastPaymentOn: ISODate | null
  lastPaymentCents: number | null
  debtStatus: DebtStatus
  /**
   * La cuota del mes: la suma de sus cuotas generadas (una por deporte, o la
   * social) o, si todavía no se generaron, la que le tocaría. Null sin
   * facturación activa. Es lo que precarga el pago.
   */
  currentFeeCents: number | null
  /** El desglose de currentFeeCents. Vacío sin facturación activa. */
  currentFees: CurrentFeeLine[]
  currentFeePeriod: ISODate | null
}

export type MemberAccountDetail = {
  account: MemberAccount
  statement: FeeStatementLine[]
  payments: Payment[]
  openingBalance: Fee | null
}

export type BillingRunStatus = 'ok' | 'error' | 'skipped'
export type BillingRunTrigger = 'cron' | 'manual'

export type BillingRun = {
  id: number
  period: ISODate
  trigger: BillingRunTrigger
  actorName: string | null
  startedAt: ISODateTime
  finishedAt: ISODateTime | null
  status: BillingRunStatus
  feesCreated: number
  /** Mensaje de Postgres, sin datos personales. */
  errorMessage: string | null
}

export type BillingStatus = {
  active: boolean
  startPeriod: ISODate | null
  currentPeriod: ISODate
  lastGeneratedPeriod: ISODate | null
  /** Meses entre el inicio y hoy sin ninguna cuota generada. */
  pendingPeriods: ISODate[]
  activeMembers: number
  /**
   * Estado de la generación del mes actual. `failed` y `missing` producen el
   * aviso con "Reintentar" para quien tiene `billing.configure`. Un usuario
   * sin ese permiso no ve corridas (RLS): para él nunca es `failed`/`missing`.
   */
  currentPeriodRun: 'ok' | 'failed' | 'missing' | 'not_due'
  lastRun: BillingRun | null
  recentRuns: BillingRun[]
}

/** Resultado de "Generar cuotas ahora" / "Reintentar". */
export type GenerateFeesResult = {
  status: BillingRunStatus
  feesCreated: number
  errorMessage: string | null
}

export type MemberPageData = {
  member: MemberDetail
  /** Null sin `payments.read`. */
  account: MemberAccountDetail | null
  billing: BillingStatus
}

export type MonthCollection = {
  period: ISODate
  collectedCents: number
  cashCents: number
  transferCents: number
  paymentsCount: number
  /** Cuotas mensuales no anuladas del período (sin saldo de arranque). */
  feesCents: number
  feesCount: number
}

/**
 * Un día del ritmo de cobranza del mes (RPC `daily_collection`, pipeline
 * 2026-09-28). Todos los días del período hasta hoy, también los que no
 * tuvieron pagos (en cero). `cumulativeCents` ya viene acumulado desde el 1°.
 */
export type DailyCollectionPoint = {
  day: ISODate
  collectedCents: number
  cumulativeCents: number
}

export type DashboardSummary = {
  billingActive: boolean
  billingStartPeriod: ISODate | null
  period: ISODate
  activeMembers: number
  collectedCents: number
  cashCents: number
  transferCents: number
  /** Pagos no anulados con fecha en el mes. */
  paymentsCount: number
  feesCents: number
  feesCount: number
  /** Suma de saldos positivos de socios ACTIVOS. El saldo a favor no resta. */
  totalDebtCents: number
  membersInDebt: number
  membersWithCredit: number
  creditCents: number
  /** Deuda de socios dados de baja: va aparte (T9). */
  inactiveDebtCents: number
  inactiveInDebt: number
  /** Solo altas nuevas; las reactivaciones van aparte. */
  admissionsCount: number
  reactivationsCount: number
  withdrawalsCount: number
  expiredClearances: number
  missingClearances: number
  pendingPeriods: ISODate[]
}

/**
 * Una fila de `debt_by_category`. La deuda se atribuye cargo por cargo a la
 * categoría CONGELADA en el cargo (D32), así que la suma de todas las filas
 * = la deuda total de los activos.
 */
export type DebtByCategoryRow = {
  /** 'social' = cuota social (no practicantes); 'opening_balance' = saldo anterior al sistema. */
  kind: 'category' | 'social' | 'opening_balance'
  /** Null en las dos filas especiales. */
  categoryId: number | null
  categoryName: string
  disciplineId: number | null
  disciplineName: string | null
  /**
   * El plantel de HOY (socios activos con inscripción abierta). Puede ser menor
   * que membersInDebt: la deuda de los meses en 5ta queda en 5ta aunque el
   * chico ya juegue en 6ta.
   */
  members: number
  membersInDebt: number
  debtCents: number
}

export type MonthlyHistoryPoint = {
  period: ISODate
  collectedCents: number
  feesCents: number
  /** Deuda de los socios activos al cierre de ese mes (T8). */
  debtAtCloseCents: number
}

export type DashboardData = {
  summary: DashboardSummary
  topDebtors: MemberAccount[]
  byCategory: DebtByCategoryRow[]
  history: MonthlyHistoryPoint[]
  billing: BillingStatus
}

export type AccountListFilters = {
  debt?: DebtStatus | 'any'
  /** Socios con inscripción abierta en esa categoría. La deuda que se muestra es la TOTAL del socio. */
  categoryId?: number
  status?: MemberStatus | 'all'
  cursor?: string | null
  limit?: number
}

/** Lo que necesita el formulario de pago (un socio o varios de su grupo). */
export type PaymentFormData = {
  /** El socio desde el que se abrió el formulario va primero. */
  members: MemberAccount[]
  familyGroup: FamilyGroupSummary | null
  billing: BillingStatus
}
