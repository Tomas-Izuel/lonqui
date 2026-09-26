---
version: 1
slug: "route-login"
primary_target: "route:/login"
related_targets: ["route:/cambiar-contrasena"]
---

# Login y cambio de contraseña — `/login`, `/cambiar-contrasena`

Modo: **Operate**. Primer contacto de un miembro de la Comisión con el sistema, casi siempre desde el celular, muchas veces al sol. Sin registro público y **sin mail en la Fase 1**: la cuenta la crea un admin con una contraseña temporal que se pasa en mano, y el sistema obliga a cambiarla en el primer ingreso.

- **Trabajo y audiencia:** entrar con email y contraseña personales en segundos; la primera vez (o después de que un admin la restablezca), elegir una contraseña propia. Siete voluntarios no técnicos; algunos entran una vez por semana y no recuerdan nada.
- **Resultado y prueba:** `/login`: formulario de una columna, botón primario "Ingresar", y debajo un texto (no un link): "¿Te olvidaste la contraseña? Pedile una nueva a un administrador del club." `/cambiar-contrasena`: contraseña actual (la temporal), nueva y repetir, con la política dicha antes de fallar (10+ caracteres, letras y números) y un botón "Guardar contraseña". Obligatoria mientras haya contraseña temporal (sin navegación del panel, solo "Cerrar sesión"); voluntaria después, desde el menú del usuario. Identidad del club visible pero sin vitrina.
- **Estados:** enviando; error genérico de login ("Email o contraseña incorrectos", nunca revela si el email existe); usuario desactivado ("Tu usuario está desactivado. Hablá con un administrador"); contraseña actual incorrecta; nueva igual a la temporal; contraseñas que no coinciden; éxito → al panel con un toast.
- **Interacción:** mobile first, a 390px con una mano; autocompletar habilitado (`autocomplete="current-password"` / `"new-password"`), `inputmode="email"`, mostrar/ocultar contraseña, foco inicial en el primer campo, submit con Enter, targets de 44px, sin captcha.
- **Anti-objetivos:** ningún texto de marketing; ningún "Registrarse"; ningún link de reseteo por mail; ninguna firma del desarrollador; nada de ilustraciones que compitan con el formulario.
- **Dirección seleccionada:** hereda el contrato de dirección del panel (`route:/`): el estándar de la categoría, vara Linear + Mercado Pago. Es la primera superficie que prueba el naranja de texto medido (#C2410C sobre blanco).
