export const MOVEMENT_TAXONOMY_VERSION = "2026-08-02.v1";

const taxonomy = {
  burpee: ["burpee", "burpees", "burpee_broad_jump"],
  calf_raise: ["calf_raise", "standing_calf_raise", "seated_calf_raise"],
  carry: ["carry", "farmers_carry", "farmer_carry", "suitcase_carry"],
  core: ["core", "plank", "dead_bug", "hollow_hold", "sit_up"],
  hinge: ["hinge", "deadlift", "romanian_deadlift", "kettlebell_swing", "good_morning"],
  horizontal_pull: ["horizontal_pull", "row", "dumbbell_row", "cable_row", "inverted_row"],
  horizontal_push: ["horizontal_push", "bench_press", "push_up", "floor_press"],
  knee_flexion: ["knee_flexion", "squat", "back_squat", "front_squat", "goblet_squat", "air_squat"],
  locomotion: ["locomotion", "run", "running", "walk", "walking"],
  lunge: ["lunge", "reverse_lunge", "forward_lunge", "walking_lunge", "split_squat"],
  overhead_press: [
    "overhead_press",
    "push_press",
    "military_press",
    "snatch",
    "handstand_pushup",
    "handstand_push_up",
    "z_press",
  ],
  rowing: ["rowing", "rower", "rowing_erg", "concept2_row"],
  ski_erg: ["ski_erg", "skierg", "ski_ergometer"],
  sled_pull: ["sled_pull", "backward_sled_drag", "rope_sled_pull"],
  sled_push: ["sled_push", "prowler_push"],
  vertical_pull: ["vertical_pull", "pull_up", "chin_up", "lat_pulldown"],
} as const;

export type MovementFamily = keyof typeof taxonomy;

export function normalizeMovementIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");
}

const aliasEntries = Object.entries(taxonomy).flatMap(([family, aliases]) =>
  aliases.map((alias) => [normalizeMovementIdentifier(alias), family] as const),
);
const aliasToFamily: ReadonlyMap<string, MovementFamily> = new Map(
  aliasEntries.map(([alias, family]) => [alias, family as MovementFamily]),
);

export const knownMovementFamilies: ReadonlySet<MovementFamily> = new Set(
  Object.keys(taxonomy) as MovementFamily[],
);

export function resolveMovementFamily(value: string): MovementFamily | null {
  return aliasToFamily.get(normalizeMovementIdentifier(value)) ?? null;
}

export function movementAliases(family: MovementFamily): readonly string[] {
  return taxonomy[family];
}
