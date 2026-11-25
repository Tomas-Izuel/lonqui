/**
 * Etiquetas en español de la app de socios. Los enums del dominio están en
 * inglés (`models/types.ts`); este es el único lugar que los traduce para la
 * Comisión.
 */

import type {
  PortalAccountStatus,
  PortalCandidateReason,
  PortalRelationship,
  PortalRequestStatus,
  PortalTokenDelivery,
  PortalTokenPurpose,
  PortalTokenState,
} from '@/models/types'

/** Evidencia de una sugerencia, en palabras de la Comisión (00 §4.H). */
export const candidateReasonLabels: Record<PortalCandidateReason, string> = {
  dni: 'DNI coincide',
  phone: 'Teléfono coincide',
  payer_phone: 'Teléfono del responsable del grupo',
  email: 'Email coincide',
  name: 'Nombre parecido',
}

export const relationshipLabels: Record<PortalRelationship, string> = {
  self: 'El propio socio',
  guardian: 'Madre, padre o tutor del socio',
}

/** Cómo se lee el vínculo de una cuenta ya creada. */
export const linkRelationshipLabels: Record<PortalRelationship, string> = {
  self: 'Es el socio',
  guardian: 'Responde por el socio',
}

export const tokenStateLabels: Record<PortalTokenState, string> = {
  pending: 'Vigente',
  consumed: 'Usada',
  revoked: 'Anulada',
  expired: 'Vencida',
  locked: 'Bloqueada',
}

export const tokenPurposeLabels: Record<PortalTokenPurpose, string> = {
  invite: 'Invitación',
  login: 'Enlace de ingreso',
}

export const deliveryLabels: Record<PortalTokenDelivery, string> = {
  whatsapp: 'WhatsApp',
  qr: 'QR en pantalla',
}

export const accountStatusLabels: Record<PortalAccountStatus, string> = {
  active: 'Activa',
  blocked: 'Bloqueada',
}

export const requestStatusLabels: Record<PortalRequestStatus, string> = {
  pending: 'Pendiente',
  invited: 'Invitada',
  completed: 'Completada',
  rejected: 'Rechazada',
}
