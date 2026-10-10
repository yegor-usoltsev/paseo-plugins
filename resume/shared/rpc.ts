import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { basisSchema } from "./status.ts";

export const pendingEntrySchema = z.object({
  agentId: z.string(),
  resumeAt: z.string(),
  basis: basisSchema,
  attempting: z.boolean(),
  jobId: z.string(),
});

export type PendingEntry = z.output<typeof pendingEntrySchema>;

export const listPendingRpc = defineRpc({
  name: "list-pending",
  input: z.object({}),
  output: z.object({ entries: z.array(pendingEntrySchema) }),
});

const agentInput = z.object({ agentId: z.string(), jobId: z.string() });
const actionResult = z.object({ ok: z.boolean(), message: z.string() });

export const resumeNowRpc = defineRpc({
  name: "resume-now",
  input: agentInput,
  output: actionResult,
});

export const cancelResumeRpc = defineRpc({
  name: "cancel-resume",
  input: agentInput,
  output: actionResult,
});
