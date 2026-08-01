import { Platform } from "react-native";

import {
  resolveApiConfiguration,
  type ApiConfiguration,
  type RuntimePlatform,
} from "./public-configuration";

export { PublicConfigurationError } from "./public-configuration";

let cachedConfiguration: ApiConfiguration | null = null;

export function getApiConfiguration(): ApiConfiguration {
  if (cachedConfiguration !== null) return cachedConfiguration;
  const platform: RuntimePlatform =
    Platform.OS === "web" || Platform.OS === "android" || Platform.OS === "ios"
      ? Platform.OS
      : "native";
  cachedConfiguration = resolveApiConfiguration(process.env.EXPO_PUBLIC_API_BASE_URL, platform);
  return cachedConfiguration;
}
