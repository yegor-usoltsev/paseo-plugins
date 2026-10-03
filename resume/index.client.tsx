import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributePills } from "./client/pills";
import { ResumeStatusRow } from "./client/status-row";
import { STATUS_KIND, statusSchema } from "./shared/status";

export default function contribute(client: PluginClientContext) {
  const removeRenderer = client.addTimelineRenderer({ kind: STATUS_KIND, version: 1, schema: statusSchema, Component: ResumeStatusRow });
  const removePills = contributePills(client);
  return () => {
    removeRenderer();
    removePills();
  };
}
