import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) {
    console.error(`Premium E2E setup failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const java = spawnSync("java", ["-version"], { encoding: "utf8" });
const versionText = `${java.stderr ?? ""}\n${java.stdout ?? ""}`;
const match = versionText.match(/version "(\d+)/);
const major = match ? Number(match[1]) : 0;
if (java.error || major < 21) {
  console.error("Premium E2E requires Java 21 or newer for Firebase emulators.");
  process.exit(1);
}

console.log("Building the emulator-configured static app...");
run("npm", ["run", "build"], { ...process.env, NEXT_PUBLIC_FIREBASE_EMULATOR: "1" });

const suite = "node scripts/seed-emulator-premium.mjs && RUN_EMULATOR_E2E=1 npx playwright test e2e/premium-emulator.spec.ts --project=desktop";
run("npx", ["firebase", "emulators:exec", "--project", "demo", "--only", "auth,firestore", suite]);
