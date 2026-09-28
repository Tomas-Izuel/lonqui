import { describe, expect, it } from 'vitest'
import {
  createDisciplineSchema,
  updateDisciplineSchema,
  createCategorySchema,
  updateCategorySchema,
  reorderSchema,
} from '@/models/catalogs.model'

describe('createDisciplineSchema / updateDisciplineSchema', () => {
  it('rechaza nombre vacío', () => {
    expect(createDisciplineSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rechaza un solo carácter (mínimo 2)', () => {
    expect(createDisciplineSchema.safeParse({ name: 'A' }).success).toBe(false)
  })

  it('recorta espacios antes de validar el mínimo', () => {
    expect(createDisciplineSchema.safeParse({ name: '  A  ' }).success).toBe(false)
  })

  it('acepta un nombre válido', () => {
    expect(updateDisciplineSchema.safeParse({ name: 'Vóley' }).success).toBe(true)
  })

  it('rechaza claves desconocidas', () => {
    expect(createDisciplineSchema.safeParse({ name: 'Vóley', sortOrder: 1 }).success).toBe(false)
  })
})

describe('createCategorySchema / updateCategorySchema', () => {
  it('createCategorySchema exige disciplineId entero positivo', () => {
    expect(createCategorySchema.safeParse({ disciplineId: -1, name: '5ta' }).success).toBe(false)
    expect(createCategorySchema.safeParse({ disciplineId: 1, name: '5ta' }).success).toBe(true)
  })

  it('updateCategorySchema no acepta disciplineId (no se puede mover de disciplina desde acá)', () => {
    expect(updateCategorySchema.safeParse({ disciplineId: 1, name: '5ta' }).success).toBe(false)
  })
})

describe('reorderSchema', () => {
  it('exige al menos un id', () => {
    expect(reorderSchema.safeParse({ orderedIds: [] }).success).toBe(false)
  })

  it('acepta una lista de enteros positivos', () => {
    expect(reorderSchema.safeParse({ orderedIds: [3, 1, 2] }).success).toBe(true)
  })

  it('rechaza ids no enteros o no positivos', () => {
    expect(reorderSchema.safeParse({ orderedIds: [1, -2] }).success).toBe(false)
    expect(reorderSchema.safeParse({ orderedIds: [1.5] }).success).toBe(false)
  })
})
