/**
 * Normalize PEM values supplied through environment variables or secret managers.
 * Some providers preserve literal escaped newlines, CRLF sequences, surrounding
 * quotes, or indentation around PEM lines.
 */
export function normalizePem(value) {
    const unquoted = value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ? value.slice(1, -1)
        : value;
    return unquoted
        .replaceAll("\\r\\n", "\n")
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\n")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .trim();
}
