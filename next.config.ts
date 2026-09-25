import type { NextConfig } from 'next'

/**
 * Ojo: este archivo se evalúa ANTES de que Next cargue los `.env`. Una
 * `process.env` acá llega vacía (ver trampas en CLAUDE.md).
 */

async function headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        // El panel maneja datos personales de menores: no hay ningún motivo
        // para que otro sitio lo pueda embeber en un iframe.
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Subir el certificado de apto físico con `<input type="file"
        // capture>` abre la cámara nativa del teléfono y no pasa por esta
        // política; `camera=()` solo bloquea `getUserMedia`, que no usamos.
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
        },
      ],
    },
  ]
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers,
}

export default nextConfig
