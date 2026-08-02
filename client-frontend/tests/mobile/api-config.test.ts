import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

beforeEach(() => {
  vi.resetModules();
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
});

afterEach(() => {
  vi.doUnmock("react-native");
  if (originalApiBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalApiBaseUrl;
});

async function configurationFor(os: string): Promise<{
  readonly baseUrl: string;
  readonly source: string;
}> {
  vi.doMock("react-native", () => ({ Platform: { OS: os } }));
  const { getApiConfiguration } = await import("../../src/lib/api/config");
  return getApiConfiguration();
}

describe("native runtime API configuration", () => {
  it("maps every supported platform and the generic native fallback", async () => {
    await expect(configurationFor("web")).resolves.toEqual({
      baseUrl: "",
      source: "web-same-origin",
    });
    vi.resetModules();
    await expect(configurationFor("android")).resolves.toMatchObject({
      baseUrl: "http://10.0.2.2:3000",
    });
    vi.resetModules();
    await expect(configurationFor("ios")).resolves.toMatchObject({
      baseUrl: "http://localhost:3000",
    });
    vi.resetModules();
    await expect(configurationFor("windows")).resolves.toMatchObject({
      baseUrl: "http://localhost:3000",
    });
  });

  it("returns the same cached configuration after the environment changes", async () => {
    vi.doMock("react-native", () => ({ Platform: { OS: "web" } }));
    const { getApiConfiguration } = await import("../../src/lib/api/config");
    const first = getApiConfiguration();
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://changed.example.test";
    expect(getApiConfiguration()).toBe(first);
    expect(first.source).toBe("web-same-origin");
  });
});
