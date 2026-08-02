import {
  apiContracts,
  completeSessionRequestSchema,
  sessionPathParamsSchema,
} from "@spotter/contracts";

import {
  apiRoute,
  getBackend,
  parseBody,
  parseParams,
  type DynamicRouteContext,
} from "../../../_shared";

export function POST(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.sessions.complete.output,
    async (context) => {
      const [{ sessionId }, input] = await Promise.all([
        parseParams(route.params, sessionPathParamsSchema),
        parseBody(request, completeSessionRequestSchema),
      ]);
      return (await getBackend()).sessions.complete(sessionId, input, context);
    },
    { mutation: true },
  );
}
