import { describe, expect, it } from "vitest";

import {
  ACTOR_IDENTITY_COOKIE_NAME,
  actorIdentityCookie,
  createAnonymousActorIdentity,
  parseAnonymousActorIdentity,
  serializeAnonymousActorIdentity,
} from "./actor-identity";

describe("anonymous actor identity", () => {
  it("round-trips a generated identity", () => {
    const identity = createAnonymousActorIdentity();
    const serialized = serializeAnonymousActorIdentity(identity);
    expect(parseAnonymousActorIdentity(serialized)).toEqual(identity);
    expect(identity.actorId).toMatch(/^actor_[a-f0-9]{32}$/);
    expect(identity.credential).toMatch(/^wla_[a-f0-9]{64}$/);
  });

  it("rejects malformed or identifier-only values", () => {
    expect(parseAnonymousActorIdentity(null)).toBeNull();
    expect(parseAnonymousActorIdentity("actor_deadbeef")).toBeNull();
    expect(parseAnonymousActorIdentity("actor_00000000000000000000000000000000.bad")).toBeNull();
  });

  it("creates a persistent HttpOnly cookie without exposing the credential in a URL", () => {
    const identity = createAnonymousActorIdentity();
    const cookie = actorIdentityCookie(identity, new URL("https://waitloop.run/game.html"));
    expect(cookie).toContain(`${ACTOR_IDENTITY_COOKIE_NAME}=`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });
});
