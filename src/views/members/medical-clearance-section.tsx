'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Camera, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { DateField } from '@/views/shared/form-fields'
import { DateText } from '@/views/shared/date-text'
import { medicalClearanceStatusLabels } from '@/views/shared/labels'
import { createClient } from '@/lib/supabase/client'
import { confirmMedicalClearance, createMedicalClearance, prepareMedicalClearanceUpload } from '@/controllers/members.actions'
import type { MedicalClearance, MedicalClearanceStatus } from '@/models/types'

// Duplicado a propósito: `medical-clearances.model.ts` (B2) tiene
// `import 'server-only'` y no se puede importar desde un Client Component.
// Estos valores tienen que seguir coincidiendo con el bucket `attachments` (S4).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024
const COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024
const BUCKET = 'attachments'

const uploadSchema = z.object({ expiresOn: z.string().min(1, 'Elegí la fecha de vencimiento') })
type UploadValues = z.infer<typeof uploadSchema>

const STATUS_TEXT_CLASS: Record<MedicalClearanceStatus, string> = {
  not_required: 'text-muted-foreground',
  missing: 'text-status-in-debt',
  valid: 'text-status-up-to-date',
  expiring: 'text-status-in-debt',
  expired: 'text-status-in-debt',
}

/**
 * Reduce una imagen > 2 MB en el browser antes de subir (brief F2). Los PDF
 * no se procesan acá: un canvas no puede reescribir un PDF, y no hace falta
 * — el límite de 10 MB del bucket ya los cubre en la mayoría de los casos.
 */
async function maybeCompressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= COMPRESS_THRESHOLD_BYTES) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
}

/**
 * Apto físico (route-socios-id.md): estado + vencimiento + "Ver certificado"
 * (URL firmada, ya resuelta por `getMemberPage`) + "Cargar certificado". La
 * subida es progresiva, no un modal (operate.md: "exhaust inline / progressive
 * alternatives first") — se expande debajo del estado actual.
 */
export function MedicalClearanceSection({
  memberId,
  status,
  currentClearance,
  clearanceUrl,
  canManage,
}: {
  memberId: number
  status: MedicalClearanceStatus
  currentClearance: MedicalClearance | null
  clearanceUrl: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'compressing' | 'uploading' | 'saving'>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<UploadValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { expiresOn: currentClearance?.expiresOn ?? '' },
  })

  const busy = stage !== 'idle'

  function pickFile(selected: File | null) {
    setFileError(null)
    if (!selected) {
      setFile(null)
      return
    }
    if (!ALLOWED_MIME_TYPES.includes(selected.type)) {
      setFileError('Formato no admitido. Usá JPG, PNG, WEBP o PDF.')
      return
    }
    if (selected.size > MAX_ATTACHMENT_SIZE_BYTES) {
      setFileError('El archivo no puede pesar más de 10 MB.')
      return
    }
    setFile(selected)
  }

  async function onValid(values: UploadValues) {
    setFormError(null)
    try {
      if (!file) {
        const result = await createMedicalClearance({ memberId, expiresOn: values.expiresOn })
        if (!result.ok) {
          setFormError(result.error)
          return
        }
      } else {
        setStage('compressing')
        const processed = await maybeCompressImage(file)

        setStage('uploading')
        const prep = await prepareMedicalClearanceUpload({ memberId, mimeType: processed.type, sizeBytes: processed.size })
        if (!prep.ok) {
          setFormError(prep.error)
          return
        }

        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(prep.data.path, prep.data.token, processed)
        if (uploadError) {
          setFormError('No pudimos subir el archivo. Probá de nuevo.')
          return
        }

        setStage('saving')
        const confirm = await confirmMedicalClearance({
          memberId,
          path: prep.data.path,
          expiresOn: values.expiresOn,
          originalFilename: file.name,
        })
        if (!confirm.ok) {
          setFormError(confirm.error)
          return
        }
      }

      toast.success('Apto físico actualizado')
      setShowForm(false)
      setFile(null)
      router.refresh()
    } finally {
      setStage('idle')
    }
  }

  if (status === 'not_required' && !currentClearance) {
    return (
      <Panel title="Apto físico">
        <p className="text-sm text-muted-foreground">No aplica: el apto físico es obligatorio solo para menores.</p>
      </Panel>
    )
  }

  return (
    <Panel title="Apto físico">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm font-medium ${STATUS_TEXT_CLASS[status]}`}>{medicalClearanceStatusLabels[status]}</span>
          {currentClearance ? (
            <span className="text-sm text-muted-foreground">
              Vence <DateText date={currentClearance.expiresOn} />
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {clearanceUrl ? (
            <Button asChild variant="outline" className="h-11">
              <a href={clearanceUrl} target="_blank" rel="noopener noreferrer">
                Ver certificado
              </a>
            </Button>
          ) : null}
          {canManage && status !== 'not_required' ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => setShowForm((v) => !v)}>
              {currentClearance ? 'Cargar certificado nuevo' : 'Cargar certificado'}
            </Button>
          ) : null}
        </div>

        {showForm ? (
          <form onSubmit={form.handleSubmit(onValid)} noValidate className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <DateField control={form.control} name="expiresOn" label="Vencimiento" disabled={busy} />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => cameraInputRef.current?.click()}>
                <Camera aria-hidden />
                Tomar foto
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden />
                Elegir archivo
              </Button>
              {file ? <span className="min-w-0 truncate text-sm text-muted-foreground">{file.name}</span> : null}
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIME_TYPES.join(',')}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />

            <p className="text-xs text-muted-foreground">
              Sin archivo se guarda solo la fecha (si ya viste el certificado en papel). JPG, PNG, WEBP o PDF, hasta 10 MB.
            </p>

            {fileError ? (
              <p role="alert" className="text-sm text-destructive">
                {fileError}
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} className="h-11">
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {stage === 'compressing'
                  ? 'Preparando imagen…'
                  : stage === 'uploading'
                    ? 'Subiendo…'
                    : stage === 'saving'
                      ? 'Guardando…'
                      : 'Guardar apto físico'}
              </Button>
              <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Panel>
  )
}
