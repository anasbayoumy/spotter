import React, {
  forwardRef,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";

type NativeProps = Readonly<Record<string, unknown>> & { readonly children?: ReactNode };

function host(name: string): ForwardRefExoticComponent<NativeProps & RefAttributes<unknown>> {
  return forwardRef<unknown, NativeProps>(function NativeHost({ children, ...props }, ref) {
    return React.createElement(name, { ...props, ref }, children as ReactNode);
  });
}

export const ActivityIndicator = host("ActivityIndicator");
export const Text = host("Text");
export const TextInput = host("TextInput");
export const View = host("View");
export const Switch = host("Switch");
export const ScrollView = host("ScrollView");

function isStyleFunction(
  value: unknown,
): value is (state: { readonly pressed: boolean }) => unknown {
  return typeof value === "function";
}

export const Pressable = forwardRef<unknown, NativeProps>(function Pressable(
  { children, style, ...props },
  ref,
) {
  const resolvedStyle = isStyleFunction(style) ? style({ pressed: false }) : style;
  return React.createElement(
    "Pressable",
    { ...props, ref, style: resolvedStyle },
    children as ReactNode,
  );
});

export const Platform = {
  OS: "ios",
  select: <T,>(values: { readonly default?: T; readonly ios?: T }) => values.ios ?? values.default,
};
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};
export function useWindowDimensions(): {
  readonly fontScale: number;
  readonly height: number;
  readonly scale: number;
  readonly width: number;
} {
  return { fontScale: 1, height: 844, scale: 2, width: 390 };
}
