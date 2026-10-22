import { describe, expect, it } from "vitest";
import {
  EmailDeliveryError,
  SmtpEmailSender,
  type SmtpEmailSenderConfig,
  type SmtpTransport,
} from "./email-sender.js";

const config: SmtpEmailSenderConfig = {
  host: "smtp.test.invalid",
  port: 587,
  secure: false,
  username: "smtp-user",
  password: "smtp-password",
  fromEmail: "sender@example.com",
  fromName: "PulseLink",
  verificationUrlTemplate: "https://app.example.com/verify?token={token}",
  passwordResetUrlTemplate: "https://app.example.com/reset?token={token}",
  timeoutMs: 1000,
};

describe("SmtpEmailSender", () => {
  it("sends verification content with configured sender and encoded link", async () => {
    let message: Parameters<SmtpTransport["sendMail"]>[0] | undefined;
    const transport: SmtpTransport = {
      sendMail: async (value) => {
        message = value;
      },
    };
    const sender = new SmtpEmailSender(config, transport);
    await sender.sendVerification({
      email: "owner@example.com",
      token: "token with spaces",
      expiresAt: new Date("2026-10-20T00:00:00.000Z"),
    });

    expect(message).toMatchObject({
      from: { name: "PulseLink", address: "sender@example.com" },
      to: "owner@example.com",
      subject: "Verify your PulseLink email",
    });
    expect(message?.text).toContain("token%20with%20spaces");
    expect(message?.text).toContain("token with spaces");
  });

  it("maps SMTP authentication and envelope failures as definitely unsent", async () => {
    const transport: SmtpTransport = {
      sendMail: async () => {
        throw Object.assign(new Error("hidden provider detail"), {
          code: "EAUTH",
        });
      },
    };
    const sender = new SmtpEmailSender(config, transport);

    await expect(
      sender.sendPasswordReset({
        email: "owner@example.com",
        token: "reset-token",
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject<Partial<EmailDeliveryError>>({
      deliveryOutcome: "not-sent",
      deliveryCode: "SMTP_AUTH_FAILED",
      statusCode: 503,
    });
  });

  it("treats timeouts and unknown SMTP errors as delivery-unknown", async () => {
    const transport: SmtpTransport = {
      sendMail: async () => {
        throw Object.assign(new Error("timeout detail"), { code: "ETIMEDOUT" });
      },
    };
    const sender = new SmtpEmailSender(config, transport);

    await expect(
      sender.sendPasswordReset({
        email: "owner@example.com",
        token: "reset-token",
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({
      deliveryOutcome: "unknown",
      deliveryCode: "SMTP_TIMEOUT",
      statusCode: 503,
    });
  });
});
