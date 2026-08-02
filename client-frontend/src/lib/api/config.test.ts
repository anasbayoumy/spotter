import { describe, expect, it } from "vitest";

import { PublicConfigurationError, resolveApiConfiguration } from "./public-configuration";

describe("public API configuration", () => {
  it("uses same-origin web and explicit simulator-native defaults", () => {
    expect(resolveApiConfiguration(undefined, "web")).toEqual({
      baseUrl: "",
      source: "web-same-origin",
    });
    expect(resolveApiConfiguration(undefined, "android").baseUrl).toBe("http://10.0.2.2:3000");
    expect(resolveApiConfiguration(undefined, "ios").baseUrl).toBe("http://localhost:3000");
  });

  it("normalizes a safe public origin and rejects unsafe URL forms", () => {
    expect(resolveApiConfiguration(" https://api.example.test/ ", "web")).toEqual({
      baseUrl: "https://api.example.test",
      source: "environment",
    });
    expect(() => resolveApiConfiguration("not-a-url", "web")).toThrow(PublicConfigurationError);
    expect(() => resolveApiConfiguration("https://user:secret@example.test", "web")).toThrow(
      PublicConfigurationError,
    );
    expect(() => resolveApiConfiguration("https://api.example.test/api/v1", "web")).toThrow(
      PublicConfigurationError,
    );
  });
});
