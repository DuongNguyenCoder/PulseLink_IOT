import {
  InvalidFcmTokenError,
  PermanentFcmError,
  type FcmSender,
  TransientFcmError,
} from "./fcm.client.js";

export interface ClaimedNotificationJob {
  id: string;
  eventId: string;
  pushTokenId: string;
  token: string;
  eventType: string;
  attempts: number;
  eventReceivedAt?: Date;
  leaseRecovered?: boolean;
}

export interface NotificationQueueSnapshot {
  counts: Record<"PENDING" | "PROCESSING" | "SENT" | "FAILED", number>;
  oldestPendingAt: Date | null;
  retryPendingCount: number;
  expiredLeaseCount: number;
  workers: Array<{
    workerId: string;
    lastHeartbeatAt: Date;
    lastProcessedAt: Date | null;
  }>;
}

export interface NotificationWorkerMetrics {
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  invalidTokens: number;
  leaseRecoveries: number;
  lastProcessedAt: Date | null;
}

export interface NotificationJobRepository {
  claim(
    limit: number,
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedNotificationJob[]>;
  markSent(id: string, messageId: string, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, reason: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  deactivateToken(pushTokenId: string, now: Date): Promise<void>;
  recordHeartbeat?(
    workerId: string,
    now: Date,
    lastProcessedAt?: Date,
  ): Promise<void>;
  getQueueSnapshot?(now: Date): Promise<NotificationQueueSnapshot>;
}

export interface NotificationWorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface NotificationWorkerOptions {
  workerId?: string;
  concurrency?: number;
  leaseMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  pollMs?: number;
  now?: () => Date;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: NotificationWorkerLogger;
}

const defaultLogger: NotificationWorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function boundedReason(error: unknown): string {
  if (error instanceof InvalidFcmTokenError) return "invalid_fcm_token";
  if (error instanceof TransientFcmError) return "transient_fcm_error";
  if (error instanceof PermanentFcmError) return "permanent_fcm_error";
  return "fcm_send_failed";
}

function backoffMilliseconds(
  attempts: number,
  base: number,
  maximum: number,
  random: () => number,
): number {
  const exponential = Math.min(maximum, base * 2 ** Math.max(0, attempts - 1));
  return Math.floor(exponential * (0.75 + random() * 0.5));
}

export class NotificationWorker {
  private readonly options: Required<
    Omit<NotificationWorkerOptions, "logger" | "now" | "random" | "sleep">
  > & {
    now: () => Date;
    random: () => number;
    sleep: (milliseconds: number) => Promise<void>;
    logger: NotificationWorkerLogger;
  };
  private stopped = false;
  private lastProcessedAt: Date | undefined;
  private readonly metrics: NotificationWorkerMetrics = {
    processed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    invalidTokens: 0,
    leaseRecoveries: 0,
    lastProcessedAt: null,
  };

  constructor(
    private readonly repository: NotificationJobRepository,
    private readonly sender: FcmSender,
    options: NotificationWorkerOptions = {},
  ) {
    this.options = {
      concurrency: options.concurrency ?? 10,
      workerId: options.workerId ?? `worker-${process.pid}`,
      leaseMs: options.leaseMs ?? 60_000,
      maxAttempts: options.maxAttempts ?? 5,
      baseBackoffMs: options.baseBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 300_000,
      pollMs: options.pollMs ?? 1_000,
      now: options.now ?? (() => new Date()),
      random: options.random ?? Math.random,
      sleep:
        options.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds))),
      logger: options.logger ?? defaultLogger,
    };
  }

  stop(): void {
    this.stopped = true;
  }

  getMetrics(): NotificationWorkerMetrics {
    return { ...this.metrics };
  }

  async processOnce(): Promise<number> {
    const now = this.options.now();
    await this.repository.recordHeartbeat?.(
      this.options.workerId,
      now,
      this.lastProcessedAt,
    );
    const jobs = await this.repository.claim(
      this.options.concurrency,
      now,
      new Date(now.getTime() + this.options.leaseMs),
    );
    this.metrics.processed += jobs.length;
    this.metrics.leaseRecoveries += jobs.filter(
      (job) => job.leaseRecovered === true,
    ).length;
    await Promise.all(jobs.map((job) => this.processJob(job)));
    this.lastProcessedAt =
      jobs.length > 0 ? this.options.now() : this.lastProcessedAt;
    this.metrics.lastProcessedAt = this.lastProcessedAt ?? null;
    await this.repository.recordHeartbeat?.(
      this.options.workerId,
      this.options.now(),
      this.lastProcessedAt,
    );
    return jobs.length;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const count = await this.processOnce();
      if (count === 0 && !this.stopped)
        await this.options.sleep(this.options.pollMs);
    }
  }

  private async processJob(job: ClaimedNotificationJob): Promise<void> {
    try {
      const messageId = await this.sender.send({
        token: job.token,
        data: {
          eventId: job.eventId,
          eventType: job.eventType,
        },
      });
      await this.repository.markSent(job.id, messageId, this.options.now());
      this.metrics.sent += 1;
      const eventToSendMs =
        job.eventReceivedAt === undefined
          ? undefined
          : Math.max(
              0,
              this.options.now().getTime() - job.eventReceivedAt.getTime(),
            );
      this.options.logger.info(
        {
          notificationId: job.id,
          outcome: "sent",
          attempts: job.attempts,
          eventToSendMs,
          leaseRecovered: job.leaseRecovered ?? false,
        },
        "Notification sent",
      );
    } catch (error: unknown) {
      const reason = boundedReason(error);
      if (error instanceof InvalidFcmTokenError) {
        await this.repository.deactivateToken(
          job.pushTokenId,
          this.options.now(),
        );
        await this.repository.markFailed(job.id, reason);
        this.metrics.failed += 1;
        this.metrics.invalidTokens += 1;
        this.options.logger.warn(
          {
            notificationId: job.id,
            outcome: "invalid_token",
            attempts: job.attempts,
          },
          "Notification token deactivated",
        );
        return;
      }

      if (
        error instanceof TransientFcmError &&
        job.attempts < this.options.maxAttempts
      ) {
        const delay = backoffMilliseconds(
          job.attempts,
          this.options.baseBackoffMs,
          this.options.maxBackoffMs,
          this.options.random,
        );
        await this.repository.markRetry(
          job.id,
          new Date(this.options.now().getTime() + delay),
          reason,
        );
        this.metrics.retried += 1;
        this.options.logger.warn(
          { notificationId: job.id, outcome: "retry", attempts: job.attempts },
          "Notification scheduled for retry",
        );
        return;
      }

      await this.repository.markFailed(job.id, reason);
      this.metrics.failed += 1;
      this.options.logger.error(
        {
          notificationId: job.id,
          outcome: "failed",
          attempts: job.attempts,
          reason,
          leaseRecovered: job.leaseRecovered ?? false,
        },
        "Notification permanently failed",
      );
    }
  }
}
