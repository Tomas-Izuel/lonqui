import { describe, expect, it } from 'vitest'
import { familyGroupInputSchema, setPaymentResponsibleSchema } from '@/models/family-groups.model'

describe('familyGroupInputSchema', () => {
  it('todos los campos son opcionales: un grupo puede crearse sin nombre ni contacto', () => {
    expect(familyGroupInputSchema.safeParse({}).success).toBe(true)
  })

  it('acepta el contacto de pago libre (para el padre/madre que paga y no es socio)', () => {
    expect(
      familyGroupInputSchema.safeParse({ payerContactName: 'Juan Pérez', payerContactPhone: '+54 9 11 5555-5555' })
        .success,
    ).toBe(true)
  })

  it('rechaza claves desconocidas', () => {
    expect(familyGroupInputSchema.safeParse({ name: 'Familia Pérez', discount: 10 }).success).toBe(false)
  })
})

describe('setPaymentResponsibleSchema', () => {
  it('exige groupId y memberId enteros positivos', () => {
    expect(setPaymentResponsibleSchema.safeParse({ groupId: 1, memberId: 2 }).success).toBe(true)
    expect(setPaymentResponsibleSchema.safeParse({ groupId: -1, memberId: 2 }).success).toBe(false)
    expect(setPaymentResponsibleSchema.safeParse({ groupId: 1, memberId: 0 }).success).toBe(false)
  })
})
