/**
 * Sesiones inventadas por rol para los tests de controllers. El catálogo de
 * permisos replica `private.permissions_for_role` (migraciones 20260927125000
 * y 20261013120000): si cambia allá, `tests/db/billing.test.ts` y
 * `tests/db/grants-and-lockdown.test.ts` fallan contra la base real, y hay que
 * actualizarlo acá. Así los tests de actions corren el guard REAL de
 * `session.controller` (no un mock que siempre deja pasar).
 */
export type TestRole = 'admin' | 'editor' | 'consulta'

export const PERMISSIONS_BY_ROLE: Record<TestRole, string[]> = {
  admin: [
    'members.read', 'members.write', 'members.status',
    'payments.read', 'payments.register', 'payments.void',
    'billing.configure', 'settings.manage', 'users.manage', 'audit.read',
    'reports.read', 'reports.export',
    'income.read', 'income.register', 'income.void', 'sponsors.deactivate',
  ],
  editor: [
    'members.read', 'members.write',
    'payments.read', 'payments.register',
    'reports.read', 'reports.export',
    'income.read', 'income.register',
  ],
  consulta: ['members.read', 'payments.read', 'reports.read', 'reports.export', 'income.read'],
}

export type SessionMocks = {
  getCurrentUser: { mockResolvedValue: (v: unknown) => unknown }
  getOwnAppUser: { mockResolvedValue: (v: unknown) => unknown }
  getOwnPermissions: { mockResolvedValue: (v: unknown) => unknown }
}

/** Deja los tres bordes de `getSession` como si `role` hubiera iniciado sesión. Overrides por test. */
export function signInAs(
  mocks: SessionMocks,
  role: TestRole,
  overrides: { mustChangePassword?: boolean; isActive?: boolean; permissions?: string[] } = {},
): void {
  mocks.getCurrentUser.mockResolvedValue({ id: `${role}-user-1`, email: `${role}@lonqui.test` })
  mocks.getOwnAppUser.mockResolvedValue({
    displayName: 'Persona de Prueba',
    role,
    isActive: overrides.isActive ?? true,
    mustChangePassword: overrides.mustChangePassword ?? false,
  })
  mocks.getOwnPermissions.mockResolvedValue(overrides.permissions ?? PERMISSIONS_BY_ROLE[role])
}

export function signedOut(mocks: SessionMocks): void {
  mocks.getCurrentUser.mockResolvedValue(null)
}
