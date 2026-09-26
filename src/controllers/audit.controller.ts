import 'server-only'

import { requirePanelAccess } from './session.controller'
import { getAuditEntry as getAuditEntryModel, getAuditPage as getAuditPageModel } from '@/models/audit.model'
import type { AuditEntryDetail, AuditFilters, AuditEntry, Page } from '@/models/types'

/**
 * Único acceso de lectura a `/auditoria`. `requireRole('admin')` se llama
 * **antes** de tocar la base a propósito (spec B3): la policy de SELECT de
 * `audit_log` ya es admin-only, así que sin este chequeo un `editor` que
 * llegara acá vería una página vacía — indistinguible de "no hay auditoría".
 * Con el chequeo primero, ve el 403 que le corresponde.
 */

export async function getAuditPage(filters: AuditFilters): Promise<Page<AuditEntry>> {
  await requirePanelAccess('admin')
  return getAuditPageModel(filters)
}

export async function getAuditEntry(id: number): Promise<AuditEntryDetail | null> {
  await requirePanelAccess('admin')
  return getAuditEntryModel(id)
}
