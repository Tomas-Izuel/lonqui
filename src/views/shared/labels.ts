/**
 * Etiquetas en español para los enums del dominio. El dominio se nombra en
 * inglés en el código (CLAUDE.md); estos mapas son el único lugar que
 * traduce, para no repetir el texto en cada vista.
 */

import type { AppRole, AuditOp, MemberStatus, MemberStatusEventType, MemberType } from '@/models/types'

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

/** Estado del apto físico, para el aviso en el padrón y en la ficha. */
export const medicalClearanceStatusLabels = {
  not_required: 'No requiere',
  missing: 'Falta cargar',
  valid: 'Vigente',
  expiring: 'Por vencer',
  expired: 'Vencido',
} as const
