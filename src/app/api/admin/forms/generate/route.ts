/**
 * AI-assisted form generation for the admin builder.
 *
 *   GET  /api/admin/forms/generate — { available: boolean } (is ANTHROPIC_API_KEY set?)
 *   POST /api/admin/forms/generate — { prompt } → { title, description, fields }
 *
 * Does NOT persist — the UI creates a draft form and redirects to the editor.
 */
import Anthropic from "@anthropic-ai/sdk";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import {
  MAX_PROMPT_LENGTH,
  SUBMIT_FORM_DEFINITION_TOOL,
  buildAiFormSystemPrompt,
  getAnthropicModel,
  isAiGenerationConfigured,
  processGeneratedForm,
} from "@/lib/form-ai-generate";
import { z } from "zod";

const promptBodySchema = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
});

export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();
  return Response.json({ available: isAiGenerationConfigured() });
}

export async function POST(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  if (!isAiGenerationConfigured()) {
    return Response.json({ error: "AI generation not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = promptBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid input",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = getAnthropicModel();
  const system = buildAiFormSystemPrompt();
  const userPrompt = parsed.data.prompt.trim();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  let lastError = "Could not generate a valid form. Try rephrasing your description.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools: [SUBMIT_FORM_DEFINITION_TOOL],
        tool_choice: { type: "tool", name: "submit_form_definition" },
        messages,
      });

      const toolBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (!toolBlock || toolBlock.name !== "submit_form_definition") {
        lastError = "Model did not return a form definition.";
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `You must call submit_form_definition with a valid form. Error: ${lastError}`,
        });
        continue;
      }

      const result = processGeneratedForm(toolBlock.input);
      if (result.ok) {
        return Response.json({
          title: result.title,
          description: result.description,
          fields: result.fields,
        });
      }

      lastError = result.error;
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `The form output failed validation: ${result.error}. Fix and call submit_form_definition again.`,
      });
    } catch (err) {
      logger.error("AI form generation failed", { error: String(err) });
      return Response.json({ error: "AI generation failed. Try again later." }, { status: 502 });
    }
  }

  return Response.json({ error: lastError }, { status: 422 });
}