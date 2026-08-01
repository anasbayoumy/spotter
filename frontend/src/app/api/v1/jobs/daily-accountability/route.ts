import { apiContracts, dailyAccountabilityJobRequestSchema } from "@spotter/contracts";

import { apiRoute, assertCronSecret, getBackend, parseBody } from "../../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.jobs.dailyAccountability.output,
    async (context) => {
      const input = await parseBody(request, dailyAccountabilityJobRequestSchema);
      return (await getBackend()).jobs.dailyAccountability(input, context);
    },
    { authorize: assertCronSecret, mutation: true },
  );
}
