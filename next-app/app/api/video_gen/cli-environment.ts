import { loadEnvConfig } from "@next/env";
export function loadCliEnvironment(directory = process.cwd()) {
  // Use Next's existing loader/precedence, including .env.local. Existing shell
  // variables win. Contents and secrets are never printed.
  loadEnvConfig(directory, process.env.NODE_ENV !== "production", { info: () => {}, error: () => { throw new Error("Could not load CLI environment files."); } });
}
