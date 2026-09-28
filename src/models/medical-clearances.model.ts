import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import type { MedicalClearance } from '@/models/types'

/**
 * Aptos físicos. Solo Postgres acá: la validación del prefijo de la ruta y la
 * existencia del objeto en Storage son orquestación (viven en
 * `members.actions.ts`, que además habla con `storage.service.ts`) — este
 * modelo no sabe nada de Storage.
 */

// -----------------------------------------------------------------------------
// Tipos y MIME admitidos (S4: mismos que el bucket `attachments`)
// -----------------------------------------------------------------------------

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS) as [string, ...string[]]

/** 10 MiB, igual al `file_size_limit` del bucket (S4): que el usuario vea el error antes de subir, no después. */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const prepareUploadSchema = z
  .object({
    memberId: z.number().int().positive(),
    mimeType: z.enum(ALLOWED_MIME_TYPES),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_ATTACHMENT_SIZE_BYTES, 'El archivo no puede pesar más de 10 MB'),
  })
  .strict()
export type PrepareUploadInput = z.infer<typeof prepareUploadSchema>

export const confirmClearanceSchema = z
  .object({
    memberId: z.number().int().positive(),
    path: z.string().min(1),
    expiresOn: z.iso.date('La fecha no es válida'),
    originalFilename: z.string().trim().max(255).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()
export type ConfirmClearanceInput = z.infer<typeof confirmClearanceSchema>

/** Apto sin adjunto: la Comisión vio el certificado en papel y solo carga la fecha (D11, §6.1). */
export const createClearanceWithoutFileSchema = z
  .object({
    memberId: z.number().int().positive(),
    expiresOn: z.iso.date('La fecha no es válida'),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()
export type CreateClearanceWithoutFileInput = z.infer<typeof createClearanceWithoutFileSchema>

/** Columnas con grant de UPDATE (§6.5): solo vencimiento y notas. */
export const updateClearanceSchema = z
  .object({
    expiresOn: z.iso.date('La fecha no es válida').optional(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()
export type UpdateClearanceInput = z.infer<typeof updateClearanceSchema>

/** Para `getMedicalClearanceUrl` (Major 4 del review): firma la URL al click, no al render de la ficha. */
export const getMedicalClearanceUrlSchema = z
  .object({
    memberId: z.number().int().positive(),
    clearanceId: z.number().int().positive(),
  })
  .strict()
export type GetMedicalClearanceUrlInput = z.infer<typeof getMedicalClearanceUrlSchema>

// -----------------------------------------------------------------------------
// Rutas de Storage
// -----------------------------------------------------------------------------

/** `medical-clearances/<memberId>/<uuid>.<ext>`, armada en el servidor (nunca la manda el browser). */
export function buildMedicalClearancePath(memberId: number, mimeType: string): string {
  const ext = MIME_EXTENSIONS[mimeType]
  return `medical-clearances/${memberId}/${crypto.randomUUID()}.${ext}`
}

// -----------------------------------------------------------------------------
// Consultas y escrituras
// -----------------------------------------------------------------------------

function mapClearance(row: {
  id: number
  member_id: number
  expires_on: string
  storage_path: string | null
  original_filename: string | null
  notes: string | null
  created_at: string
}): MedicalClearance {
  return {
    id: row.id,
    memberId: row.member_id,
    expiresOn: row.expires_on,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

/** Todos los aptos del socio, del vencimiento más nuevo al más viejo. El vigente es `[0]`. */
export async function listMedicalClearances(memberId: number): Promise<MedicalClearance[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('medical_clearances')
    .select('id, member_id, expires_on, storage_path, original_filename, notes, created_at')
    .eq('member_id', memberId)
    .order('expires_on', { ascending: false })
  if (error) throw error

  return (data ?? []).map(mapClearance)
}

/** Un apto puntual, para `getMedicalClearanceUrl`: la action verifica que sea del socio pedido antes de firmar. */
export async function getMedicalClearanceById(id: number): Promise<MedicalClearance | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('medical_clearances')
    .select('id, member_id, expires_on, storage_path, original_filename, notes, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error

  return data ? mapClearance(data) : null
}

/**
 * Inserta la fila. `storagePath` null = apto cargado solo con la fecha (sin
 * adjunto); con valor = el que confirma una subida ya verificada en Storage.
 * Un certificado nuevo es siempre una fila nueva, nunca un UPDATE del vigente.
 */
export async function createMedicalClearance(input: {
  memberId: number
  expiresOn: string
  storagePath: string | null
  originalFilename?: string | null
  notes?: string | null
}): Promise<{ id: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('medical_clearances')
    .insert({
      member_id: input.memberId,
      expires_on: input.expiresOn,
      storage_path: input.storagePath,
      original_filename: input.originalFilename ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return { id: data.id }
}

/** `.select().maybeSingle()` para distinguir un id inexistente (0 filas) de un éxito real (Minor 11 del review). */
export async function updateMedicalClearance(id: number, patch: UpdateClearanceInput): Promise<void> {
  const supabase = await createClient()

  const update: { expires_on?: string; notes?: string | null } = {}
  if (patch.expiresOn !== undefined) update.expires_on = patch.expiresOn
  if (patch.notes !== undefined) update.notes = patch.notes ?? null

  const { data, error } = await supabase.from('medical_clearances').update(update).eq('id', id).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new DomainError('El apto físico no existe', { status: 404 })
}
