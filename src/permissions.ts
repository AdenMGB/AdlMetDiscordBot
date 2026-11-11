const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_GUILD = 1n << 5n;

export function canManageServer(permissionBits: string | undefined): boolean {
	if (!permissionBits) {
		return false;
	}
	const bits = BigInt(permissionBits);
	return (bits & PERM_ADMINISTRATOR) !== 0n || (bits & PERM_MANAGE_GUILD) !== 0n;
}
