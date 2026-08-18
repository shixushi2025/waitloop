import { DurableObject } from "cloudflare:workers";

import {
  reduceAgentEvent,
  type AgentEventReduction,
  type AgentSessionSnapshotV1,
  type AgentSessionStateV1,
  type WaitloopAgentEventV1,
} from "@waitloop/protocol";

export interface AgentSessionEnv {}

export interface AgentSessionApplyResult {
  accepted: boolean;
  changed: boolean;
  decision: AgentEventReduction["decision"];
  snapshot: AgentSessionSnapshotV1 | null;
}

interface AgentSocketMessageV1 {
  version: 1;
  type: "agent.snapshot";
  snapshot: AgentSessionSnapshotV1 | null;
}

const STATE_KEY = "agent-session-state-v1";

export class AgentSession extends DurableObject<AgentSessionEnv> {
  private async readState(): Promise<AgentSessionStateV1 | null> {
    return (await this.ctx.storage.get<AgentSessionStateV1>(STATE_KEY)) ?? null;
  }

  private async writeState(state: AgentSessionStateV1): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const message: AgentSocketMessageV1 = {
      version: 1,
      type: "agent.snapshot",
      snapshot: (await this.readState())?.snapshot ?? null,
    };
    ws.send(JSON.stringify(message));
  }

  private broadcast(snapshot: AgentSessionSnapshotV1): void {
    const message: AgentSocketMessageV1 = {
      version: 1,
      type: "agent.snapshot",
      snapshot,
    };
    const payload = JSON.stringify(message);

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // A stale socket must never prevent an agent-state transition.
      }
    }
  }

  async applyEvent(event: WaitloopAgentEventV1): Promise<AgentSessionApplyResult> {
    const current = await this.readState();
    const reduction = reduceAgentEvent(current, event);

    if (reduction.accepted && reduction.state !== null && reduction.decision !== "duplicate") {
      await this.writeState(reduction.state);
    }

    const snapshot = reduction.state?.snapshot ?? null;
    if (reduction.changed && snapshot !== null) {
      this.broadcast(snapshot);
    }

    return {
      accepted: reduction.accepted,
      changed: reduction.changed,
      decision: reduction.decision,
      snapshot,
    };
  }

  async getSnapshot(): Promise<AgentSessionSnapshotV1 | null> {
    return (await this.readState())?.snapshot ?? null;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    await this.sendSnapshot(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    await this.sendSnapshot(ws);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    ws.close(code, reason);
  }
}
