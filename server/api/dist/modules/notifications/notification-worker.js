import { InvalidFcmTokenError, PermanentFcmError, TransientFcmError, } from "./fcm.client.js";
const defaultLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};
function boundedReason(error) {
    if (error instanceof InvalidFcmTokenError)
        return "invalid_fcm_token";
    if (error instanceof TransientFcmError)
        return "transient_fcm_error";
    if (error instanceof PermanentFcmError)
        return "permanent_fcm_error";
    return "fcm_send_failed";
}
function backoffMilliseconds(attempts, base, maximum, random) {
    const exponential = Math.min(maximum, base * 2 ** Math.max(0, attempts - 1));
    return Math.floor(exponential * (0.75 + random() * 0.5));
}
export class NotificationWorker {
    repository;
    sender;
    options;
    stopped = false;
    lastProcessedAt;
    metrics = {
        processed: 0,
        sent: 0,
        retried: 0,
        failed: 0,
        invalidTokens: 0,
        cancelled: 0,
        leaseRecoveries: 0,
        lastProcessedAt: null,
    };
    constructor(repository, sender, options = {}) {
        this.repository = repository;
        this.sender = sender;
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
            sleep: options.sleep ??
                ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
            logger: options.logger ?? defaultLogger,
        };
    }
    stop() {
        this.stopped = true;
    }
    getMetrics() {
        return { ...this.metrics };
    }
    async processOnce() {
        const now = this.options.now();
        await this.repository.recordHeartbeat?.(this.options.workerId, now, this.lastProcessedAt);
        await this.repository.cancelIneligibleJobs?.(now);
        const jobs = await this.repository.claim(this.options.concurrency, now, new Date(now.getTime() + this.options.leaseMs));
        this.metrics.processed += jobs.length;
        this.metrics.leaseRecoveries += jobs.filter((job) => job.leaseRecovered === true).length;
        await Promise.all(jobs.map((job) => this.processJob(job)));
        this.lastProcessedAt =
            jobs.length > 0 ? this.options.now() : this.lastProcessedAt;
        this.metrics.lastProcessedAt = this.lastProcessedAt ?? null;
        await this.repository.recordHeartbeat?.(this.options.workerId, this.options.now(), this.lastProcessedAt);
        return jobs.length;
    }
    async run() {
        while (!this.stopped) {
            const count = await this.processOnce();
            if (count === 0 && !this.stopped)
                await this.options.sleep(this.options.pollMs);
        }
    }
    async processJob(job) {
        let tokenFingerprint = job.tokenFingerprint;
        try {
            const eligibility = await this.repository.revalidate?.(job);
            if (eligibility !== undefined && !eligibility.eligible) {
                await this.repository.cancel?.(job.id, eligibility.reason ?? "recipient_no_longer_eligible");
                this.metrics.cancelled += 1;
                this.options.logger.info({ notificationId: job.id, outcome: "cancelled" }, "Notification recipient is no longer eligible");
                return;
            }
            const token = eligibility?.token ?? job.token;
            tokenFingerprint = eligibility?.tokenFingerprint ?? job.tokenFingerprint;
            const messageId = await this.sender.send({
                token,
                data: {
                    eventId: job.eventId,
                    eventType: job.eventType,
                },
            });
            await this.repository.markSent(job.id, messageId, this.options.now());
            this.metrics.sent += 1;
            const eventToSendMs = job.eventReceivedAt === undefined
                ? undefined
                : Math.max(0, this.options.now().getTime() - job.eventReceivedAt.getTime());
            this.options.logger.info({
                notificationId: job.id,
                outcome: "sent",
                attempts: job.attempts,
                eventToSendMs,
                leaseRecovered: job.leaseRecovered ?? false,
            }, "Notification sent");
        }
        catch (error) {
            const reason = boundedReason(error);
            if (error instanceof InvalidFcmTokenError) {
                if (job.appInstallationId !== null &&
                    this.repository.invalidateInstallationToken !== undefined) {
                    await this.repository.invalidateInstallationToken(job.appInstallationId, tokenFingerprint, this.options.now());
                }
                else if (job.pushTokenId !== null) {
                    await this.repository.deactivateToken(job.pushTokenId, this.options.now());
                }
                await this.repository.markFailed(job.id, reason);
                this.metrics.failed += 1;
                this.metrics.invalidTokens += 1;
                this.options.logger.warn({
                    notificationId: job.id,
                    outcome: "invalid_token",
                    attempts: job.attempts,
                }, "Notification token deactivated");
                return;
            }
            if (error instanceof TransientFcmError &&
                job.attempts < this.options.maxAttempts) {
                const delay = backoffMilliseconds(job.attempts, this.options.baseBackoffMs, this.options.maxBackoffMs, this.options.random);
                await this.repository.markRetry(job.id, new Date(this.options.now().getTime() + delay), reason);
                this.metrics.retried += 1;
                this.options.logger.warn({ notificationId: job.id, outcome: "retry", attempts: job.attempts }, "Notification scheduled for retry");
                return;
            }
            await this.repository.markFailed(job.id, reason);
            this.metrics.failed += 1;
            this.options.logger.error({
                notificationId: job.id,
                outcome: "failed",
                attempts: job.attempts,
                reason,
                leaseRecovered: job.leaseRecovered ?? false,
            }, "Notification permanently failed");
        }
    }
}
