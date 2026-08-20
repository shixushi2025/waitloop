export const ACTOR_IDENTITY_COOKIE_NAME = "wl_actor";
export const ACTOR_IDENTITY_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const ACTOR_ID_PATTERN = /^actor_[a-f0-9]{32}$/;
const ACTOR_CREDENTIAL_PATTERN = /^wla_[a-f0-9]{64}$/;

export interface AnonymousActorIdentityV1 {
  version: 1;
  actorId: string;
  credential: string;
}

function randomHexId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function createAnonymousActorIdentity(): AnonymousActorIdentityV1 {
  return {
    version: 1,
    actorId: `actor_${randomHexId()}`,
    credential: `wla_${randomHexId()}${randomHexId()}`,
  };
}

export function parseAnonymousActorIdentity(value: string | null): AnonymousActorIdentityV1 | null {
  if (!value || value.length > 160) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator !== value.lastIndexOf(".")) return null;
  const actorId = value.slice(0, separator);
  const credential = value.slice(separator + 1);
  if (!ACTOR_ID_PATTERN.test(actorId) || !ACTOR_CREDENTIAL_PATTERN.test(credential)) return null;
  return { version: 1, actorId, credential };
}

export function serializeAnonymousActorIdentity(identity: AnonymousActorIdentityV1): string {
  if (!ACTOR_ID_PATTERN.test(identity.actorId) || !ACTOR_CREDENTIAL_PATTERN.test(identity.credential)) {
    throw new Error("Invalid anonymous actor identity.");
  }
  return `${identity.actorId}.${identity.credential}`;
}

export function actorIdentityCookie(identity: AnonymousActorIdentityV1, url: URL): string {
  const parts = [
    `${ACTOR_IDENTITY_COOKIE_NAME}=${serializeAnonymousActorIdentity(identity)}`,
    "Path=/",
    `Max-Age=${ACTOR_IDENTITY_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}
