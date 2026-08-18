interface Env {
  ASSETS: Fetcher;
}

interface ApiErrorBody {
  version: 1;
  error: {
    code: string;
    message: string;
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

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

    if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
      return apiError(404, "not_found", "The requested API endpoint does not exist.");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
