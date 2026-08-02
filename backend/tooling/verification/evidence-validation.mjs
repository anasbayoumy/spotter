const canonicalRequirementPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]{3}$/u;

export function isCanonicalRequirementId(value) {
  return typeof value === "string" && canonicalRequirementPattern.test(value);
}
