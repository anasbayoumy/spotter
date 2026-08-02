// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/queue" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { NavigationLink } from "./navigation-link";

beforeEach(() => {
  navigation.pathname = "/queue";
});

afterEach(cleanup);

describe("NavigationLink", () => {
  it("marks exact and nested non-queue routes as current", () => {
    const exact = render(<NavigationLink href="/queue" icon="queue" label="Review queue" />);
    expect(screen.getByRole("link", { name: "Review queue" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    exact.unmount();

    navigation.pathname = "/clients/client-1";
    render(<NavigationLink href="/clients" icon="client" label="Clients" />);
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute("aria-current", "page");
  });

  it("does not treat queue descendants or unrelated routes as current", () => {
    navigation.pathname = "/queue/candidate-1";
    const queue = render(<NavigationLink href="/queue" icon="scorecard" label="Review queue" />);
    expect(screen.getByRole("link", { name: "Review queue" })).not.toHaveAttribute("aria-current");
    queue.unmount();

    navigation.pathname = "/scorecard";
    render(<NavigationLink href="/clients" icon="client" label="Clients" />);
    expect(screen.getByRole("link", { name: "Clients" })).not.toHaveAttribute("aria-current");
  });
});
