import {
  accountabilityModelOutputSchema,
  adjustmentModelOutputSchema,
  programmeModelOutputSchema,
} from "@spotter/contracts";

import { LiveModelGateway } from "./live-gateway";
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse } from "./model-gateway";
import type { ModelRunTelemetryStore } from "./model-run-telemetry";
import { OpenAICompatibleTransport, type SchemaTelemetry } from "./openai-compatible-transport";

export interface OpenAICompatibleGatewayOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly telemetry: ModelRunTelemetryStore;
}

const outputByIntent = {
  accountability: {
    description:
      '{"kind":"client_nudge"|"reduced_plan_offer"|"coach_context_brief","tier":1|2|3,"body":"non-empty text <=1000 chars","citations":[{"sectionId":"exact supplied section id","recordIds":["exact supplied UUID"],"claim":"supported claim"}]}. The kind must be client_nudge for tier 1, reduced_plan_offer for tier 2, and coach_context_brief for tier 3. No other keys.',
    name: "accountabilityModelOutputSchema",
    schema: accountabilityModelOutputSchema,
  },
  adjustment: {
    description:
      '{"operations":[one or more of {"type":"reduce_load","exerciseId":"existing UUID","percent":1..100,"rationale":"non-empty"} OR {"type":"reduce_volume","exerciseId":"existing UUID","setsToRemove":1..20 integer,"rationale":"non-empty"} OR {"type":"swap_exercise","exerciseId":"existing UUID","replacementName":"catalogue name","replacementFamily":"catalogue family","equivalenceId":"catalogue UUID","rationale":"non-empty"}],"citations":[{"sectionId":"exact supplied section id","recordIds":["exact supplied UUID"],"claim":"supported claim"}]}. No other keys.',
    name: "adjustmentModelOutputSchema",
    schema: adjustmentModelOutputSchema,
  },
  programme: {
    description:
      '{"payload":{"summary":"non-empty text","days":[{"dayIndex":1,"scheduledDate":"YYYY-MM-DD","focus":"non-empty text","exercises":[{"id":"UUID from context","name":"non-empty text","family":"known movement family from context","muscleGroups":["non-empty text"],"sets":1..20 integer,"reps":1..200 integer OR {"min":1..200,"max":1..200},"loadKg":number|null optional,"rpe":1..10,"restSeconds":0..900 integer|null,"notes":string|null}]}]},"citations":[{"sectionId":"exact supplied section id","recordIds":["exact supplied UUID"],"claim":"supported claim"}]}. Day indexes and dates must be unique. No other keys.',
    name: "programmeModelOutputSchema",
    schema: programmeModelOutputSchema,
  },
} as const;

export function agentOutputDescription(intent: ModelGatewayRequest["intent"]): string {
  return outputByIntent[intent].description;
}

export class OpenAICompatibleModelGateway implements ModelGateway {
  public readonly mode = "live" as const;
  public readonly modelId: string;

  public constructor(private readonly options: OpenAICompatibleGatewayOptions) {
    this.modelId = options.modelId.trim();
  }

  public generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    const output = outputByIntent[request.intent];
    this.options.telemetry.begin(request.traceId, { mode: this.mode, modelId: this.modelId });
    const transport = new OpenAICompatibleTransport({
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      onSchemaTelemetry: (telemetry) => {
        this.options.telemetry.record(request.traceId, telemetry);
      },
      outputDescription: agentOutputDescription(request.intent),
      outputSchema: output.schema,
      schemaName: output.name,
    });
    return new LiveModelGateway(transport, { modelId: this.modelId }).generate(request);
  }

  public takeSchemaTelemetry(traceId: string): SchemaTelemetry {
    const telemetry = this.options.telemetry.take(traceId);
    return {
      schemaFailure: telemetry.schemaFailure,
      schemaRetryCount: telemetry.schemaRetryCount,
    };
  }
}
