import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { basisSchema } from "../shared/rpc.ts";

const pendingSchema = z.object({
  basis: basisSchema,
  parentAgentId: z.string().min(1).nullable(),
  resumeAt: z.iso.datetime(),
  rowId: z.string().min(1),
  workspaceId: z.string().nullable().default(null),
});
export type PendingResume = z.output<typeof pendingSchema>;
const stateSchema = z.record(z.string(), z.unknown());

export class PendingStore {
  private readonly path: string;
  private entries: Map<string, PendingResume>;

  constructor(paseoHome: string) {
    const xdgStateHome = process.env.XDG_STATE_HOME ?? "";
    const stateHome =
      xdgStateHome === ""
        ? path.join(homedir(), ".local", "state")
        : xdgStateHome;
    const digest = createHash("sha256")
      .update(paseoHome)
      .digest("hex")
      .slice(0, 12);
    this.path = path.join(stateHome, "paseo-resume", `${digest}.json`);
    this.entries = new Map(Object.entries(this.read()));
  }

  all(): [string, PendingResume][] {
    return [...this.entries];
  }

  get(agentId: string): PendingResume | undefined {
    return this.entries.get(agentId);
  }

  set(agentId: string, entry: PendingResume): void {
    const entries = new Map(this.entries).set(agentId, entry);
    this.write(entries);
    this.entries = entries;
  }

  delete(agentId: string): boolean {
    if (!this.entries.has(agentId)) {
      return false;
    }
    const entries = new Map(this.entries);
    entries.delete(agentId);
    this.write(entries);
    this.entries = entries;
    return true;
  }

  private read(): Record<string, PendingResume> {
    let data: z.output<typeof stateSchema>;
    try {
      data = stateSchema.parse(JSON.parse(readFileSync(this.path, "utf-8")));
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        console.error(`Cannot read pending resumes from ${this.path}`, error);
      }
      return {};
    }
    return Object.fromEntries(
      Object.entries(data).flatMap(([id, value]) => {
        const parsed = pendingSchema.safeParse(value);
        if (parsed.success) {
          return [[id, parsed.data]];
        }
        console.error(
          `Ignoring invalid pending resume for ${id}`,
          parsed.error
        );
        return [];
      })
    );
  }

  private write(entries: Map<string, PendingResume>): void {
    mkdirSync(path.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
    );
    renameSync(temporary, this.path);
  }
}
