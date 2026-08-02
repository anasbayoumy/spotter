import type { ReactNode } from "react";

export interface DefinitionItem {
  readonly label: string;
  readonly value: ReactNode;
}

export function DefinitionList({
  items,
}: {
  readonly items: readonly DefinitionItem[];
}): React.JSX.Element {
  return (
    <dl className="definition-list">
      {items.map((item) => (
        <div className="definition-list__item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
