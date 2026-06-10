import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callLabelboxModel } from "@/lib/llm";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("callLabelboxModel", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LABELBOX_API_KEY: "test-key",
      PROJECT_ID: "test-project",
      COST_TRACKING_TAG: "test-tag",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("submits Foundry Direct requests and normalizes fenced JSON output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: "prediction-id",
          status: "success",
          modelOutput: ['```json\n{"ok":true}\n```'],
        },
        201,
      ),
    );
    globalThis.fetch = fetchMock;

    const result = await callLabelboxModel({
      system: "You are a helpful assistant.",
      user: "Return JSON.",
      modelId: "model-id",
      maxNewTokens: 64,
      pollIntervalMs: 0,
    });

    expect(result).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.labelbox.com/api/v1/foundry-app/predict/direct/wait",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(String(init?.body));

    expect(requestBody).toMatchObject({
      config: {
        modelId: "model-id",
        inferenceParams: {
          max_new_tokens: 64,
        },
      },
      input: {
        type: "conversational",
        messages: [
          {
            role: "user",
            content: expect.stringContaining("System instructions:\nYou are a helpful assistant."),
          },
        ],
      },
      context: {
        tag: "test-tag",
        project_id: "test-project",
      },
    });
    expect(requestBody.input.messages[0].content).toContain("User request:\nReturn JSON.");
  });

  it("polls when Labelbox returns an in-progress prediction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: "prediction-id",
            status: "in_progress",
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "prediction-id",
          status: "success",
          modelOutput: ["Done"],
        }),
      );
    globalThis.fetch = fetchMock;

    const result = await callLabelboxModel({
      system: "System",
      user: "User",
      maxPollAttempts: 1,
      pollIntervalMs: 0,
    });

    expect(result).toBe("Done");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://app.labelbox.com/api/v1/foundry-app/prediction/prediction-id",
      {
        headers: {
          Authorization: "Bearer test-key",
        },
      },
    );
  });

  it("surfaces Labelbox HTTP errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{"detail":"Method Not Allowed"}', { status: 405 }));

    await expect(
      callLabelboxModel({
        system: "System",
        user: "User",
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow('Labelbox model request failed (405): {"detail":"Method Not Allowed"}');
  });
});
