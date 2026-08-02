"use client";

import { Activity, ClipboardList, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavigationLinkProps {
  readonly href: string;
  readonly icon: "client" | "queue" | "scorecard";
  readonly label: string;
}

const icons = { client: UserRound, queue: ClipboardList, scorecard: Activity } as const;

export function NavigationLink({ href, icon, label }: NavigationLinkProps): React.JSX.Element {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/queue" && pathname.startsWith(`${href}/`));
  const Icon = icons[icon];
  return (
    <Link aria-current={active ? "page" : undefined} className="nav-link" href={href}>
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
    </Link>
  );
}
