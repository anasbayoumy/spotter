export class PublicConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicConfigurationError";
  }
}

export type RuntimePlatform = "android" | "ios" | "native" | "web";

export interface ApiConfiguration {
  readonly baseUrl: string;
  readonly source: "environment" | "native-development-default" | "web-same-origin";
}

function normalizeAbsoluteHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicConfigurationError(
      "EXPO_PUBLIC_API_BASE_URL must be an absolute http or https URL.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new PublicConfigurationError(
      "EXPO_PUBLIC_API_BASE_URL must be an http(s) origin without credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

export function resolveApiConfiguration(
  explicitValue: string | undefined,
  platform: RuntimePlatform,
): ApiConfiguration {
  const explicit = explicitValue?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return { baseUrl: normalizeAbsoluteHttpUrl(explicit), source: "environment" };
  }
  if (platform === "web") return { baseUrl: "", source: "web-same-origin" };
  return {
    baseUrl: platform === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000",
    source: "native-development-default",
  };
}
