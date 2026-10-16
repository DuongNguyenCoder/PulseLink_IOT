export class UnauthenticatedError extends Error {
    statusCode = 401;
    constructor() {
        super('Authentication required');
        this.name = 'UnauthenticatedError';
    }
}
export async function assertCurrentAccountAccess(prisma, token) {
    const account = await prisma.account.findUnique({
        where: { id: token.accountId },
        select: { status: true, authVersion: true },
    });
    if (account === null ||
        account.status === 'DISABLED' ||
        account.authVersion !== token.authVersion) {
        throw new UnauthenticatedError();
    }
    return account;
}
