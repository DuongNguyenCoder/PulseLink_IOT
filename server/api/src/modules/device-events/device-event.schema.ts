import { z } from "zod";

const MAX_PAYLOAD_BYTES = 32 * 1024;

const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    try {
      const serialized = JSON.stringify(value);
      if (
        serialized === undefined ||
        Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES
      ) {
        context.addIssue({ code: "custom", message: "Payload is too large" });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Payload must be JSON serializable",
      });
    }
  });

export const deviceEventBodySchema = z
  .object({
    eventId: z.uuid(),
    type: z.enum(["BUTTON_PRESSED"]),
    occurredAt: z.iso.datetime({ offset: true }),
    firmwareVersion: z.string().min(1).max(40).optional(),
    rssiDbm: z.number().int().min(-200).max(100).optional(),
    payload: jsonObjectSchema.optional(),
  })
  .strict();

export type DeviceEventBody = z.infer<typeof deviceEventBodySchema>;
