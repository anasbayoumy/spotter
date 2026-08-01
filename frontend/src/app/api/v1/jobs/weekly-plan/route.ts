import { apiContracts, weeklyPlanJobRequestSchema } from "@spotter/contracts";

import { apiRoute, assertCronSecret, getBackend, parseBody } from "../../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.jobs.weeklyPlan.output,
    async (context) => {
      const input = await parseBody(request, weeklyPlanJobRequestSchema);
      return (await getBackend()).jobs.weeklyPlan(input, context);
    },
    { authorize: assertCronSecret, mutation: true },
  );
}
