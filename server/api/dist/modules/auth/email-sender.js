import nodemailer from "nodemailer";
export class EmailDeliveryError extends Error {
    statusCode = 503;
    deliveryOutcome;
    constructor(message, deliveryOutcome = "unknown") {
        super(message);
        this.name = "EmailDeliveryError";
        this.deliveryOutcome = deliveryOutcome;
    }
}
function createLink(template, token) {
    return template.replaceAll("{token}", encodeURIComponent(token));
}
function textBody(title, link, token, expiresAt) {
    return `${title}\n\nUse this link to continue:\n${link}\n\nIf the link is unavailable, use this one-time token in the app:\n${token}\n\nThis link expires at ${expiresAt.toISOString()}.`;
}
export class SmtpEmailSender {
    config;
    transporter;
    constructor(config, transporter) {
        this.config = config;
        this.transporter =
            transporter ??
                nodemailer.createTransport({
                    host: config.host,
                    port: config.port,
                    secure: config.secure,
                    auth: config.username === undefined
                        ? undefined
                        : { user: config.username, pass: config.password },
                    connectionTimeout: config.timeoutMs,
                    greetingTimeout: config.timeoutMs,
                    socketTimeout: config.timeoutMs,
                });
    }
    async sendVerification(input) {
        await this.send({
            to: input.email,
            subject: "Verify your PulseLink email",
            title: "Verify your PulseLink email",
            link: createLink(this.config.verificationUrlTemplate, input.token),
            token: input.token,
            expiresAt: input.expiresAt,
        });
    }
    async sendPasswordReset(input) {
        await this.send({
            to: input.email,
            subject: "Reset your PulseLink password",
            title: "Reset your PulseLink password",
            link: createLink(this.config.passwordResetUrlTemplate, input.token),
            token: input.token,
            expiresAt: input.expiresAt,
        });
    }
    async send(input) {
        try {
            await this.transporter.sendMail({
                from: { name: this.config.fromName, address: this.config.fromEmail },
                to: input.to,
                subject: input.subject,
                text: textBody(input.title, input.link, input.token, input.expiresAt),
                html: `<p>${input.title}</p><p><a href="${input.link}">Continue in PulseLink</a></p><p>This link expires at ${input.expiresAt.toISOString()}.</p>`,
            });
        }
        catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error
                ? error.code
                : undefined;
            const notSent = code === "EAUTH" || code === "EENVELOPE";
            throw new EmailDeliveryError("SMTP email delivery failed", notSent ? "not-sent" : "unknown");
        }
    }
}
/**
 * The repository has no email provider implementation yet. Keeping this
 * explicit failure is safer than pretending a verification/reset email was
 * delivered or logging the one-time token.
 */
export const unavailableEmailSender = {
    async sendVerification() {
        throw new Error("Email delivery provider is not configured");
    },
    async sendPasswordReset() {
        throw new Error("Email delivery provider is not configured");
    },
};
