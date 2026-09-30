import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Session restore and scanner hydration intentionally read browser state in effects.
  // Keep the other React Hooks rules active, including dependency checks.
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  globalIgnores([".next/**", ".cache/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]),
]);
