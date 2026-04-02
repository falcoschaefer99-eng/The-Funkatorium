export type NotificationEventType =
  | "task_completed"
  | "review_completed"
  | "personal_wake_completed"
  | "impulse_wake_completed"
  | "dream_completed"
  | "wake_failed";

export interface NotificationEvent {
  event_type: NotificationEventType;
  tenant: string;
  wake_type: "duty" | "baton" | "personal" | "impulse" | "dream";
  summary: string;
  artifact_path?: string;
  timestamp: string;
  user_visible: boolean;
}

export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
}

export class CompositeNotifier implements Notifier {
  constructor(private readonly notifiers: Notifier[]) {}

  async send(event: NotificationEvent): Promise<void> {
    const failures: string[] = [];
    for (const notifier of this.notifiers) {
      try {
        await notifier.send(event);
      } catch (err: unknown) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (failures.length > 0) {
      throw new Error(`Notifier failures: ${failures.join(" | ")}`);
    }
  }
}

export class NullNotifier implements Notifier {
  async send(_event: NotificationEvent): Promise<void> {
    // Intentionally empty.
  }
}
