import type { ElementType, ReactNode } from "react";

interface CardProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Card({
  as: Component = "section",
  children,
  className = "",
}: CardProps): React.JSX.Element {
  return <Component className={`card ${className}`.trim()}>{children}</Component>;
}
