export function acceptsSnapshot(previous, next) {
  if (!Array.isArray(next?.services)) return false;
  const currentAt = Date.parse(previous?.updatedAt);
  const nextAt = Date.parse(next.updatedAt);
  // A pending HTTP fallback (or an old socket) must not undo a newer live update.
  return !Number.isFinite(currentAt) || Number.isFinite(nextAt) && nextAt >= currentAt;
}
