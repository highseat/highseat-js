import { identify, type UserId } from "./index"

/**
 * Identifies `userId` when it differs from `previous`, the id identified last, and returns the id
 * identified now. `undefined` means the session has not loaded, so it changes nothing and keeps
 * `previous`: a session that reloads with the same user calls `identify` once, not twice.
 */
export function syncIdentity(previous: UserId, userId: UserId): UserId {
  if (userId === undefined || userId === previous) return previous
  identify(userId)
  return userId
}
