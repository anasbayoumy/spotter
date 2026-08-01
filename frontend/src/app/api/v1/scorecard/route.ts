import { apiContracts } from "@spotter/contracts";

import { apiRoute, getBackend } from "../_shared";

export function GET(request: Request): Promise<Response> {
  return apiRoute(request, apiContracts.scorecard.detail.output, async (context) =>
    (await getBackend()).scorecard.detail(context),
  );
}
