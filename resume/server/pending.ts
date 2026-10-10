import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ResumeBasis } from "../shared/status";

/** A scheduled resume, as the state file stores it. */
export interface PendingResume {
  resumeAt: string;
  parentAgentId: string | null;
  basis?: ResumeBasis;
  // The chat row that reports this limit stop.
  rowId?: string;
}

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const isPendingResume = (value: unknown): value is PendingResume =>
  isObject(value) &&
  "resumeAt" in value &&
  typeof value.resumeAt === "string" &&
  !Number.isNaN(Date.parse(value.resumeAt));

/** Pending resumes, persisted so they survive a daemon restart. */
export class PendingStore {
  private readonly path: string;
  private readonly entries: Map<string, PendingResume>;

  /**
   * Loads the pending resumes of a Paseo home from the state directory.
   *
   * @param paseoHome - The Paseo home whose resumes to load.
   */
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

  /** @returns Every pending resume with its agent ID. */
  all(): [string, PendingResume][] {
    return [...this.entries];
  }

  /**
   * @param agentId - The agent to look up.
   * @returns The agent's pending resume, if any.
   */
  get(agentId: string): PendingResume | undefined {
    return this.entries.get(agentId);
  }

  /**
   * Saves an agent's pending resume, replacing any earlier one.
   *
   * @param agentId - The agent to resume.
   * @param entry - The resume to save.
   */
  set(agentId: string, entry: PendingResume): void {
    this.entries.set(agentId, entry);
    this.write();
  }

  /**
   * Removes an agent's pending resume.
   *
   * @param agentId - The agent whose resume to remove.
   * @returns Whether a resume existed.
   */
  delete(agentId: string): boolean {
    const existed = this.entries.delete(agentId);
    if (existed) {
      this.write();
    }
    return existed;
  }

  private read(): Record<string, PendingResume> {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return {};
    }
    const valid = Object.entries(isObject(data) ? data : {}).filter(
      (pair): pair is [string, PendingResume] => isPendingResume(pair[1])
    );
    return Object.fromEntries(valid);
  }

  private write(): void {
    mkdirSync(path.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify(Object.fromEntries(this.entries), null, 2)}\n`
    );
    renameSync(temporary, this.path);
  }
}
