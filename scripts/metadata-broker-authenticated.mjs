// Host-only composition: request authorization, transport and credentials are
// trusted configuration. This is not an HTTP handler or an activated service.
import { authenticateController } from "./metadata-broker-identity.mjs";
import {
  captureBrokerDiagnostic,
  validateBrokerRequest,
} from "./metadata-broker-prototype.mjs";
export async function captureAuthenticatedDiagnostic(token, request, host) {
  try {
    const now = host.now ?? (() => new Date());
    const reviewed = structuredClone(host.reviewedAuthorization);
    const identity = authenticateController(
      token,
      host.jwks,
      { controller_sha: reviewed.controller_sha },
      now(),
    );
    validateBrokerRequest(request, reviewed, now());
    if (Date.parse(reviewed.expires_at) > Date.parse(identity.expires_at))
      throw Error();
    const currentTime = () => {
      const at = now();
      if (at.getTime() >= Date.parse(identity.expires_at)) throw Error();
      return at;
    };
    return await captureBrokerDiagnostic(request, reviewed, {
      now: currentTime,
      reserve: host.reserve,
      readCatalog: host.readCatalog,
    });
  } catch {
    throw new Error("Authenticated broker capture denied");
  }
}
