const LITELLM_BASE_URL = "https://models.labelbox.com/api/v1/models/litellm/v1";

export const CLIENT_AGENT_MODEL = process.env.LLM_MODEL ?? "anthropic/claude-opus-4-8";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type CallOptions = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  jsonResponse?: boolean;
};

/**
 * Calls a model through the Labelbox LiteLLM proxy, which is OpenAI-compatible.
 * Only LABELBOX_API_KEY is needed; PROJECT_ID is sent in the required
 * x-labelbox-context header for billing/tracking.
 */
export async function callLabelboxModel({
  system,
  user,
  model = CLIENT_AGENT_MODEL,
  temperature = 0,
  jsonResponse = true,
}: CallOptions): Promise<string> {
  const apiKey = requireEnv("LABELBOX_API_KEY");
  const projectId = requireEnv("PROJECT_ID");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const response = await fetch(`${LITELLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-labelbox-context": JSON.stringify({ project_id: projectId }),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(jsonResponse ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Labelbox model request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Labelbox model returned an empty response.");
  }

  return content;
}
