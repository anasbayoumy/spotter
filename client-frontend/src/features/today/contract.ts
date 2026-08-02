import type { Today } from "@spotter/contracts";

import { ApiClientError } from "../../lib/api/errors";

export function assertPublishedToday(today: Today): Today {
  if (
    today.programme !== null &&
    (today.programme.status !== "published" || today.programme.supersededBy !== null)
  ) {
    throw new ApiClientError({
      code: "invalid_response",
      kind: "contract",
      message: "Today returned programme content that is not currently published.",
      retryable: false,
    });
  }
  if (today.programme === null && (today.session !== null || today.nextSession !== null)) {
    throw new ApiClientError({
      code: "invalid_response",
      kind: "contract",
      message: "Today returned a session without a current published programme.",
      retryable: false,
    });
  }
  if (
    today.programme !== null &&
    ((today.session !== null && today.session.programmeId !== today.programme.id) ||
      (today.nextSession !== null && today.nextSession.programmeId !== today.programme.id))
  ) {
    throw new ApiClientError({
      code: "invalid_response",
      kind: "contract",
      message: "Today returned a session outside the current published programme.",
      retryable: false,
    });
  }
  return today;
}
