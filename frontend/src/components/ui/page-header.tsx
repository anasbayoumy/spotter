import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly eyebrow?: string;
  readonly title: string;
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {actions === undefined ? null : <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
