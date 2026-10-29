import { buildDeviceEnrollmentRequest } from "../src/modules/provisioning/device-enrollment-request.js";

const MAX_INPUT_BYTES = 8192;

async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_INPUT_BYTES) throw new Error("Input too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const input: unknown = JSON.parse(await readInput());
  const request = buildDeviceEnrollmentRequest(input);
  process.stdout.write(`${JSON.stringify(request)}\n`);
} catch {
  process.stderr.write("Enrollment proof input is invalid or expired; no request was sent.\n");
  process.exitCode = 1;
}
