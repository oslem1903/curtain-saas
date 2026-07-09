/**
 * Soft Delete Utilities
 * Adds WHERE deleted_at IS NULL filter to queries
 */

/**
 * Add soft-delete filter to a Supabase query
 * Filters out records where deleted_at is not null
 */
export function withoutDeleted(query: any) {
  return query.is('deleted_at', null);
}

/**
 * Add soft-delete filter for querying only deleted records
 * Used for admin recovery/restore pages
 */
export function onlyDeleted(query: any) {
  return query.not('deleted_at', 'is', null);
}
