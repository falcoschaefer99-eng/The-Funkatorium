import assert from "node:assert/strict";
import test from "node:test";
import { BrainClient } from "../src/brain.ts";
import { CompositeNotifier, NullNotifier, type NotificationEvent } from "../src/notifier.ts";
import { TelegramNotifier, createTelegramNotifierFromEnv } from "../src/notifiers/telegram.ts";

test("CompositeNotifier fans out and aggregates notifier failures", async () => {
  const seen: string[] = [];
  const event: NotificationEvent = {
    event_type: "task_completed",
    tenant: "rainer",
    wake_type: "duty",
    summary: "done",
    timestamp: new Date().toISOString(),
    user_visible: true,
  };

  const notifier = new CompositeNotifier([
    {
      async send() {
        seen.push("ok");
      },
    },
    {
      async send() {
        throw new Error("telegram down");
      },
    },
  ]);

  await assert.rejects(() => notifier.send(event), /Notifier failures: telegram down/);
  assert.deepEqual(seen, ["ok"]);

  const nullNotifier = new NullNotifier();
  await nullNotifier.send(event);
});

test("TelegramNotifier honors user visibility and reports API failures", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      fetchCalls += 1;
      return new Response("nope", { status: 500, statusText: "ERR" });
    }) as typeof fetch;

    const notifier = new TelegramNotifier("bot-token", "chat-id");

    await notifier.send({
      event_type: "task_completed",
      tenant: "rainer",
      wake_type: "duty",
      summary: "hidden",
      timestamp: new Date().toISOString(),
      user_visible: false,
    });

    assert.equal(fetchCalls, 0);

    await assert.rejects(
      () =>
        notifier.send({
          event_type: "task_completed",
          tenant: "rainer",
          wake_type: "duty",
          summary: "visible",
          timestamp: new Date().toISOString(),
          user_visible: true,
        }),
      /Telegram notify failed \(500\): nope/
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createTelegramNotifierFromEnv returns notifier only when both env vars exist", () => {
  const snapshot = { ...process.env };
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(createTelegramNotifierFromEnv(), null);

    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_CHAT_ID = "chat";
    assert.ok(createTelegramNotifierFromEnv());
  } finally {
    process.env = snapshot;
  }
});

test("BrainClient surfaces network, auth, and RPC failures", async () => {
  const originalFetch = globalThis.fetch;

  try {
    const client = new BrainClient("https://brain.example/mcp", "brain-key", "rainer");

    globalThis.fetch = (async () => {
      throw new Error("network exploded");
    }) as typeof fetch;

    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain network error: network exploded/);

    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain auth failed/);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    await assert.rejects(() => client.callTool("mind_wake", {}), /Brain RPC error -32000: nope/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
