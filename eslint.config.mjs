import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-static-previous/**",
    "out/**",
    "build/**",
    "backups/**",
    "current/**",
    "releases/**",
    "next-env.d.ts",
    "tsconfig.tsbuildinfo",
  ]),
])
