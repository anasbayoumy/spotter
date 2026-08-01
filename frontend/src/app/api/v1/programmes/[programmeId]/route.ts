import {
  apiContracts,
  editProgrammeRequestSchema,
  programmePathParamsSchema,
} from "@spotter/contracts";

import {
  apiRoute,
  getBackend,
  parseBody,
  parseParams,
  type DynamicRouteContext,
} from "../../_shared";

export function GET(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(request, apiContracts.programmes.detail.output, async (context) => {
    const { programmeId } = await parseParams(route.params, programmePathParamsSchema);
    return (await getBackend()).programmes.detail(programmeId, context);
  });
}

export function PATCH(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.programmes.edit.output,
    async (context) => {
      const [{ programmeId }, input] = await Promise.all([
        parseParams(route.params, programmePathParamsSchema),
        parseBody(request, editProgrammeRequestSchema),
      ]);
      return (await getBackend()).programmes.edit(programmeId, input, context);
    },
    { mutation: true },
  );
}
