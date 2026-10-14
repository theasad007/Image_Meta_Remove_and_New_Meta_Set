import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "e2e/report/**",
      "e2e/artifacts/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
