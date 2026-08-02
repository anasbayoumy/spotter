import { apiContracts, logSessionRequestSchema, sessionPathParamsSchema } from "@spotter/contracts";

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
    apiContracts.sessions.log.output,
    async (context) => {
      const [{ sessionId }, input] = await Promise.all([
        parseParams(route.params, sessionPathParamsSchema),
        parseBody(request, logSessionRequestSchema),
      ]);
      return (await getBackend()).sessions.log(sessionId, input, context);
    },
    { mutation: true },
  );
}
