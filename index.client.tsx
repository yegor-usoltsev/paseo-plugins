import type { PluginClientContext } from "@getpaseo/plugin/client";

import { contributePills } from "./client/pills.tsx";

export default function contribute(client: PluginClientContext) {
  return contributePills(client);
}
