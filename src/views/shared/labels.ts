/**
 * Etiquetas en español para los enums del dominio. El dominio se nombra en
 * inglés en el código (CLAUDE.md); estos mapas son el único lugar que
 * traduce, para no repetir el texto en cada vista.
 */

import type {
  AppRole,
  AuditOp,
  DebtStatus,
  FeeKind,
  FeePriceScope,
  FeeStatementStatus,
  MemberStatus,
  MemberStatusEventType,
  MemberType,
  PaymentMethod,
} from '@/models/types'

export const memberTypeLabels: Record<MemberType, string> = {
  practicing: 'Practicante',
  non_practicing: 'No practicante',
}

export const memberStatusLabels: Record<MemberStatus, string> = {
  active: 'Activo',
  inactive: 'Dado de baja',
}

export const memberStatusEventLabels: Record<MemberStatusEventType, string> = {
  admission: 'Alta',
  withdrawal: 'Baja',
  reactivation: 'Reactivación',
}

export const appRoleLabels: Record<AppRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  consulta: 'Consulta',
}

/** Una línea que explica qué puede hacer cada rol (para /usuarios). */
export const appRoleDescriptions: Record<AppRole, string> = {
  admin: 'Todo: usuarios, ajustes, baja y reactivación de socios, auditoría',
  editor: 'Carga y modifica socios, registra pagos',
  consulta: 'Solo mira: padrón, listados y reportes',
}

export const auditOpLabels: Record<AuditOp, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
  EXPORT: 'Exportó',
}

/**
 * Estado del apto físico, para el aviso en el padrón y en la ficha. Cada
 * etiqueta nombra "apto físico" explícito (finish review, fix 5): "Falta
 * cargar" o "Vencido" a secas, sueltos en una fila del padrón sin más
 * contexto, no dicen qué es lo que falta o venció.
 */
export const medicalClearanceStatusLabels = {
  not_required: 'No requiere',
  missing: 'Falta apto físico',
  valid: 'Vigente',
  expiring: 'Apto por vencer',
  expired: 'Apto vencido',
} as const

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
}

export const debtStatusLabels: Record<DebtStatus, string> = {
  up_to_date: 'Al día',
  in_debt: 'Con deuda',
  credit: 'Saldo a favor',
}

export const feeKindLabels: Record<FeeKind, string> = {
  monthly: 'Cuota',
  opening_balance: 'Saldo anterior',
  adjustment: 'Ajuste',
}

export const feeStatementStatusLabels: Record<FeeStatementStatus, string> = {
  paid: 'Pagada',
  partial: 'Parcial',
  due: 'Adeudada',
  voided: 'Anulada',
}

export const feePriceScopeLabels: Record<FeePriceScope, string> = {
  default: 'Por defecto',
  member_type: 'Por tipo de socio',
  category: 'Por categoría',
}
