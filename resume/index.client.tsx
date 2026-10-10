import type { PluginClientContext } from "@getpaseo/plugin/client";

import { contributePills } from "./client/pills";
import { ResumeStatusRow } from "./client/status-row";
import { STATUS_KIND, statusSchema } from "./shared/status";

export default function contribute(client: PluginClientContext) {
  const removeRenderer = client.addTimelineRenderer({
    Component: ResumeStatusRow,
    kind: STATUS_KIND,
    schema: statusSchema,
    version: 1,
  });
  const removePills = contributePills(client);
  return () => {
    void removeRenderer();
    removePills();
  };
}
