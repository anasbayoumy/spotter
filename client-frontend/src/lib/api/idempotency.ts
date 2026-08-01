let sequence = 0;

export function createIdempotencyKey(scope: string, resourceId: string): string {
  sequence += 1;
  const resource = resourceId.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 48);
  return `${scope}:${resource}:${Date.now().toString(36)}:${sequence.toString(36)}`;
}
