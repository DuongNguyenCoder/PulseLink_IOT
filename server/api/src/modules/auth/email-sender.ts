import type { AuthEmailSender } from "./auth.routes.js";
import nodemailer from "nodemailer";

export interface SmtpTransport {
  sendMail(message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

export interface SmtpEmailSenderConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromEmail: string;
  fromName: string;
  verificationUrlTemplate: string;
  passwordResetUrlTemplate: string;
  timeoutMs: number;
}

export interface ResendEmailSenderConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  verificationUrlTemplate: string;
  passwordResetUrlTemplate: string;
  timeoutMs: number;
}

export interface EmailFetchResponse {
  ok: boolean;
  status: number;
}

export type EmailFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<EmailFetchResponse>;

export class EmailDeliveryError extends Error {
  readonly statusCode = 503;
  readonly deliveryOutcome: "not-sent" | "unknown";
  readonly deliveryCode:
    | "SMTP_AUTH_FAILED"
    | "SMTP_ENVELOPE_REJECTED"
    | "SMTP_CONNECTION_FAILED"
    | "SMTP_TIMEOUT"
    | "SMTP_PROVIDER_ERROR"
    | "EMAIL_API_AUTH_FAILED"
    | "EMAIL_API_REJECTED"
    | "EMAIL_API_TIMEOUT"
    | "EMAIL_API_NETWORK_ERROR"
    | "EMAIL_API_PROVIDER_ERROR";

  constructor(
    message: string,
    deliveryOutcome: "not-sent" | "unknown" = "unknown",
    deliveryCode: EmailDeliveryError["deliveryCode"] = "SMTP_PROVIDER_ERROR",
  ) {
    super(message);
    this.name = "EmailDeliveryError";
    this.deliveryOutcome = deliveryOutcome;
    this.deliveryCode = deliveryCode;
  }
}

function createLink(template: string, token: string): string {
  return template.replaceAll("{token}", encodeURIComponent(token));
}

function textBody(
  title: string,
  link: string,
  token: string,
  expiresAt: Date,
): string {
  return `${title}\n\nUse this link to continue:\n${link}\n\nIf the link is unavailable, use this one-time token in the app:\n${token}\n\nThis link expires at ${expiresAt.toISOString()}.`;
}

export class SmtpEmailSender implements AuthEmailSender {
  private readonly transporter: SmtpTransport;

  constructor(
    private readonly config: SmtpEmailSenderConfig,
    transporter?: SmtpTransport,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth:
          config.username === undefined
            ? undefined
            : { user: config.username, pass: config.password },
        connectionTimeout: config.timeoutMs,
        greetingTimeout: config.timeoutMs,
        socketTimeout: config.timeoutMs,
      });
  }

  async sendVerification(input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: "Verify your PulseLink email",
      title: "Verify your PulseLink email",
      link: createLink(this.config.verificationUrlTemplate, input.token),
      token: input.token,
      expiresAt: input.expiresAt,
    });
  }

  async sendPasswordReset(input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: "Reset your PulseLink password",
      title: "Reset your PulseLink password",
      link: createLink(this.config.passwordResetUrlTemplate, input.token),
      token: input.token,
      expiresAt: input.expiresAt,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    title: string;
    link: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: { name: this.config.fromName, address: this.config.fromEmail },
        to: input.to,
        subject: input.subject,
        text: textBody(input.title, input.link, input.token, input.expiresAt),
        html: `<p>${input.title}</p><p><a href="${input.link}">Continue in PulseLink</a></p><p>This link expires at ${input.expiresAt.toISOString()}.</p>`,
      });
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      const providerCode = typeof code === "string" ? code : undefined;
      if (providerCode === "EAUTH") {
        throw new EmailDeliveryError(
          "SMTP email delivery failed",
          "not-sent",
          "SMTP_AUTH_FAILED",
        );
      }
      if (providerCode === "EENVELOPE") {
        throw new EmailDeliveryError(
          "SMTP email delivery failed",
          "not-sent",
          "SMTP_ENVELOPE_REJECTED",
        );
      }
      if (
        ["ECONNECTION", "ECONNREFUSED", "ENOTFOUND"].includes(
          providerCode ?? "",
        )
      ) {
        throw new EmailDeliveryError(
          "SMTP email delivery failed",
          "not-sent",
          "SMTP_CONNECTION_FAILED",
        );
      }
      if (["ETIMEDOUT", "ESOCKET"].includes(providerCode ?? "")) {
        throw new EmailDeliveryError(
          "SMTP email delivery failed",
          "unknown",
          "SMTP_TIMEOUT",
        );
      }
      throw new EmailDeliveryError(
        "SMTP email delivery failed",
        "unknown",
        "SMTP_PROVIDER_ERROR",
      );
    }
  }
}

export class ResendEmailSender implements AuthEmailSender {
  private readonly fetchEmail: EmailFetch;

  constructor(
    private readonly config: ResendEmailSenderConfig,
    fetchEmail: EmailFetch = globalThis.fetch.bind(globalThis) as EmailFetch,
  ) {
    this.fetchEmail = fetchEmail;
  }

  async sendVerification(input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: "Verify your PulseLink email",
      title: "Verify your PulseLink email",
      link: createLink(this.config.verificationUrlTemplate, input.token),
      token: input.token,
      expiresAt: input.expiresAt,
    });
  }

  async sendPasswordReset(input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: "Reset your PulseLink password",
      title: "Reset your PulseLink password",
      link: createLink(this.config.passwordResetUrlTemplate, input.token),
      token: input.token,
      expiresAt: input.expiresAt,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    title: string;
    link: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchEmail("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${this.config.fromName} <${this.config.fromEmail}>`,
          to: [input.to],
          subject: input.subject,
          text: textBody(input.title, input.link, input.token, input.expiresAt),
          html: `<p>${input.title}</p><p><a href="${input.link}">Continue in PulseLink</a></p><p>This link expires at ${input.expiresAt.toISOString()}.</p>`,
        }),
        signal: controller.signal,
      });

      if (response.ok) return;
      if (response.status === 401 || response.status === 403) {
        throw new EmailDeliveryError(
          "Email API delivery failed",
          "not-sent",
          "EMAIL_API_AUTH_FAILED",
        );
      }
      throw new EmailDeliveryError(
        "Email API delivery failed",
        "not-sent",
        "EMAIL_API_REJECTED",
      );
    } catch (error: unknown) {
      if (error instanceof EmailDeliveryError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new EmailDeliveryError(
          "Email API delivery failed",
          "unknown",
          "EMAIL_API_TIMEOUT",
        );
      }
      throw new EmailDeliveryError(
        "Email API delivery failed",
        "unknown",
        "EMAIL_API_NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * The repository has no email provider implementation yet. Keeping this
 * explicit failure is safer than pretending a verification/reset email was
 * delivered or logging the one-time token.
 */
export const unavailableEmailSender: AuthEmailSender = {
  async sendVerification(): Promise<void> {
    throw new Error("Email delivery provider is not configured");
  },
  async sendPasswordReset(): Promise<void> {
    throw new Error("Email delivery provider is not configured");
  },
};
