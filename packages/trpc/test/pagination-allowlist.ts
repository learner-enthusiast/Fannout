/**
 * Procedures that return a list but are NOT cursor-paginated. Keep this
 * empty unless there's a real reason — every entry needs one.
 * See docs/conventions/api.md → "Lists & pagination".
 */
export const PAGINATION_ALLOWLIST: Record<string, string> = {
  "platforms.capabilities": "Static per-platform config (one entry per supported platform, 5 today); not user data.",
  "platforms.youtubePlaylists": "Proxied live from the YouTube API (not our DB); YouTube caps the page at 50.",
  "platforms.youtubeCategories": "Proxied live from the YouTube API (not our DB); fixed list per region.",
};
