import {
  apiContracts,
  overrideProgrammeRequestSchema,
  programmePathParamsSchema,
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
    apiContracts.programmes.override.output,
    async (context) => {
      const [{ programmeId }, input] = await Promise.all([
        parseParams(route.params, programmePathParamsSchema),
        parseBody(request, overrideProgrammeRequestSchema),
      ]);
      return (await getBackend()).programmes.override(programmeId, input, context);
    },
    { mutation: true },
  );
}
