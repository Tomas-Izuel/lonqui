import { describe, expect, it } from 'vitest'
import {
  prepareUploadSchema,
  confirmClearanceSchema,
  createClearanceWithoutFileSchema,
  updateClearanceSchema,
  buildMedicalClearancePath,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '@/models/medical-clearances.model'

describe('prepareUploadSchema', () => {
  it('acepta los cuatro MIME del bucket attachments (S4)', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(prepareUploadSchema.safeParse({ memberId: 1, mimeType, sizeBytes: 1000 }).success).toBe(true)
    }
  })

  it('rechaza un MIME fuera de la lista', () => {
    expect(prepareUploadSchema.safeParse({ memberId: 1, mimeType: 'application/zip', sizeBytes: 1000 }).success).toBe(
      false,
    )
  })

  it('rechaza un tamaño mayor a 10 MiB', () => {
    const result = prepareUploadSchema.safeParse({
      memberId: 1,
      mimeType: 'image/jpeg',
      sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
    })
    expect(result.success).toBe(false)
  })

  it('acepta exactamente el límite de 10 MiB', () => {
    expect(
      prepareUploadSchema.safeParse({ memberId: 1, mimeType: 'image/jpeg', sizeBytes: MAX_ATTACHMENT_SIZE_BYTES })
        .success,
    ).toBe(true)
  })

  it('rechaza tamaño negativo o cero', () => {
    expect(prepareUploadSchema.safeParse({ memberId: 1, mimeType: 'image/jpeg', sizeBytes: 0 }).success).toBe(false)
  })
})

describe('confirmClearanceSchema', () => {
  it('acepta el path devuelto por prepareMedicalClearanceUpload', () => {
    const result = confirmClearanceSchema.safeParse({
      memberId: 1,
      path: 'medical-clearances/1/uuid.jpg',
      expiresOn: '2027-01-01',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza path vacío', () => {
    expect(
      confirmClearanceSchema.safeParse({ memberId: 1, path: '', expiresOn: '2027-01-01' }).success,
    ).toBe(false)
  })
})

describe('createClearanceWithoutFileSchema / updateClearanceSchema', () => {
  it('createClearanceWithoutFileSchema no acepta un path (el apto sin adjunto no tiene uno)', () => {
    expect(
      createClearanceWithoutFileSchema.safeParse({
        memberId: 1,
        expiresOn: '2027-01-01',
        path: 'medical-clearances/1/x.jpg',
      }).success,
    ).toBe(false)
  })

  it('updateClearanceSchema solo permite expiresOn y notes (únicas columnas con grant de UPDATE)', () => {
    expect(updateClearanceSchema.safeParse({ expiresOn: '2027-06-01' }).success).toBe(true)
    expect(updateClearanceSchema.safeParse({ memberId: 1, expiresOn: '2027-06-01' }).success).toBe(false)
  })

  it('updateClearanceSchema acepta un patch vacío (nada obligatorio)', () => {
    expect(updateClearanceSchema.safeParse({}).success).toBe(true)
  })
})

describe('buildMedicalClearancePath', () => {
  it('arranca con el prefijo medical-clearances/<memberId>/, el mismo que valida confirmMedicalClearance', () => {
    const path = buildMedicalClearancePath(42, 'image/jpeg')
    expect(path.startsWith('medical-clearances/42/')).toBe(true)
  })

  it('la extensión corresponde al MIME pedido', () => {
    expect(buildMedicalClearancePath(1, 'application/pdf').endsWith('.pdf')).toBe(true)
    expect(buildMedicalClearancePath(1, 'image/png').endsWith('.png')).toBe(true)
    expect(buildMedicalClearancePath(1, 'image/webp').endsWith('.webp')).toBe(true)
    expect(buildMedicalClearancePath(1, 'image/jpeg').endsWith('.jpg')).toBe(true)
  })

  it('dos llamadas para el mismo socio generan rutas distintas (uuid random, sin colisión)', () => {
    const a = buildMedicalClearancePath(1, 'image/jpeg')
    const b = buildMedicalClearancePath(1, 'image/jpeg')
    expect(a).not.toBe(b)
  })
})
