import type { Provider } from "./index";

export function anthropicProvider(): Provider {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "claude-sonnet-5";

  return {
    async complete(system, user, maxTokens) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      const data = (await response.json()) as { content?: { type: string; text?: string }[] };
      return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    },
  };
}
