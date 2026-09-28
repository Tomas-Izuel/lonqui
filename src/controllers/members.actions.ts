'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission, requireRole } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { DomainError, zodToApiError } from '@/lib/errors'
import {
  changeCategory as changeCategoryRow,
  changeCategorySchema,
  closeMembership,
  leaveCategorySchema,
  setMemberCategories as setMemberCategoriesRpc,
  setMemberCategoriesSchema,
} from '@/models/member-categories.model'
import {
  createMember as insertMember,
  createMemberSchema,
  insertStatusEvent,
  loadMoreMembersSchema,
  searchMembers,
  statusEventSchema,
  updateMember as updateMemberRow,
  updateMemberSchema,
} from '@/models/members.model'
import {
  createFamilyGroup as insertFamilyGroup,
  familyGroupInputSchema,
  setPaymentResponsible as setPaymentResponsibleRpc,
  setPaymentResponsibleSchema,
} from '@/models/family-groups.model'
import {
  buildMedicalClearancePath,
  confirmClearanceSchema,
  createClearanceWithoutFileSchema,
  createMedicalClearance as insertMedicalClearance,
  getMedicalClearanceById,
  getMedicalClearanceUrlSchema,
  prepareUploadSchema,
  updateClearanceSchema,
  updateMedicalClearance as updateMedicalClearanceRow,
} from '@/models/medical-clearances.model'
import { createSignedUploadUrl, getSignedUrl, objectExists } from '@/services/storage.service'
import type { MemberSummary, Page } from '@/models/types'

/**
 * Server Actions del padrón. Convención de firma (F2 la consume tal cual):
 * TODAS reciben un objeto plano ya con la forma del formulario y devuelven
 * `Promise<ActionResult<T>>`. Ninguna usa `(prevState, formData)` +
 * `useActionState`: CLAUDE.md exige react-hook-form en todos los formularios,
 * y RHF ya maneja su propio estado de envío (`formState.isSubmitting`) sin
 * necesitar ese patrón — agregarlo encima sería un segundo mecanismo para lo
 * mismo. `useActionState` sería la elección correcta recién si F2 tuviera un
 * `<form action={...}>` sin RHF, que no es el caso acá.
 *
 * Cada action: `requireRole(...)` primero (re-verificación del servidor;
 * la RLS es la autorización real), después `schema.safeParse` (los errores
 * de formato nunca nombran una clave desconocida, `.strict()` + `zodToApiError`),
 * después el modelo (que traduce las violaciones de Postgres conocidas a
 * `DomainError`), y por último `revalidatePath`.
 */

export async function createMember(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = createMemberSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const result = await insertMember(parsed.data)
    revalidatePath('/socios')
    return success(result)
  } catch (err) {
    return failure(err, 'members.createMember')
  }
}

export async function updateMember(id: number, input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = updateMemberSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await updateMemberRow(id, parsed.data)
    revalidatePath('/socios')
    revalidatePath(`/socios/${id}`)
    return success()
  } catch (err) {
    return failure(err, 'members.updateMember')
  }
}

/**
 * Cambio en bloque de deportes desde la ficha (Revisión 3, §13.6: "a partir
 * de", default hoy). `requirePermission` en vez de `requireRole`: toda regla
 * nueva del slice de cuotas chequea permisos (CLAUDE.md, T12), no roles.
 */
export async function setMemberCategories(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('members.write')
    const parsed = setMemberCategoriesSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await setMemberCategoriesRpc(parsed.data)
    revalidatePath('/socios')
    revalidatePath(`/socios/${parsed.data.memberId}`)
    return success()
  } catch (err) {
    return failure(err, 'members.setMemberCategories')
  }
}

/** "Dar de baja de <categoría>" (motivo opcional) desde el panel "Deportes" de la ficha. */
export async function leaveCategory(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('members.write')
    const parsed = leaveCategorySchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const { memberId } = await closeMembership(parsed.data)
    revalidatePath('/socios')
    revalidatePath(`/socios/${memberId}`)
    return success()
  } catch (err) {
    return failure(err, 'members.leaveCategory')
  }
}

/** "Cambiar de categoría" (el ascenso 5ta → 6ta): cierra la inscripción y abre la nueva en la misma disciplina y fecha. */
export async function changeCategory(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('members.write')
    const parsed = changeCategorySchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const { memberId } = await changeCategoryRow(parsed.data)
    revalidatePath('/socios')
    revalidatePath(`/socios/${memberId}`)
    return success()
  } catch (err) {
    return failure(err, 'members.changeCategory')
  }
}

export async function withdrawMember(input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')
    const parsed = statusEventSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await insertStatusEvent({ ...parsed.data, eventType: 'withdrawal' })
    revalidatePath('/socios')
    revalidatePath(`/socios/${parsed.data.memberId}`)
    return success()
  } catch (err) {
    return failure(err, 'members.withdrawMember')
  }
}

export async function reactivateMember(input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')
    const parsed = statusEventSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await insertStatusEvent({ ...parsed.data, eventType: 'reactivation' })
    revalidatePath('/socios')
    revalidatePath(`/socios/${parsed.data.memberId}`)
    return success()
  } catch (err) {
    return failure(err, 'members.reactivateMember')
  }
}

export async function createFamilyGroup(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = familyGroupInputSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const result = await insertFamilyGroup(parsed.data)
    revalidatePath('/socios')
    return success(result)
  } catch (err) {
    return failure(err, 'members.createFamilyGroup')
  }
}

export async function setPaymentResponsible(input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = setPaymentResponsibleSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await setPaymentResponsibleRpc(parsed.data.groupId, parsed.data.memberId)
    revalidatePath('/socios')
    return success()
  } catch (err) {
    return failure(err, 'members.setPaymentResponsible')
  }
}

/**
 * Primer paso de la subida del apto físico (D11): arma la ruta en el
 * servidor y devuelve la URL de subida firmada. El browser sube directo a
 * Storage con `uploadToSignedUrl` (no pasa por acá ni por ningún Server
 * Action: el archivo nunca toca una función de Vercel).
 */
export async function prepareMedicalClearanceUpload(
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = prepareUploadSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const path = buildMedicalClearancePath(parsed.data.memberId, parsed.data.mimeType)
    const result = await createSignedUploadUrl(path)
    return success(result)
  } catch (err) {
    return failure(err, 'members.prepareMedicalClearanceUpload')
  }
}

/**
 * Segundo paso: confirma que lo que se subió es lo que se pidió (prefijo del
 * `memberId`) y que el objeto realmente está en Storage, y recién ahí crea la
 * fila. Sin esto, un `path` inventado por el cliente crearía un registro que
 * apunta a un archivo ajeno o inexistente.
 */
export async function confirmMedicalClearance(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = confirmClearanceSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const expectedPrefix = `medical-clearances/${parsed.data.memberId}/`
    if (!parsed.data.path.startsWith(expectedPrefix)) {
      throw new DomainError('El archivo no corresponde a este socio')
    }
    if (!(await objectExists(parsed.data.path))) {
      throw new DomainError('No encontramos el archivo subido. Probá de nuevo.')
    }

    const result = await insertMedicalClearance({
      memberId: parsed.data.memberId,
      expiresOn: parsed.data.expiresOn,
      storagePath: parsed.data.path,
      originalFilename: parsed.data.originalFilename,
      notes: parsed.data.notes,
    })
    revalidatePath(`/socios/${parsed.data.memberId}`)
    return success(result)
  } catch (err) {
    return failure(err, 'members.confirmMedicalClearance')
  }
}

/** Apto cargado solo con la fecha, sin adjunto (la Comisión vio el papel). */
export async function createMedicalClearance(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = createClearanceWithoutFileSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const result = await insertMedicalClearance({ ...parsed.data, storagePath: null })
    revalidatePath(`/socios/${parsed.data.memberId}`)
    return success(result)
  } catch (err) {
    return failure(err, 'members.createMedicalClearance')
  }
}

export async function updateMedicalClearance(id: number, input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin', 'editor')
    const parsed = updateClearanceSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await updateMedicalClearanceRow(id, parsed.data)
    revalidatePath('/socios')
    return success()
  } catch (err) {
    return failure(err, 'members.updateMedicalClearance')
  }
}

/**
 * Firma la URL del certificado al click de "Ver certificado" (03-review.md,
 * Major 4): la ficha ya no la trae armada (`MemberDetail.medicalClearanceUrl`
 * queda en `null`), porque una firma de 60 s hecha al renderizar la página
 * muere si la persona tarda en tocar el botón — el caso normal con el celular
 * de la sede, no el raro.
 *
 * `requirePermission('members.read')`: misma exigencia de lectura que ver la
 * ficha, pero por permiso (03-review.md, Major 1) — no por rol, para que el
 * pipeline de roles configurables no tenga que reabrir esta función. Verifica
 * que el apto sea del socio pedido (no cualquier `clearanceId` que alguien
 * pruebe a mano) y que tenga adjunto antes de gastar una firma.
 */
export async function getMedicalClearanceUrl(input: unknown): Promise<ActionResult<{ url: string }>> {
  try {
    await requirePermission('members.read')
    const parsed = getMedicalClearanceUrlSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const clearance = await getMedicalClearanceById(parsed.data.clearanceId)
    if (!clearance || clearance.memberId !== parsed.data.memberId) {
      throw new DomainError('No encontramos ese apto físico')
    }
    if (!clearance.storagePath) {
      throw new DomainError('Este apto no tiene certificado adjunto')
    }

    const url = await getSignedUrl(clearance.storagePath, 60)
    return success({ url })
  } catch (err) {
    return failure(err, 'members.getMedicalClearanceUrl')
  }
}

/**
 * "Ver más" del padrón (03-review.md, Major 5): antes, `pages=N` en la URL
 * re-encadenaba las N páginas anteriores en cada request. Ahora el Client
 * Component acumula en estado (como `AuditList`) y solo pide la página nueva
 * acá. `requirePermission('members.read')`: misma exigencia de lectura que
 * `getPadron` (03-review.md, Major 1) — por permiso, no por rol.
 */
export async function loadMoreMembers(input: unknown): Promise<ActionResult<Page<MemberSummary>>> {
  try {
    const session = await requirePermission('members.read')
    const parsed = loadMoreMembersSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const page = await searchMembers(
      { ...parsed.data.filters, cursor: parsed.data.cursor },
      { includeDebt: session.permissions.includes('payments.read') },
    )
    return success(page)
  } catch (err) {
    return failure(err, 'members.loadMoreMembers')
  }
}
