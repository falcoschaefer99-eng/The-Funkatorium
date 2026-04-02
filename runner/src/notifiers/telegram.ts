import type { NotificationEvent, Notifier } from "../notifier.js";

function renderMessage(event: NotificationEvent): string {
  const tag = `[${event.tenant.toUpperCase()}]`;
  const headline = `${tag} ${event.wake_type} ${event.event_type.replaceAll("_", " ")}`.trim();
  const artifact = event.artifact_path ? `\n${event.artifact_path}` : "";
  return `${headline}\n${event.summary}${artifact}`.trim();
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    if (!event.user_visible) return;

    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: renderMessage(event),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram notify failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }
}

export function createTelegramNotifierFromEnv(): TelegramNotifier | null {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_CHAT_ID"]?.trim();
  if (!botToken || !chatId) return null;
  return new TelegramNotifier(botToken, chatId);
}
