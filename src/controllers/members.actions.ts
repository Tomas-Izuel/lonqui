'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { DomainError, zodToApiError } from '@/lib/errors'
import {
  createMember as insertMember,
  createMemberSchema,
  insertStatusEvent,
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
  prepareUploadSchema,
  updateClearanceSchema,
  updateMedicalClearance as updateMedicalClearanceRow,
} from '@/models/medical-clearances.model'
import { createSignedUploadUrl, objectExists } from '@/services/storage.service'

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
