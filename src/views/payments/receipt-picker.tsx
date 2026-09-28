'use client'

import { useRef, useState } from 'react'
import { Camera, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RECEIPT_ALLOWED_MIME_TYPES, validateReceiptFile } from '@/views/payments/receipt-upload'

/**
 * Selector de comprobante: aparece al elegir "Transferencia" y sigue
 * disponible con "Efectivo" plegado (route-cobranza.md). La subida real pasa
 * recién en el submit (`receipt-upload.ts`): acá solo se elige y valida el
 * archivo, mismo patrón que `MedicalClearanceSection`.
 */
export function ReceiptPicker({
  file,
  onChange,
  disabled,
}: {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function pick(selected: File | null) {
    if (!selected) {
      setError(null)
      onChange(null)
      return
    }
    const message = validateReceiptFile(selected)
    if (message) {
      setError(message)
      onChange(null)
      return
    }
    setError(null)
    onChange(selected)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Comprobante (opcional)</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => cameraInputRef.current?.click()}>
          <Camera aria-hidden />
          Sacar foto
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          <Upload aria-hidden />
          Elegir archivo
        </Button>
        {file ? (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => {
                if (cameraInputRef.current) cameraInputRef.current.value = ''
                if (fileInputRef.current) fileInputRef.current.value = ''
                pick(null)
              }}
              aria-label="Quitar comprobante"
            >
              <X aria-hidden />
            </Button>
          </span>
        ) : null}
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={RECEIPT_ALLOWED_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <p className="text-xs text-muted-foreground">JPG, PNG, WEBP o PDF, hasta 10 MB.</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
