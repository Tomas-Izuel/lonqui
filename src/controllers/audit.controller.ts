import 'server-only'

import { requirePanelAccess } from '@/controllers/session.controller'
import { getAuditEntry as getAuditEntryModel, getAuditPage as getAuditPageModel } from '@/models/audit.model'
import { listAppUsers } from '@/models/app-users.model'
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

/**
 * Opciones para el filtro "Usuario" de `/auditoria` (03-review.md, Minor 8):
 * antes, la page llamaba a `listUsers()` (users.controller), que pagina la
 * Admin API de Auth con la secret key en cada render solo para armar un
 * select. `app_users` (RLS: un admin ve todas las filas) ya tiene lo que hace
 * falta — nombre y id — sin tocar Auth ni acoplar `/auditoria` a
 * `users.controller`. Las altas incompletas (sin fila en `app_users`, nunca
 * actuaron) quedan afuera solas, sin filtrarlas a mano.
 */
export async function listAuditActorOptions(): Promise<{ userId: string; displayName: string }[]> {
  await requirePanelAccess('admin')
  const users = await listAppUsers()
  return users
    .map((u) => ({ userId: u.userId, displayName: u.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
}
