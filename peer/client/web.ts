import { createElement } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

/**
 * Shows a hover tooltip on the web, the plugin's only DOM element. React
 * Native has no tooltip, so on the web the content sits in a span whose title
 * shows the text; accessibilityHint carries it for assistive technology.
 *
 * @param title - The tooltip text.
 * @param content - The element the tooltip belongs to.
 * @returns The content, wrapped in a titled span on the web.
 */
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
