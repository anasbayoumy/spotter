import { apiContracts, generateProgrammeRequestSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseBody } from "../../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.programmes.generate.output,
    async (context) => {
      const input = await parseBody(request, generateProgrammeRequestSchema);
      return (await getBackend()).programmes.generate(input, context);
    },
    { mutation: true, successStatus: 201 },
  );
}
