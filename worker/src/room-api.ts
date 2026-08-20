import type { GameMoveCommandV1 } from "@waitloop/game-core";

import {
  ACTOR_IDENTITY_COOKIE_NAME,
  actorIdentityCookie,
  createAnonymousActorIdentity,
  parseAnonymousActorIdentity,
  type AnonymousActorIdentityV1,
} from "./actor-identity";
import { GameRoom, type GameJoinInfoV1, type GameRoomSnapshotV1 } from "./game-room";
import { getHostedAgent, type HostedAgentEnv } from "./hosted-agent";
import { apiError, isRecord, json, readJson } from "./http";
import { getHumanHint, resolveHumanCardSelection, toHumanGameSnapshot } from "./human-game";
import type {
  GameActorBindingV1,
  GameActorV1,
  GameSeatV1,
  HostedAgentDescriptorV1,
} from "./participants";
import { isHostedAgentId } from "./participants";
import { createJoinCode, joinCodeHash, normalizeJoinCode, roomIdForJoinCode, selectRandomPlayer } from "./room-code";

export interface RoomApiEnv extends HostedAgentEnv {
  ASSETS: Fetcher;
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  WAITLOOP_ACCESS_TOKEN?: string;
}

type RoomMode = "bots" | "hosted-agent" | "connected-agent" | "companion-agent" | "agent-bots";
type RoomAction = "snapshot" | "moves" | "play" | "pass" | "hint" | "control" | "fallback" | "ws" | "pause" | "resume";

interface RoomLayout {
  playerIds: [string, string, string];
  botPlayerIds: string[];
  actors: GameActorV1[];
  seats: GameSeatV1[];
  bindings: GameActorBindingV1[];
  hostedAgents: Record<string, HostedAgentDescriptorV1>;
  viewerActorId: string;
  roomOwnerActorId: string;
  connectedActorId?: string;
  connectedSeatId?: string;
  browserViewer: boolean;
}

interface BrowserViewerAccess {
  viewerToken: string;
  recoveryCookie?: string;
}

const ROOM_COOKIE_MAX_AGE_SECONDS = 6 * 60 * 60;
const JOIN_CODE_MAX_AGE_MS = 20 * 60 * 1000;

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function authorizePrivateAccess(request: Request, env: RoomApiEnv, url: URL): Response | null {
  if (isLocalHostname(url.hostname)) return null;
  if (!env.WAITLOOP_ACCESS_TOKEN) return apiError(503, "access_not_configured", "Private Waitloop APIs are disabled.");
  if (bearerToken(request) !== env.WAITLOOP_ACCESS_TOKEN) return apiError(401, "unauthorized", "A valid access token is required.");
  return null;
}

function rpcValue(result: object): unknown {
  if (!("value" in result)) throw new Error("Successful game RPC result is missing a value.");
  return result.value;
}

function rpcSnapshot(result: object): GameRoomSnapshotV1 {
  return rpcValue(result) as GameRoomSnapshotV1;
}

function gameRpcError(code: string, message: string): Response {
  if (code === "rate_limited") return apiError(429, code, message);
  const forbidden = [
    "viewer_not_in_room",
    "player_not_in_room",
    "invalid_viewer_token",
    "invalid_seat_token",
    "invalid_actor_credential",
    "not_seat_owner",
    "comment_forbidden",
    "room_manage_forbidden",
  ].includes(code);
  const notFound = code === "room_not_found" || code === "join_not_found" || code === "seat_not_found";
  const expired = code === "join_expired";
  const status = notFound ? 404 : expired ? 410 : forbidden ? 403 : 409;
  return apiError(status, code, message);
}

function newSeatToken(): string {
  return `wlseat_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function newViewerToken(): string {
  return `wlview_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function newConnectedActorId(): string {
  return `actor_${crypto.randomUUID().replaceAll("-", "")}`;
}

function roomCookieName(roomId: string): string {
  return `wl_room_${roomId.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}

function roomViewerToken(request: Request, roomId: string): string | null {
  const value = readCookie(request, roomCookieName(roomId));
  return value?.startsWith("wlview_") ? value : null;
}

function anonymousActorIdentity(request: Request): AnonymousActorIdentityV1 | null {
  return parseAnonymousActorIdentity(readCookie(request, ACTOR_IDENTITY_COOKIE_NAME));
}

function roomCookie(roomId: string, viewerToken: string, url: URL): string {
  const parts = [
    `${roomCookieName(roomId)}=${viewerToken}`,
    `Path=/api/v1/rooms/${roomId}`,
    `Max-Age=${ROOM_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function withRecoveryCookie(response: Response, cookie: string | undefined): Response {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function roomMode(value: Record<string, unknown>): RoomMode | null {
  if (
    value.mode === "bots" ||
    value.mode === "hosted-agent" ||
    value.mode === "connected-agent" ||
    value.mode === "companion-agent" ||
    value.mode === "agent-bots"
  ) return value.mode;
  if (typeof value.agentPlayerId === "string") return "connected-agent";
  if (Array.isArray(value.botPlayerIds)) return "bots";
  return null;
}

function actor(id: string, kind: GameActorV1["kind"], label: string): GameActorV1 {
  return { version: 1, id, kind, label };
}

function seat(id: string, label: string, ownerActorId: string, activeControllerActorId = ownerActorId): GameSeatV1 {
  return { version: 1, id, label, ownerActorId, activeControllerActorId };
}

function binding(actorId: string, seatId: string, relation: GameActorBindingV1["relation"]): GameActorBindingV1 {
  return { version: 1, actorId, seatId, relation };
}

function buildRoomLayout(
  mode: RoomMode,
  body: Record<string, unknown>,
  env: RoomApiEnv,
  browserIdentity: AnonymousActorIdentityV1 | null,
): RoomLayout | Response {
  const hostedAgents: Record<string, HostedAgentDescriptorV1> = {};
  const humanActorId = browserIdentity?.actorId;

  if (mode !== "agent-bots" && !humanActorId) {
    return apiError(500, "actor_identity_missing", "Browser actor identity could not be created.");
  }

  if (mode === "bots") {
    return {
      playerIds: ["seat-1", "seat-2", "seat-3"],
      botPlayerIds: ["seat-2", "seat-3"],
      actors: [actor(humanActorId!, "human", "you"), actor("bot-a", "bot", "bot a"), actor("bot-b", "bot", "bot b")],
      seats: [
        seat("seat-1", "you", humanActorId!),
        seat("seat-2", "bot a", "bot-a"),
        seat("seat-3", "bot b", "bot-b"),
      ],
      bindings: [
        binding(humanActorId!, "seat-1", "controller"),
        binding("bot-a", "seat-2", "controller"),
        binding("bot-b", "seat-3", "controller"),
      ],
      hostedAgents,
      viewerActorId: humanActorId!,
      roomOwnerActorId: humanActorId!,
      browserViewer: true,
    };
  }

  if (mode === "hosted-agent") {
    if (!isHostedAgentId(body.hostedAgentId)) {
      return apiError(400, "invalid_hosted_agent", "hostedAgentId must identify an available hosted agent.");
    }
    const hosted = getHostedAgent(env, body.hostedAgentId);
    if (!hosted) return apiError(503, "hosted_agent_unavailable", "That hosted agent is not configured on this deployment.");
    const hostedActorId = `hosted-${hosted.id}`;
    const hostedActor: GameActorV1 = {
      version: 1,
      id: hostedActorId,
      kind: "hosted-agent",
      label: hosted.label,
      hostedAgentId: hosted.id,
      provider: hosted.provider,
      model: hosted.model,
    };
    hostedAgents["seat-2"] = hosted;
    return {
      playerIds: ["seat-1", "seat-2", "seat-3"],
      botPlayerIds: ["seat-3"],
      actors: [actor(humanActorId!, "human", "you"), hostedActor, actor("bot", "bot", "bot")],
      seats: [
        seat("seat-1", "you", humanActorId!),
        seat("seat-2", hosted.label, hostedActorId),
        seat("seat-3", "bot", "bot"),
      ],
      bindings: [
        binding(humanActorId!, "seat-1", "controller"),
        binding(hostedActorId, "seat-2", "controller"),
        binding("bot", "seat-3", "controller"),
      ],
      hostedAgents,
      viewerActorId: humanActorId!,
      roomOwnerActorId: humanActorId!,
      browserViewer: true,
    };
  }

  if (mode === "connected-agent") {
    const connectedActorId = newConnectedActorId();
    return {
      playerIds: ["seat-1", "seat-2", "seat-3"],
      botPlayerIds: ["seat-3"],
      actors: [
        actor(humanActorId!, "human", "you"),
        actor(connectedActorId, "connected-agent", "connected agent"),
        actor("bot", "bot", "bot"),
      ],
      seats: [
        seat("seat-1", "you", humanActorId!),
        seat("seat-2", "connected agent", connectedActorId),
        seat("seat-3", "bot", "bot"),
      ],
      bindings: [
        binding(humanActorId!, "seat-1", "controller"),
        binding(connectedActorId, "seat-2", "controller"),
        binding("bot", "seat-3", "controller"),
      ],
      hostedAgents,
      viewerActorId: humanActorId!,
      roomOwnerActorId: humanActorId!,
      connectedActorId,
      connectedSeatId: "seat-2",
      browserViewer: true,
    };
  }

  if (mode === "companion-agent") {
    const connectedActorId = newConnectedActorId();
    return {
      playerIds: ["seat-1", "seat-2", "seat-3"],
      botPlayerIds: ["seat-2", "seat-3"],
      actors: [
        actor(humanActorId!, "human", "you"),
        actor(connectedActorId, "connected-agent", "agent companion"),
        actor("bot-a", "bot", "bot a"),
        actor("bot-b", "bot", "bot b"),
      ],
      seats: [
        seat("seat-1", "you", humanActorId!),
        seat("seat-2", "bot a", "bot-a"),
        seat("seat-3", "bot b", "bot-b"),
      ],
      bindings: [
        binding(humanActorId!, "seat-1", "controller"),
        binding(connectedActorId, "seat-1", "advisor"),
        binding("bot-a", "seat-2", "controller"),
        binding("bot-b", "seat-3", "controller"),
      ],
      hostedAgents,
      viewerActorId: humanActorId!,
      roomOwnerActorId: humanActorId!,
      connectedActorId,
      connectedSeatId: "seat-1",
      browserViewer: true,
    };
  }

  const connectedActorId = newConnectedActorId();
  return {
    playerIds: ["seat-1", "seat-2", "seat-3"],
    botPlayerIds: ["seat-2", "seat-3"],
    actors: [actor(connectedActorId, "connected-agent", "agent"), actor("bot-a", "bot", "bot a"), actor("bot-b", "bot", "bot b")],
    seats: [
      seat("seat-1", "agent", connectedActorId),
      seat("seat-2", "bot a", "bot-a"),
      seat("seat-3", "bot b", "bot-b"),
    ],
    bindings: [
      binding(connectedActorId, "seat-1", "controller"),
      binding("bot-a", "seat-2", "controller"),
      binding("bot-b", "seat-3", "controller"),
    ],
    hostedAgents,
    viewerActorId: connectedActorId,
    roomOwnerActorId: connectedActorId,
    connectedActorId,
    connectedSeatId: "seat-1",
    browserViewer: false,
  };
}

function parseRoomRoute(pathname: string): { roomId: string; action: RoomAction } | null {
  const match = /^\/api\/v1\/rooms\/([^/]+)(?:\/(moves|play|pass|hint|control|fallback|ws|pause|resume))?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const roomId = decodeURIComponent(match[1]);
    if (roomId.length === 0 || roomId.length > 128) return null;
    const suffix = match[2] as RoomAction | undefined;
    return { roomId, action: suffix ?? "snapshot" };
  } catch {
    return null;
  }
}

function parseJoinApiRoute(pathname: string): { code: string; claim: boolean } | null {
  const match = /^\/api\/v1\/join\/([^/]+)(\/claim)?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return { code: normalizeJoinCode(decodeURIComponent(match[1])), claim: match[2] === "/claim" };
  } catch {
    return null;
  }
}

function parseJoinPage(pathname: string): string | null {
  const match = /^\/join\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return normalizeJoinCode(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function joinPublicPayload(info: GameJoinInfoV1, code: string, origin: string) {
  return {
    version: 1,
    code,
    roomId: info.roomId,
    gameId: info.gameId,
    phase: info.phase,
    actorId: info.actorId,
    seatId: info.seatId,
    relation: info.relation,
    seatStatus: info.seatStatus,
    expiresAt: info.expiresAt,
    roomExpiresAt: info.roomExpiresAt,
    claimed: info.claimedAt !== undefined,
    joinCommand: `waitloop join ${code}`,
    joinUrl: `${origin}/join/${encodeURIComponent(code)}`,
    agentGuide: `${origin}/agent.md`,
    mcpEndpoint: `${origin}/mcp`,
  };
}

function joinMarkdown(info: GameJoinInfoV1, code: string, origin: string): string {
  const payload = joinPublicPayload(info, code, origin);
  return `# Join Waitloop room\n\nRoom: ${info.roomId}\nGame: ${info.gameId}\nStatus: ${info.phase}\nRelation: ${info.relation}\nSeat: ${info.seatId}\nActor: ${info.actorId}\nJoin expires: ${new Date(info.expiresAt).toISOString()}\nRoom expires: ${new Date(info.roomExpiresAt).toISOString()}\n\n## Preferred\n\n\`\`\`bash\n${payload.joinCommand}\n\`\`\`\n\nThe CLI exchanges this short-lived room code for a temporary actor credential.\n\n## Without the Waitloop CLI\n\nPOST a version 1 body to:\n\n\`\`\`text\n${origin}/api/v1/join/${code}/claim\n\`\`\`\n\nThe claim response contains the fixed Waitloop MCP endpoint plus room-scoped headers. No browser is required.\n\n## Waitloop guide\n\n${origin}/agent.md\n`;
}

async function handleCreateRoom(request: Request, env: RoomApiEnv, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1 || body.value.gameId !== "doudizhu") {
    return apiError(400, "invalid_room_request", "A version 1 doudizhu room request is required.");
  }

  const mode = roomMode(body.value);
  if (!mode) return apiError(400, "invalid_room_mode", "Choose bots, hosted-agent, connected-agent, companion-agent, or agent-bots.");
  const browserIdentity = mode === "agent-bots"
    ? null
    : anonymousActorIdentity(request) ?? createAnonymousActorIdentity();
  const layout = buildRoomLayout(mode, body.value, env, browserIdentity);
  if (layout instanceof Response) return layout;

  const landlordId = selectRandomPlayer(layout.playerIds);
  const joinCode = layout.connectedActorId ? createJoinCode() : undefined;
  const roomId = joinCode ? await roomIdForJoinCode(joinCode) : `room-${crypto.randomUUID()}`;
  const viewerToken = layout.browserViewer ? newViewerToken() : undefined;
  const result = await env.GAME_ROOMS.getByName(roomId).initialize({
    roomId,
    gameId: "doudizhu",
    gameInput: { playerIds: layout.playerIds, landlordId },
    viewerId: layout.viewerActorId,
    viewerActorId: layout.viewerActorId,
    roomOwnerActorId: layout.roomOwnerActorId,
    botPlayerIds: layout.botPlayerIds,
    ...(viewerToken ? { viewerTokens: { [layout.viewerActorId]: viewerToken } } : {}),
    ...(browserIdentity ? { actorCredentials: { [browserIdentity.actorId]: browserIdentity.credential } } : {}),
    actors: layout.actors,
    seats: layout.seats,
    bindings: layout.bindings,
    hostedAgents: layout.hostedAgents,
    ...(layout.connectedActorId ? { waitForActorId: layout.connectedActorId } : {}),
    ...(joinCode && layout.connectedActorId && layout.connectedSeatId
      ? {
          join: {
            version: 1,
            codeHash: await joinCodeHash(joinCode),
            actorId: layout.connectedActorId,
            seatId: layout.connectedSeatId,
            expiresAt: Date.now() + JOIN_CODE_MAX_AGE_MS,
          },
        }
      : {}),
  });
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);

  const created = rpcSnapshot(result);
  const response: Record<string, unknown> = {
    version: 1,
    roomId,
    mode,
    roomPhase: created.roomPhase,
    expiresAt: created.expiresAt,
  };
  if (layout.browserViewer) response.snapshot = toHumanGameSnapshot(created);
  else response.headless = true;
  if (joinCode) {
    response.joinCode = joinCode;
    response.joinUrl = `${url.origin}/join/${encodeURIComponent(joinCode)}`;
    response.agentGuide = `${url.origin}/agent.md`;
  }

  const headers = new Headers();
  if (viewerToken) headers.append("set-cookie", roomCookie(roomId, viewerToken, url));
  if (browserIdentity) headers.append("set-cookie", actorIdentityCookie(browserIdentity, url));
  return json(response, { status: 201, headers });
}

async function resolveBrowserViewerAccess(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  roomId: string,
  url: URL,
): Promise<BrowserViewerAccess | null> {
  const existing = roomViewerToken(request, roomId);
  if (existing) return { viewerToken: existing };

  const identity = anonymousActorIdentity(request);
  if (!identity) return null;
  const viewerToken = newViewerToken();
  const restored = await stub.restoreViewerByActorCredential(identity.actorId, identity.credential, viewerToken);
  if (!restored.ok) return null;
  return {
    viewerToken,
    recoveryCookie: roomCookie(roomId, viewerToken, url),
  };
}

async function requireViewerSnapshot(
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
): Promise<{ ok: true; snapshot: GameRoomSnapshotV1 } | { ok: false; response: Response }> {
  if (!viewerToken) return { ok: false, response: apiError(401, "room_auth_required", "A room viewer credential is required.") };
  const result = await stub.getSnapshotByViewerToken(viewerToken);
  if (!result.ok) return { ok: false, response: gameRpcError(result.error.code, result.error.message) };
  return { ok: true, snapshot: rpcSnapshot(result) };
}

function canHumanPlay(snapshot: GameRoomSnapshotV1): boolean {
  return snapshot.capabilities.includes("seat:play");
}

async function handleHumanPlay(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const expectedRevision = body.expectedRevision;
  const cardIds = body.cardIds;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 || !Array.isArray(cardIds) || !cardIds.every((id) => typeof id === "string")) {
    return apiError(400, "invalid_play", "expectedRevision and cardIds are required.");
  }
  const current = await requireViewerSnapshot(stub, viewerToken);
  if (!current.ok) return current.response;
  if (!canHumanPlay(current.snapshot)) return apiError(409, "not_active_controller", "This seat is currently controlled by another actor.");
  if (current.snapshot.revision !== expectedRevision) return apiError(409, "stale_revision", "Room state changed. Refresh before playing.");
  const move = resolveHumanCardSelection(current.snapshot, cardIds as string[]);
  if (!move) return apiError(409, "illegal_selection", "Selected cards are not a legal play in the current state.");
  const result = await stub.applyMoveByViewerToken(viewerToken!, expectedRevision as number, move.id);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) });
}

async function handleHumanPass(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const expectedRevision = body.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) return apiError(400, "invalid_pass", "expectedRevision is required.");
  const current = await requireViewerSnapshot(stub, viewerToken);
  if (!current.ok) return current.response;
  if (!canHumanPlay(current.snapshot)) return apiError(409, "not_active_controller", "This seat is currently controlled by another actor.");
  if (current.snapshot.revision !== expectedRevision) return apiError(409, "stale_revision", "Room state changed. Refresh before passing.");
  if (!current.snapshot.legalMoves.some((move) => move.id === "pass")) return apiError(409, "cannot_pass", "Passing is not legal in the current state.");
  const result = await stub.applyMoveByViewerToken(viewerToken!, expectedRevision as number, "pass");
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) });
}

async function handleHumanHint(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const expectedRevision = body.expectedRevision;
  const cursor = body.cursor === undefined ? 0 : body.cursor;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 || !Number.isSafeInteger(cursor) || (cursor as number) < 0) {
    return apiError(400, "invalid_hint", "expectedRevision and a non-negative cursor are required.");
  }
  const current = await requireViewerSnapshot(stub, viewerToken);
  if (!current.ok) return current.response;
  if (!canHumanPlay(current.snapshot)) return apiError(409, "not_active_controller", "This seat is currently controlled by another actor.");
  if (current.snapshot.revision !== expectedRevision) return apiError(409, "stale_revision", "Room state changed. Refresh before requesting a hint.");
  const hint = getHumanHint(current.snapshot, cursor as number);
  if (!hint) return apiError(409, "hint_unavailable", "No playable hint is available in the current state.");
  return json({ version: 1, hint });
}

async function handleHumanControl(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  if (!viewerToken) return apiError(401, "room_auth_required", "A room viewer credential is required.");
  const targetActorId = body.targetActorId;
  if (typeof targetActorId !== "string" || targetActorId.length === 0 || targetActorId.length > 128) {
    return apiError(400, "invalid_controller", "targetActorId is required.");
  }
  const result = await stub.setControllerByViewerToken(viewerToken, targetActorId);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) });
}

async function handleFallbackControl(
  request: Request,
  stub: DurableObjectStub<GameRoom>,
  viewerToken: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  if (!viewerToken) return apiError(401, "room_auth_required", "A room viewer credential is required.");
  const targetSeatId = body.targetSeatId;
  const action = body.action;
  if (typeof targetSeatId !== "string" || targetSeatId.length === 0 || targetSeatId.length > 128) {
    return apiError(400, "invalid_seat", "targetSeatId is required.");
  }
  if (action !== "bot" && action !== "owner") {
    return apiError(400, "invalid_fallback", "action must be bot or owner.");
  }
  const result = action === "bot"
    ? await stub.replaceSeatWithBotByViewerToken(viewerToken, targetSeatId)
    : await stub.restoreSeatOwnerByViewerToken(viewerToken, targetSeatId);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) });
}

async function handleRoomRoute(
  request: Request,
  env: RoomApiEnv,
  url: URL,
  route: { roomId: string; action: RoomAction },
): Promise<Response> {
  const stub = env.GAME_ROOMS.getByName(route.roomId);
  const browserAccess = await resolveBrowserViewerAccess(request, stub, route.roomId, url);
  const viewerToken = browserAccess?.viewerToken ?? null;

  if (route.action === "ws") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    if (viewerToken) return apiError(410, "browser_room_ws_disabled", "Browser rooms use the human snapshot protocol instead of legal-move WebSocket snapshots.");
    const authError = authorizePrivateAccess(request, env, url);
    if (authError) return authError;
    return stub.fetch(request);
  }

  if (route.action === "snapshot") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    if (viewerToken) {
      const result = await stub.getSnapshotByViewerToken(viewerToken);
      if (!result.ok) return gameRpcError(result.error.code, result.error.message);
      return withRecoveryCookie(
        json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) }),
        browserAccess?.recoveryCookie,
      );
    }
    if (!bearerToken(request) && !isLocalHostname(url.hostname)) {
      return apiError(401, "room_auth_required", "This browser does not own or remember an actor in this room.");
    }
    const authError = authorizePrivateAccess(request, env, url);
    if (authError) return authError;
    const viewerId = url.searchParams.get("viewer");
    if (!viewerId) return apiError(400, "invalid_viewer", "viewer query parameter is required.");
    const result = await stub.getSnapshot(viewerId);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: rpcSnapshot(result) });
  }

  const bodyResult = await readJson(request);
  if (!bodyResult.ok) return bodyResult.response;
  if (!isRecord(bodyResult.value) || bodyResult.value.version !== 1) return apiError(400, "invalid_request", "Request body must be a version 1 object.");
  const body = bodyResult.value;

  let response: Response;
  if (route.action === "play") response = await handleHumanPlay(request, stub, viewerToken, body);
  else if (route.action === "pass") response = await handleHumanPass(request, stub, viewerToken, body);
  else if (route.action === "hint") response = await handleHumanHint(request, stub, viewerToken, body);
  else if (route.action === "control") response = await handleHumanControl(request, stub, viewerToken, body);
  else if (route.action === "fallback") response = await handleFallbackControl(request, stub, viewerToken, body);
  else if (route.action === "moves") {
    if (request.method !== "POST") response = apiError(405, "method_not_allowed", "Only POST is allowed.");
    else if (viewerToken) response = apiError(403, "human_move_protocol_required", "Browser players must use /play, /pass, or /hint instead of raw move IDs.");
    else {
      const authError = authorizePrivateAccess(request, env, url);
      if (authError) response = authError;
      else {
        const { expectedRevision, moveId, playerId } = body;
        if (typeof moveId !== "string" || typeof playerId !== "string" || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
          response = apiError(400, "invalid_move", "playerId, expectedRevision, and moveId are required for private access.");
        } else {
          const command: GameMoveCommandV1 = {
            version: 1,
            roomId: route.roomId,
            playerId,
            expectedRevision: expectedRevision as number,
            moveId,
          };
          const result = await stub.applyMove(command, playerId);
          response = result.ok
            ? json({ version: 1, snapshot: rpcSnapshot(result) })
            : gameRpcError(result.error.code, result.error.message);
        }
      }
    }
  } else if (request.method !== "POST") {
    response = apiError(405, "method_not_allowed", "Only POST is allowed.");
  } else if (viewerToken) {
    const result = route.action === "pause" ? await stub.pauseByViewerToken(viewerToken) : await stub.resumeByViewerToken(viewerToken);
    response = result.ok
      ? json({ version: 1, snapshot: toHumanGameSnapshot(rpcSnapshot(result)) })
      : gameRpcError(result.error.code, result.error.message);
  } else {
    const authError = authorizePrivateAccess(request, env, url);
    if (authError) response = authError;
    else {
      const viewerId = body.viewerId;
      if (typeof viewerId !== "string" || viewerId.length === 0) {
        response = apiError(400, "invalid_viewer", "viewerId is required for private access.");
      } else {
        const result = route.action === "pause" ? await stub.pause(viewerId) : await stub.resume(viewerId);
        response = result.ok
          ? json({ version: 1, snapshot: rpcSnapshot(result) })
          : gameRpcError(result.error.code, result.error.message);
      }
    }
  }

  return withRecoveryCookie(response, browserAccess?.recoveryCookie);
}

async function handleJoinApi(request: Request, env: RoomApiEnv, url: URL, route: { code: string; claim: boolean }): Promise<Response> {
  const codeHash = await joinCodeHash(route.code);
  const roomId = await roomIdForJoinCode(route.code);
  const stub = env.GAME_ROOMS.getByName(roomId);

  if (!route.claim) {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    const result = await stub.getJoinInfo(codeHash);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json(joinPublicPayload(rpcValue(result) as GameJoinInfoV1, route.code, url.origin));
  }

  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) return apiError(400, "invalid_join_claim", "A version 1 join claim is required.");

  const seatToken = newSeatToken();
  const result = await stub.claimJoinSeat(codeHash, seatToken);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  const info = rpcValue(result) as GameJoinInfoV1;
  return json({
    ...joinPublicPayload(info, route.code, url.origin),
    seatToken,
    mcp: {
      type: "http",
      url: `${url.origin}/mcp`,
      headers: {
        Authorization: `Bearer ${seatToken}`,
        "X-Waitloop-Room": info.roomId,
      },
    },
  });
}

async function handleJoinPage(request: Request, env: RoomApiEnv, url: URL, code: string): Promise<Response> {
  if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
  const infoResult = await env.GAME_ROOMS.getByName(await roomIdForJoinCode(code)).getJoinInfo(await joinCodeHash(code));
  if (!infoResult.ok) return gameRpcError(infoResult.error.code, infoResult.error.message);

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    const assetUrl = new URL("/join.html", url);
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  }
  return new Response(joinMarkdown(rpcValue(infoResult) as GameJoinInfoV1, code, url.origin), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleRoomApi(request: Request, env: RoomApiEnv, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/v1/rooms") return handleCreateRoom(request, env, url);
  const joinApi = parseJoinApiRoute(url.pathname);
  if (joinApi) return handleJoinApi(request, env, url, joinApi);
  const joinPage = parseJoinPage(url.pathname);
  if (joinPage) return handleJoinPage(request, env, url, joinPage);
  const roomRoute = parseRoomRoute(url.pathname);
  if (roomRoute) return handleRoomRoute(request, env, url, roomRoute);
  return null;
}
