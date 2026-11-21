/**
 * Стоимость сессии по сохранённым токенам и известному тарифу.
 * Нет usage или нет ставки модели — эти ходы в сумму не входят.
 */

export interface CostMessage {
  role: string;
  model?: string;
  usage?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Входные и выходные токены. Кэш остаётся частью входа. */
export function tokensFromUsage(usage: unknown): { prompt: number; completion: number } | null {
  const row = asRecord(usage);
  if (!row) return null;
  const prompt = Number(row.prompt_tokens ?? row.input_tokens);
  const completion = Number(row.completion_tokens ?? row.output_tokens);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  if (prompt <= 0 && completion <= 0) return null;
  return { prompt, completion };
}

/** Ставки из строки `$0.30 / $1.20 per 1M` — USD за миллион. */
export function ratesPerMillion(label: string): { input: number; output: number } | null {
  const match = label.match(/\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*\$([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const input = Number(match[1]);
  const output = Number(match[2]);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

/** Сумма в долларах или пустая строка, если посчитать не из чего. */
export function sessionCostLabel(
  messages: CostMessage[],
  prices: Record<string, string>,
  fallbackModel = "",
): string {
  let sum = 0;
  let priced = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const tokens = tokensFromUsage(message.usage);
    if (!tokens) continue;
    const model = (message.model || fallbackModel).trim();
    const rates = ratesPerMillion(prices[model] ?? "");
    if (!rates) continue;
    sum += (tokens.prompt * rates.input + tokens.completion * rates.output) / 1_000_000;
    priced = true;
  }
  if (!priced) return "";
  return sum < 0.01 ? `$${sum.toFixed(4)}` : `$${sum.toFixed(2)}`;
}
