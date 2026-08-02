const redFlagPatterns: readonly Readonly<{ code: string; pattern: RegExp }>[] = [
  { code: "chest_pain", pattern: /\bchest\s+(?:pain|pressure|tightness)\b/iu },
  {
    code: "loss_of_consciousness",
    pattern: /\b(?:faint(?:ed|ing)?|passed\s+out|loss\s+of\s+consciousness)\b/iu,
  },
  {
    code: "self_harm",
    pattern: /\b(?:suicid(?:e|al)|kill\s+myself|self[-\s]?harm|hurt\s+myself)\b/iu,
  },
];

export function detectRedFlags(text: string): readonly string[] {
  return redFlagPatterns
    .filter(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    })
    .map(({ code }) => code);
}
