import type { ContextSection } from "./types.js";

export function renderContext(sections: readonly ContextSection[]): string {
  return sections
    .map(
      (section) =>
        `## ${section.id}\nkind=${section.kind}; pinned=${String(section.pinned)}\n${section.rendered}`,
    )
    .join("\n\n");
}
