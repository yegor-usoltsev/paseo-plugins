import { z } from "zod";

export const STATUS_KIND = "resume-status";
export const STATUS_ROW_ID = "resume";

// Why the resume waits until its time: a known provider reset, a fallback
// guess because no reset time was known, or a retry after a failed delivery.
export const basisSchema = z.enum(["reset", "estimate", "retry"]);

export type ResumeBasis = z.output<typeof basisSchema>;

export const statusSchema = z.object({
  at: z.string(),
  basis: basisSchema.optional(),
  state: z.enum(["scheduled", "resumed", "cancelled", "rescheduled"]),
});

export type ResumeStatus = z.output<typeof statusSchema>;
