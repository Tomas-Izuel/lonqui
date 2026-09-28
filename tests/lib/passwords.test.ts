import { describe, expect, it } from 'vitest'
import { generateTemporaryPassword, passwordPolicySchema } from '@/lib/passwords'

describe('passwordPolicySchema', () => {
  it('rechaza menos de 10 caracteres', () => {
    expect(passwordPolicySchema.safeParse('abc12345').success).toBe(false)
  })

  it('rechaza sin ningún dígito', () => {
    expect(passwordPolicySchema.safeParse('sololetras').success).toBe(false)
  })

  it('rechaza sin ninguna letra', () => {
    expect(passwordPolicySchema.safeParse('1234567890').success).toBe(false)
  })

  it('rechaza más de 72 caracteres', () => {
    expect(passwordPolicySchema.safeParse('a1'.repeat(40)).success).toBe(false)
  })

  it('acepta 10+ con letras y números', () => {
    expect(passwordPolicySchema.safeParse('Abcdefg123').success).toBe(true)
  })
})

describe('generateTemporaryPassword', () => {
  it('siempre cumple passwordPolicySchema (la política local de config.toml)', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword()
      const result = passwordPolicySchema.safeParse(password)
      expect(result.success, `"${password}" falló la política: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })

  it('tiene 12 caracteres', () => {
    expect(generateTemporaryPassword()).toHaveLength(12)
  })

  it('nunca usa caracteres ambiguos (0/O, 1/l/I)', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword()
      expect(password).not.toMatch(/[0O1lI]/)
    }
  })

  it('siempre tiene al menos una letra Y al menos un dígito garantizados (no solo probablemente)', () => {
    // Con el alfabeto completo (letras + dígitos) ya es raro que salga sin
    // uno de los dos, pero el generador los FUERZA en dos posiciones: no debe
    // fallar nunca, ni siquiera con muchas corridas.
    for (let i = 0; i < 500; i++) {
      const password = generateTemporaryPassword()
      expect(/[a-zA-Z]/.test(password)).toBe(true)
      expect(/[0-9]/.test(password)).toBe(true)
    }
  })

  it('no repite la misma contraseña entre llamadas (no es determinística)', () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()))
    expect(passwords.size).toBe(50)
  })

  it('solo usa caracteres del alfabeto documentado', () => {
    const allowed = /^[abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/
    for (let i = 0; i < 100; i++) {
      expect(generateTemporaryPassword()).toMatch(allowed)
    }
  })
})
