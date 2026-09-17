/**
 * The permission a handler requires, set by `@RequirePermission()`. Namespaced
 * so it cannot collide with metadata set by Nest or by a library, like
 * IS_PUBLIC_KEY and IS_ORGANIZATION_SCOPED_KEY.
 */
export const REQUIRED_PERMISSION_KEY = 'authorization:requiredPermission';
