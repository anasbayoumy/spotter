// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../lib/api/client";
import { EmptyState, ErrorState, InlineStatus, LoadingState } from "./states";

afterEach(() => {
  cleanup();
});

describe("accessible async states", () => {
  it("announces a request-bearing service failure and offers retry", () => {
    const retry = vi.fn();
    render(
      <ErrorState
        error={
          new ApiClientError(
            "version_conflict",
            "The proposal changed.",
            "request-12345678",
            false,
            409,
          )
        }
        onRetry={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The proposal changed.");
    expect(screen.getByText("request-12345678")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("distinguishes offline, loading, and empty states semantically", () => {
    const { rerender } = render(
      <ErrorState
        error={new ApiClientError("network_error", "No connection.", null, true, null)}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Spotter is offline");

    rerender(<LoadingState label="Loading review evidence" />);
    expect(screen.getByRole("status", { name: "Loading review evidence" })).toBeInTheDocument();

    rerender(<EmptyState body="No queued programmes." title="Nothing needs review" />);
    expect(screen.getByText("Nothing needs review")).toBeInTheDocument();
  });

  it("renders custom state content and status tone accessibly", () => {
    const { rerender } = render(
      <EmptyState
        action={<a href="/clients/fixture">Open client</a>}
        body="No queued programmes."
        title="Nothing needs review"
      />,
    );
    expect(screen.getByRole("link", { name: "Open client" })).toHaveAttribute(
      "href",
      "/clients/fixture",
    );

    rerender(<InlineStatus tone="success">Programme published.</InlineStatus>);
    expect(screen.getByRole("status")).toHaveClass("inline-status--success");

    rerender(<InlineStatus>Review is still pending.</InlineStatus>);
    expect(screen.getByRole("status")).toHaveClass("inline-status--info");
  });

  it("supports a custom error title without inventing a retry action", () => {
    render(
      <ErrorState
        error={new ApiClientError("not_found", "No matching trace.", null, false, 404)}
        title="Trace unavailable"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Trace unavailable");
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
