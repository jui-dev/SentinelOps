/** The route parameter that names the organization a request acts within. */
export const ORGANIZATION_ID_PARAM = 'organizationId';

/**
 * Marks a controller declared with `@OrganizationController()`. Namespaced so
 * it cannot collide with metadata set by Nest or by a library, like
 * IS_PUBLIC_KEY.
 */
export const IS_ORGANIZATION_SCOPED_KEY = 'tenancy:isOrganizationScoped';
