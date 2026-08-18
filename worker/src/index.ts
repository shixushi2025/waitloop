import { parseWaitloopAgentEvent } from "@waitloop/protocol";

import { AgentSession } from "./agent-session";

export { AgentSession };

interface Env {
  ASSETS: Fetcher;
  AGENT_SESSIONS: DurableObjectNamespace<AgentSession>;
  WAITLOOP_INGEST_TOKEN?: string;
}

interface ApiErrorBody {
  version: 1;
  error: {
    code: string;
    message: string;
  };
}

const MAX_AGENT_EVENT_BODY_BYTES = 16 * 1024;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function apiError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = {
    version: 1,
    error: { code, message },
  };

  return json(body, { status });
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function authorizeAgentMutation(request: Request, env: Env, url: URL): Response | null {
  if (isLocalHostname(url.hostname)) {
    return null;
  }

  const expectedToken = env.WAITLOOP_INGEST_TOKEN;
  if (!expectedToken) {
    return apiError(
      503,
      "ingest_not_configured",
      "Agent event ingestion is disabled until WAITLOOP_INGEST_TOKEN is configured.",
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    return apiError(401, "unauthorized", "A valid ingest token is required.");
  }

  return null;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_AGENT_EVENT_BODY_BYTES) {
      return {
        ok: false,
        response: apiError(413, "body_too_large", "Request body is too large."),
      };
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AGENT_EVENT_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(413, "body_too_large", "Request body is too large."),
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_json", "Request body must contain valid JSON."),
    };
  }
}

function parseSessionRoute(pathname: string): { sessionId: string; websocket: boolean } | null {
  const match = /^\/api\/v1\/sessions\/([^/]+)(\/ws)?$/.exec(pathname);
  if (!match || match[1] === undefined) {
    return null;
  }

  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (sessionId.length === 0 || sessionId.length > 128) {
    return null;
  }

  return {
    sessionId,
    websocket: match[2] === "/ws",
  };
}

async function handleAgentEvent(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") {
    return apiError(405, "method_not_allowed", "Only POST is allowed for this endpoint.");
  }

  const authError = authorizeAgentMutation(request, env, url);
  if (authError !== null) {
    return authError;
  }

  const body = await readJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = parseWaitloopAgentEvent(body.value);
  if (!parsed.ok) {
    return apiError(400, parsed.error.code, parsed.error.message);
  }

  const stub = env.AGENT_SESSIONS.getByName(parsed.value.sessionId);
  const result = await stub.applyEvent(parsed.value);

  if (!result.accepted) {
    return json(
      {
        version: 1,
        accepted: false,
        changed: false,
        decision: result.decision,
        snapshot: result.snapshot,
      },
      { status: 409 },
    );
  }

  return json({
    version: 1,
    accepted: true,
    changed: result.changed,
    decision: result.decision,
    snapshot: result.snapshot,
  });
}

async function handleSessionRoute(
  request: Request,
  env: Env,
  route: { sessionId: string; websocket: boolean },
): Promise<Response> {
  if (request.method !== "GET") {
    return apiError(405, "method_not_allowed", "Only GET is allowed for this endpoint.");
  }

  const stub = env.AGENT_SESSIONS.getByName(route.sessionId);

  if (route.websocket) {
    return stub.fetch(request);
  }

  const snapshot = await stub.getSnapshot();
  if (snapshot === null) {
    return apiError(404, "session_not_found", "No agent session exists for this ID.");
  }

  return json({
    version: 1,
    snapshot,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/health") {
      if (request.method !== "GET") {
        return apiError(405, "method_not_allowed", "Only GET is allowed for this endpoint.");
      }

      return json({
        version: 1,
        service: "waitloop",
        status: "ok",
      });
    }

    if (url.pathname === "/api/v1/agent-events") {
      return handleAgentEvent(request, env, url);
    }

    const sessionRoute = parseSessionRoute(url.pathname);
    if (sessionRoute !== null) {
      return handleSessionRoute(request, env, sessionRoute);
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
      return apiError(404, "not_found", "The requested API endpoint does not exist.");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
