/**
 * URLs de las pestañas de Ajustes. Las usan las vistas de OTROS módulos para
 * el enlace "Editar …" (pipeline 2026-10-15-ajustes-pestanas, punto 4): una
 * sola fuente, así renombrar una pestaña no deja links rotos.
 */
export const SETTINGS_LINKS = {
  fees: '/ajustes/cuotas',
  sports: '/ajustes/deportes',
  cash: '/ajustes/caja',
  club: '/ajustes/club',
} as const
