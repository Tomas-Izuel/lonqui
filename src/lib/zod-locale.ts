import { z } from 'zod'

/**
 * Red de seguridad: los mensajes por defecto de Zod v4 están en inglés ("Too
 * small: expected string to have >=1 characters"). Toda regla de un formulario
 * tiene que llevar su mensaje explícito; esto es lo que ve el usuario si a
 * alguna se le escapa, en vez de un texto en inglés.
 *
 * `z.config` es global por runtime, así que se importa por efecto desde un
 * módulo que cargan todos los caminos: `lib/errors.ts` en el servidor (lo
 * importan todos los modelos) y `views/shared/form-fields.tsx` en el cliente
 * (lo importan todos los formularios).
 */
z.config(z.locales.es())
