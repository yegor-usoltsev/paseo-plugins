import { createElement } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

export const withWebTitle = (
  title: string | undefined,
  content: ReactNode
): ReactNode =>
  Platform.OS === "web"
    ? createElement(
        "span",
        { style: { flexShrink: 1, minWidth: 0 }, title },
        content
      )
    : content;
