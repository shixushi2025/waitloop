import type { StoredGameSnapshot } from "./game-registry";
import type { HostedAgentDescriptorV1, HostedAgentIdV1 } from "./participants";

export interface HostedAgentEnv {
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  WAITLOOP_OPENAI_MODEL?: string;
  WAITLOOP_DEEPSEEK_MODEL?: string;
  WAITLOOP_HOSTED_AGENT_TIMEOUT_MS?: string;
}

export interface HostedAgentDecisionV1 {
  ok: boolean;
  moveId?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredTimeout(env: HostedAgentEnv): number {
  const parsed = Number(env.WAITLOOP_HOSTED_AGENT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 1_000) return 12_000;
  return Math.min(parsed, 30_000);
}

function cleanModel(value: string | undefined, fallback: string): string {
  const model = value?.trim();
  return model && model.length <= 128 ? model : fallback;
}

export function listHostedAgents(env: HostedAgentEnv): HostedAgentDescriptorV1[] {
  const result: HostedAgentDescriptorV1[] = [];

  if (env.DEEPSEEK_API_KEY) {
    result.push({
      version: 1,
      id: "deepseek",
      label: "DeepSeek",
      provider: "deepseek",
      model: cleanModel(env.WAITLOOP_DEEPSEEK_MODEL, "deepseek-v4-flash"),
    });
  }

  if (env.OPENAI_API_KEY) {
    result.push({
      version: 1,
      id: "openai",
      label: "GPT",
      provider: "openai",
      model: cleanModel(env.WAITLOOP_OPENAI_MODEL, "gpt-5.6"),
    });
  }

  return result;
}

export function getHostedAgent(
  env: HostedAgentEnv,
  id: HostedAgentIdV1,
): HostedAgentDescriptorV1 | null {
  return listHostedAgents(env).find((agent) => agent.id === id) ?? null;
}

function compactGameInput(snapshot: StoredGameSnapshot): Record<string, unknown> {
  return {
    game: snapshot.gameId,
    status: snapshot.status,
    revision: snapshot.revision,
    yourPlayerId: snapshot.viewerId,
    currentPlayerId: snapshot.currentPlayerId,
    visibleState: snapshot.state,
    legalMoves: snapshot.legalMoves.map((move) => ({ id: move.id, label: move.label })),
  };
}

function gamePrompt(snapshot: StoredGameSnapshot): string {
  return [
    "You are playing one seat in a server-authoritative Dou Dizhu game.",
    "Choose the strategically best move from legalMoves.",
    "You may use only information in visibleState; opponents' hidden cards are not available.",
    "Return JSON only in exactly this shape: {\"moveId\":\"<one legal move id>\"}.",
    "Never invent a move id and never explain your answer.",
    "",
    JSON.stringify(compactGameInput(snapshot)),
  ].join("\n");
}

function extractOpenAIText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === "string") return value.output_text;
  if (!Array.isArray(value.output)) return null;

  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

async function callOpenAI(
  env: HostedAgentEnv,
  agent: HostedAgentDescriptorV1,
  snapshot: StoredGameSnapshot,
  signal: AbortSignal,
): Promise<ProviderResult> {
  if (!env.OPENAI_API_KEY) throw new Error("openai_not_configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: agent.model,
      store: false,
      instructions:
        "Act only as a Dou Dizhu game player. Return only the requested JSON object with one legal moveId.",
      input: gamePrompt(snapshot),
      max_output_tokens: 96,
    }),
    signal,
  });

  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const value: unknown = await response.json();
  const text = extractOpenAIText(value);
  if (!text) throw new Error("openai_empty_response");

  const usage = isRecord(value) && isRecord(value.usage) ? value.usage : {};
  return {
    text,
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
  };
}

async function callDeepSeek(
  env: HostedAgentEnv,
  agent: HostedAgentDescriptorV1,
  snapshot: StoredGameSnapshot,
  signal: AbortSignal,
): Promise<ProviderResult> {
  if (!env.DEEPSEEK_API_KEY) throw new Error("deepseek_not_configured");

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: agent.model,
      messages: [
        {
          role: "system",
          content:
            "Act only as a Dou Dizhu game player. Return JSON only as {\"moveId\":\"<one legal move id>\"}.",
        },
        { role: "user", content: gamePrompt(snapshot) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 96,
    }),
    signal,
  });

  if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error("deepseek_invalid_response");
  const first = value.choices[0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const text = message && typeof message.content === "string" ? message.content : null;
  if (!text) throw new Error("deepseek_empty_response");

  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    text,
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
  };
}

function parseMoveId(text: string, legalMoveIds: ReadonlySet<string>): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      value = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  if (!isRecord(value) || typeof value.moveId !== "string") return null;
  return legalMoveIds.has(value.moveId) ? value.moveId : null;
}

export async function chooseHostedAgentMove(
  env: HostedAgentEnv,
  agent: HostedAgentDescriptorV1,
  snapshot: StoredGameSnapshot,
): Promise<HostedAgentDecisionV1> {
  const startedAt = Date.now();
  const legalMoveIds = new Set(snapshot.legalMoves.map((move) => move.id));
  if (legalMoveIds.size === 0) {
    return {
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      error: "no_legal_moves",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuredTimeout(env));

  try {
    const result = agent.provider === "openai"
      ? await callOpenAI(env, agent, snapshot, controller.signal)
      : await callDeepSeek(env, agent, snapshot, controller.signal);
    const moveId = parseMoveId(result.text, legalMoveIds);
    if (!moveId) {
      return {
        ok: false,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
        error: "invalid_move_response",
      };
    }

    return {
      ok: true,
      moveId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "hosted_agent_error";
    return {
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      error: message === "The operation was aborted" ? "hosted_agent_timeout" : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
