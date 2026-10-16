export function normalizeEmail(email) {
    const normalized = email.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (!normalized || normalized.length > 254 || !normalized.includes('@')) {
        throw new Error('Invalid email address');
    }
    return normalized;
}
