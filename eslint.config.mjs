import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Mensajes de no-restricted-imports repetidos entre reglas: una sola fuente
// para no divergir el texto entre overrides.
const NO_SUPABASE_IN_PAGES =
  "El acceso a Postgres vive solo en models/ (CLAUDE.md). Una page o layout no importa @supabase/*: pasá por un controller o un modelo.";
const NO_DATA_FETCHING_IN_VIEWS =
  "Las vistas son presentación pura y no hacen data fetching (CLAUDE.md): cero @supabase/* y cero modelos importados directo en src/views/**.";
const NO_ACTIONS_CROSS_IMPORT =
  "Un *.actions.ts no puede importar otro *.actions.ts (CLAUDE.md). Lo compartido va en el controller de lecturas y se importa desde ahí.";
const NO_UPWARD_IMPORT_FROM_MODELS =
  "src/models/** es la capa más baja del MVC: no puede importar de src/views/** ni de src/controllers/** (CLAUDE.md).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Arquitectura MVC de CLAUDE.md, hecha mecánica: romperla es un error de
  // lint, no un hallazgo de revisión.
  {
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@supabase/*"], message: NO_SUPABASE_IN_PAGES }],
        },
      ],
    },
  },
  {
    files: ["src/views/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@supabase/*"], message: NO_DATA_FETCHING_IN_VIEWS },
            { group: ["@/models/*.model", "@/models/**/*.model"], message: NO_DATA_FETCHING_IN_VIEWS },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ regex: "\\.actions$", message: NO_ACTIONS_CROSS_IMPORT }],
        },
      ],
    },
  },
  {
    files: ["src/models/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/views/**", "@/controllers/**"], message: NO_UPWARD_IMPORT_FROM_MODELS },
          ],
        },
      ],
    },
  },

  // Todo <form> declara method="post". Sin eso, si el JavaScript no llega a
  // cargar (mala señal, un deploy a mitad de camino, un chunk que devuelve
  // 500) el navegador lo manda con su comportamiento nativo: un GET con cada
  // campo en la URL. Pasó: la contraseña del login terminó en la barra de
  // direcciones, en el historial y en los logs del servidor.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='form']:not(:has(JSXAttribute[name.name='method']))",
          message:
            'Todo <form> lleva method="post" (y action si hay Server Action). Sin JS, un form sin method se envía por GET con los campos en la URL (CLAUDE.md).',
        },
      ],
    },
  },

  globalIgnores([
    // Defaults de eslint-config-next, que el override de arriba pisa.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Generado por el CLI de Supabase en cada `start`. No es nuestro y se
    // regenera solo.
    "supabase/.temp/**",

    // Scripts vendorizados de las skills (impeccable trae bundles minificados).
    // Se sobreescriben en cada actualización de la skill: cualquier arreglo acá
    // se pierde, así que linteárlos no puede llevar a ninguna acción.
    ".claude/skills/**",
    ".cursor/skills/**",
    ".agents/skills/**",
  ]),
]);

export default eslintConfig;
