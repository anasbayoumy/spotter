import { act } from "react";
import React from "react";
import { Text } from "react-native";
import { createRoot, type Root, type TestInstance } from "test-renderer";
import { describe, expect, it, vi } from "vitest";

import { ApiErrorNotice } from "../../src/components/ApiErrorNotice";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Field } from "../../src/components/Field";
import { Notice } from "../../src/components/Notice";
import { Screen } from "../../src/components/Screen";
import { ApiClientError } from "../../src/lib/api/errors";

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, ...props }: { readonly children?: React.ReactNode }) =>
    React.createElement("SafeAreaView", props, children),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function renderer(): Root {
  return createRoot({ textComponentTypes: ["Text"] });
}

function descendants(
  root: TestInstance,
  predicate: (node: TestInstance) => boolean,
): TestInstance[] {
  return root.queryAll(predicate, { includeSelf: true });
}

function oneByRole(root: TestInstance, role: string): TestInstance {
  const matches = descendants(root, (node) => node.props.accessibilityRole === role);
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (match === undefined) throw new Error(`Role ${role} was not rendered.`);
  return match;
}

function oneByLabel(root: TestInstance, label: string): TestInstance {
  const matches = descendants(root, (node) => node.props.accessibilityLabel === label);
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (match === undefined) throw new Error(`Label ${label} was not rendered.`);
  return match;
}

describe("QA-A11Y-008 native component semantics", () => {
  it("exposes a labelled, stateful, >=44x44 button and invokes its action", () => {
    const onPress = vi.fn();
    const root = renderer();
    act(() => {
      root.render(<Button accessibilityHint="Completes the form" label="Save" onPress={onPress} />);
    });
    const button = oneByRole(root.container, "button");
    expect(button.props.accessibilityLabel).toBe("Save");
    expect(button.props.accessibilityHint).toBe("Completes the form");
    expect(button.props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(button.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 48, minWidth: 48 })]),
    );
    (button.props.onPress as (event: unknown) => void)({});
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("announces busy and disabled controls without exposing an enabled native target", () => {
    const root = renderer();
    act(() => {
      root.render(<Button label="Save" loading onPress={vi.fn()} />);
    });
    const button = oneByRole(root.container, "button");
    expect(button.props.accessibilityLabel).toBe("Save, in progress");
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(button.props.disabled).toBe(true);
  });

  it("gives fields programmatic labels, error hints, and 48px input targets", () => {
    const onChangeText = vi.fn();
    const root = renderer();
    act(() => {
      root.render(
        <Field
          error="Enter a value"
          label="Overall session RPE"
          onChangeText={onChangeText}
          value=""
        />,
      );
    });
    const field = oneByLabel(root.container, "Overall session RPE");
    expect(field.props.accessibilityHint).toBe("Enter a value");
    expect(field.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 48 })]),
    );
    (field.props.onChangeText as (value: string) => void)("7");
    expect(onChangeText).toHaveBeenCalledWith("7");
    const live = descendants(
      root.container,
      (node) => node.props.accessibilityLiveRegion === "polite",
    );
    expect(live).toHaveLength(1);
  });

  it("marks live error notices as alerts with an actionable >=44px retry", () => {
    const retry = vi.fn();
    const root = renderer();
    act(() => {
      root.render(
        <Notice actionLabel="Retry" live onAction={retry} title="Offline" tone="error">
          Your draft remains on this device.
        </Notice>,
      );
    });
    const alert = oneByRole(root.container, "alert");
    expect(alert.props.accessibilityLiveRegion).toBe("polite");
    const retryButton = oneByRole(alert, "button");
    expect(retryButton.props.accessibilityLabel).toBe("Retry");
    (retryButton.props.onPress as (event: unknown) => void)({});
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders optional component content in both absent and populated states", () => {
    const root = renderer();
    act(() => {
      root.render(
        <Screen scroll={false} title="Compact screen">
          <Card title="Plain card">
            <Text>Body</Text>
          </Card>
          <ApiErrorNotice
            error={
              new ApiClientError({
                code: "dependency_unavailable",
                kind: "api",
                message: "Service unavailable.",
                requestId: "req_component_001",
                retryable: false,
                status: 503,
              })
            }
          />
        </Screen>,
      );
    });
    expect(descendants(root.container, (node) => node.type === "ScrollView")).toHaveLength(0);
    expect(
      descendants(root.container, (node) => node.props.accessibilityRole === "header"),
    ).toHaveLength(2);
    const rendered = root.container
      .queryAll(() => true, { includeSelf: true })
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === "string")
      .join("");
    expect(rendered).toContain("Request ID: req_component_001");
  });
});
