import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Both the main app and its Electron helper can host the plugin process. */
export function cliCommand(execPath: string): string {
  return ["../Resources/bin/paseo", "../../../../Resources/bin/paseo"]
    .map((relative) => resolve(dirname(execPath), relative))
    .find((candidate) => existsSync(candidate)) ?? "paseo";
}

/** Paseo.app bundles a CLI even when the user's PATH has no paseo command. */
export function runCli(home: string, args: string[]): Promise<string> {
  const command = cliCommand(process.execPath);
  return new Promise((resolve, reject) => {
    execFile(command, ["--home", home, ...args], { timeout: 30_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
