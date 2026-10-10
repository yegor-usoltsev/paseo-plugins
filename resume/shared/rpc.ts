import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { basisSchema } from "./status.ts";

export const pendingEntrySchema = z.object({
  agentId: z.string(),
  attempting: z.boolean(),
  basis: basisSchema,
  jobId: z.string(),
  resumeAt: z.string(),
});

export type PendingEntry = z.output<typeof pendingEntrySchema>;

export const listPendingRpc = defineRpc({
  input: z.object({}),
  name: "list-pending",
  output: z.object({ entries: z.array(pendingEntrySchema) }),
});

const agentInput = z.object({ agentId: z.string(), jobId: z.string() });
const actionResult = z.object({ message: z.string(), ok: z.boolean() });

export const resumeNowRpc = defineRpc({
  input: agentInput,
  name: "resume-now",
  output: actionResult,
});

export const cancelResumeRpc = defineRpc({
  input: agentInput,
  name: "cancel-resume",
  output: actionResult,
});
