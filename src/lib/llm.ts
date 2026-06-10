const FOUNDRY_BASE_URL = "https://app.labelbox.com/api/v1/foundry-app";
const DEFAULT_CLIENT_AGENT_MODEL_ID = "036aeb03-b0b4-442e-a6e1-161382bc1228";
const DEFAULT_COST_TRACKING_TAG = "project-management-client-agent";
const DEFAULT_MAX_NEW_TOKENS = 2048;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;

export const CLIENT_AGENT_MODEL_ID = process.env.LABELBOX_MODEL_ID ?? DEFAULT_CLIENT_AGENT_MODEL_ID;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type CallOptions = {
  system: string;
  user: string;
  modelId?: string;
  /**
   * Optional sampling temperature. Omitted by default so the configured
   * Labelbox model can apply its own default.
   */
  temperature?: number;
  jsonResponse?: boolean;
  maxNewTokens?: number;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
};

type FoundryPrediction = {
  id?: string;
  status?: string;
  modelOutput?: unknown;
  error?: unknown;
  message?: unknown;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function labelboxErrorMessage(payload: FoundryPrediction) {
  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "Labelbox model request failed.";
}

function stripMarkdownFence(content: string) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced ? fenced[1].trim() : trimmed;
}

function extractModelOutput(payload: FoundryPrediction, jsonResponse: boolean) {
  const output = Array.isArray(payload.modelOutput) ? payload.modelOutput[0] : payload.modelOutput;
  const content = typeof output === "string" ? output : output ? JSON.stringify(output) : "";
  const normalized = jsonResponse ? stripMarkdownFence(content) : content.trim();

  if (!normalized) {
    throw new Error("Labelbox model returned an empty response.");
  }

  return normalized;
}

async function readLabelboxResponse(response: Response) {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Labelbox model request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  return (await response.json()) as FoundryPrediction;
}

/**
 * Calls a model through Labelbox Foundry Direct. The LiteLLM proxy currently
 * returns 405 for this app's authenticated requests, while Foundry Direct uses
 * the same Labelbox credentials and supports the client-message agent flow.
 */
export async function callLabelboxModel({
  system,
  user,
  modelId = CLIENT_AGENT_MODEL_ID,
  temperature,
  jsonResponse = true,
  maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
  maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: CallOptions): Promise<string> {
  const apiKey = requireEnv("LABELBOX_API_KEY");
  const projectId = requireEnv("PROJECT_ID");
  const tag = process.env.COST_TRACKING_TAG ?? DEFAULT_COST_TRACKING_TAG;
  const orchestrator = process.env.LABELBOX_ORCHESTRATOR;

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `System instructions:\n${system}\n\nUser request:\n${user}`,
    },
  ];

  let payload = await readLabelboxResponse(
    await fetch(`${FOUNDRY_BASE_URL}/predict/direct/wait`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        config: {
          modelId,
          inferenceParams: {
            max_new_tokens: maxNewTokens,
            ...(typeof temperature === "number" ? { temperature } : {}),
            ...(orchestrator ? { orchestrator } : {}),
          },
        },
        input: {
          type: "conversational",
          messages,
        },
        context: {
          tag,
          project_id: projectId,
        },
      }),
    }),
  );

  for (let attempt = 0; payload.status === "in_progress" && attempt < maxPollAttempts; attempt += 1) {
    if (!payload.id) {
      throw new Error("Labelbox model request is still in progress but did not return a prediction id.");
    }

    await sleep(pollIntervalMs);
    payload = await readLabelboxResponse(
      await fetch(`${FOUNDRY_BASE_URL}/prediction/${payload.id}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }),
    );
  }

  if (payload.status === "in_progress") {
    throw new Error("Labelbox model request timed out while waiting for a response.");
  }

  if (payload.status && payload.status !== "success") {
    throw new Error(labelboxErrorMessage(payload));
  }

  return extractModelOutput(payload, jsonResponse);
}
