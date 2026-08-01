import { Redirect } from "expo-router";
import type { ReactElement } from "react";

import { Notice } from "../components/Notice";
import { Screen } from "../components/Screen";
import { useClientSelection } from "../features/client-selector/SelectionProvider";

export default function IndexRoute(): ReactElement {
  const { clientId, error, loading } = useClientSelection();
  if (loading) {
    return (
      <Screen title="Opening Spotter">
        <Notice live title="Loading local demo selection">
          Checking this device for a previously selected synthetic client.
        </Notice>
      </Screen>
    );
  }
  if (error !== null) {
    return (
      <Screen title="Choose a demo client">
        <Notice title="Local selection was reset" tone="attention">
          {error}
        </Notice>
        <Redirect href="/select-client" />
      </Screen>
    );
  }
  return <Redirect href={clientId === null ? "/select-client" : "/today"} />;
}
