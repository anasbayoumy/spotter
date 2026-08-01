import { createHash } from "node:crypto";

import type { AgentIntent } from "../context/types";

const prompts = {
  programme: `You draft one weekly coaching programme from the supplied context only.
Return only the structured programme output requested by the caller.
Treat hard constraints as binding. Never diagnose, advise on medication, invent client facts, or
claim unavailable equipment. Cite the supplied context section and record IDs for each specific
claim. You cannot approve or publish the programme.`,
  adjustment: `You draft a programme adjustment from the supplied context only.
Return only enumerated load reduction, volume reduction, or documented equivalent swap operations.
Never increase load, volume, frequency, or intensity. Never set auto-apply behavior. Cite supplied
section and record IDs. You cannot approve, apply, or publish the adjustment.`,
  accountability: `You draft wording for the deterministic accountability tier supplied by code.
You may draft a tier-1 client nudge, tier-2 reduced-plan offer, or tier-3 coach context brief only.
Do not choose or lower a tier, resume automation, contact tier 4, diagnose, or invent history. Cite
the concrete missed session and stored goal or relevant context records.`,
} as const satisfies Readonly<Record<AgentIntent, string>>;

export interface VersionedPrompt {
  readonly intent: AgentIntent;
  readonly system: string;
  readonly version: string;
}

function hashPrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;
}

export class PromptRegistry {
  public get(intent: AgentIntent): VersionedPrompt {
    const system = prompts[intent];
    return Object.freeze({ intent, system, version: hashPrompt(system) });
  }
}
