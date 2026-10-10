import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ResumeBasis } from "../shared/status.ts";

export interface PendingResume {
  resumeAt: string;
  parentAgentId: string | null;
  basis?: ResumeBasis;
  // The chat row that reports this limit stop.
  rowId?: string;
}

/** Pending resumes, persisted so they survive a daemon restart. */
export class PendingStore {
  private readonly path: string;
  private readonly entries: Map<string, PendingResume>;

  constructor(paseoHome: string) {
    const stateHome =
      process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    const digest = createHash("sha256")
      .update(paseoHome)
      .digest("hex")
      .slice(0, 12);
    this.path = join(stateHome, "paseo-resume", `${digest}.json`);
    this.entries = new Map(Object.entries(this.read()));
  }

  all(): [string, PendingResume][] {
    return [...this.entries];
  }

  get(agentId: string): PendingResume | undefined {
    return this.entries.get(agentId);
  }

  set(agentId: string, entry: PendingResume): void {
    this.entries.set(agentId, entry);
    this.write();
  }

  delete(agentId: string): boolean {
    const existed = this.entries.delete(agentId);
    if (existed) this.write();
    return existed;
  }

  private read(): Record<string, PendingResume> {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      return {};
    }
    const valid = Object.entries(
      data && typeof data === "object" ? data : {}
    ).filter(
      ([, entry]) =>
        typeof entry?.resumeAt === "string" &&
        !Number.isNaN(Date.parse(entry.resumeAt))
    );
    return Object.fromEntries(valid) as Record<string, PendingResume>;
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify(Object.fromEntries(this.entries), null, 2)}\n`
    );
    renameSync(temporary, this.path);
  }
}
