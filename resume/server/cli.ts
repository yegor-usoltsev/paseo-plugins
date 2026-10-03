import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Paseo.app bundles a CLI even when the user's PATH has no paseo command. */
export function runCli(home: string, args: string[]): Promise<string> {
  const bundled = resolve(dirname(process.execPath), "../Resources/bin/paseo");
  const command = existsSync(bundled) ? bundled : "paseo";
  return new Promise((resolve, reject) => {
    execFile(command, ["--home", home, ...args], { timeout: 30_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
