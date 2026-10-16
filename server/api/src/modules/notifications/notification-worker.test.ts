import { describe, expect, it } from "vitest";
import {
  InvalidFcmTokenError,
  TransientFcmError,
  type FcmSender,
} from "./fcm.client.js";
import {
  NotificationWorker,
  type ClaimedNotificationJob,
  type NotificationJobRepository,
} from "./notification-worker.js";

const job: ClaimedNotificationJob = {
  id: "notification-1",
  eventId: "event-1",
  pushTokenId: "token-1",
  token: "opaque-test-token",
  eventType: "BUTTON_PRESSED",
  attempts: 1,
};

class FakeRepository implements NotificationJobRepository {
  claimed: ClaimedNotificationJob[] = [job];
  sent: Array<{ id: string; messageId: string }> = [];
  retries: Array<{ id: string; nextAttemptAt: Date; reason: string }> = [];
  failed: Array<{ id: string; reason: string }> = [];
  deactivated: string[] = [];

  async claim(): Promise<ClaimedNotificationJob[]> {
    const result = this.claimed;
    this.claimed = [];
    return result;
  }

  async markSent(id: string, messageId: string): Promise<void> {
    this.sent.push({ id, messageId });
  }

  async markRetry(
    id: string,
    nextAttemptAt: Date,
    reason: string,
  ): Promise<void> {
    this.retries.push({ id, nextAttemptAt, reason });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    this.failed.push({ id, reason });
  }

  async deactivateToken(pushTokenId: string): Promise<void> {
    this.deactivated.push(pushTokenId);
  }
}

class FakeSender implements FcmSender {
  constructor(private readonly error?: Error) {}
  messages: Array<{ token: string; data: Record<string, string> }> = [];

  async send(message: {
    token: string;
    data: Record<string, string>;
  }): Promise<string> {
    this.messages.push(message);
    if (this.error) throw this.error;
    return "fcm-message-1";
  }
}

describe("notification worker", () => {
  it("sends claimed jobs and records the provider message ID", async () => {
    const repository = new FakeRepository();
    const sender = new FakeSender();
    const worker = new NotificationWorker(repository, sender, {
      now: () => new Date("2026-10-15T14:00:00.000Z"),
    });

    await expect(worker.processOnce()).resolves.toBe(1);
    expect(sender.messages).toEqual([
      {
        token: "opaque-test-token",
        data: { eventId: "event-1", eventType: "BUTTON_PRESSED" },
      },
    ]);
    expect(repository.sent).toEqual([
      { id: "notification-1", messageId: "fcm-message-1" },
    ]);
    expect(worker.getMetrics()).toMatchObject({
      processed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    });
  });

  it("schedules transient failures with bounded exponential backoff", async () => {
    const repository = new FakeRepository();
    const worker = new NotificationWorker(
      repository,
      new FakeSender(new TransientFcmError()),
      {
        now: () => new Date("2026-10-15T14:00:00.000Z"),
        random: () => 0.5,
        baseBackoffMs: 1_000,
        maxBackoffMs: 10_000,
      },
    );

    await worker.processOnce();
    expect(repository.retries[0]).toMatchObject({
      id: "notification-1",
      reason: "transient_fcm_error",
    });
    expect(repository.retries[0]?.nextAttemptAt).toEqual(
      new Date("2026-10-15T14:00:01.000Z"),
    );
    expect(worker.getMetrics()).toMatchObject({ processed: 1, retried: 1 });
  });

  it("deactivates invalid tokens and does not retry them", async () => {
    const repository = new FakeRepository();
    const worker = new NotificationWorker(
      repository,
      new FakeSender(new InvalidFcmTokenError()),
    );

    await worker.processOnce();
    expect(repository.deactivated).toEqual(["token-1"]);
    expect(repository.failed).toEqual([
      { id: "notification-1", reason: "invalid_fcm_token" },
    ]);
    expect(repository.retries).toHaveLength(0);
  });

  it("marks a transient job failed after the retry limit", async () => {
    const repository = new FakeRepository();
    repository.claimed = [{ ...job, attempts: 5 }];
    const worker = new NotificationWorker(
      repository,
      new FakeSender(new TransientFcmError()),
      {
        maxAttempts: 5,
      },
    );

    await worker.processOnce();
    expect(repository.failed).toEqual([
      { id: "notification-1", reason: "transient_fcm_error" },
    ]);
    expect(repository.retries).toHaveLength(0);
  });

  it("contains provider failures so another claimed job can complete", async () => {
    const repository = new FakeRepository();
    repository.claimed = [
      job,
      { ...job, id: "notification-2", pushTokenId: "token-2" },
    ];
    let calls = 0;
    const sender: FcmSender = {
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error("provider failure");
        return "message-2";
      },
    };
    const worker = new NotificationWorker(repository, sender);

    await expect(worker.processOnce()).resolves.toBe(2);
    expect(repository.failed).toHaveLength(1);
    expect(repository.sent).toEqual([
      { id: "notification-2", messageId: "message-2" },
    ]);
  });

  it("stops its polling loop gracefully", async () => {
    const repository = new FakeRepository();
    repository.claimed = [];
    let worker!: NotificationWorker;
    let sleeps = 0;
    worker = new NotificationWorker(repository, new FakeSender(), {
      sleep: async () => {
        sleeps += 1;
        worker.stop();
      },
    });

    await worker.run();
    expect(sleeps).toBe(1);
  });
});
