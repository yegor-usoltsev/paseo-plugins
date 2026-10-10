import { createElement } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

// The plugin's only DOM element. React Native has no hover tooltip, so on the
// web the heading sits in a span whose title shows the full agent title;
// accessibilityHint carries the same text for assistive technology.
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
