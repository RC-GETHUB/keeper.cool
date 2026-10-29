// Trims Instagram's media objects (often 10–20 KB each) down to what Keeper
// uses. Loaded before instagram.js; also loaded by Keeper's tests.
(() => {
  function pickImage(versions) {
    const candidates = versions && versions.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const bySize = [...candidates].sort((a, b) => (a.width || 0) - (b.width || 0));
    return (bySize.find((c) => (c.width || 0) >= 150) || bySize[bySize.length - 1]).url || null;
  }

  function kindOf(media) {
    if (media.product_type === "clips") return "reel";
    if (media.product_type === "igtv") return "tv";
    return "post";
  }

  function liteMedia(media) {
    if (!media || typeof media.code !== "string") return null;
    // "id" is "<media id>_<owner id>" and arrives as a string, so it keeps
    // every digit; "pk" is a number too big for JavaScript unless the
    // response was read with big numbers quoted (see instagram.js).
    const pk = typeof media.id === "string" ? media.id.split("_")[0] : media.pk != null ? String(media.pk) : null;
    if (!pk) return null;
    const firstSlide = Array.isArray(media.carousel_media) ? media.carousel_media[0] : null;
    const owner = media.user || media.owner || {};
    const ids = media.saved_collection_ids;
    return {
      pk,
      code: media.code,
      kind: kindOf(media),
      author: typeof owner.username === "string" ? owner.username : null,
      caption: media.caption && typeof media.caption.text === "string" ? media.caption.text : null,
      image: pickImage(media.image_versions2) || pickImage(firstSlide && firstSlide.image_versions2),
      collectionIds: Array.isArray(ids) ? ids.map(String) : null,
    };
  }

  globalThis.KeeperMedia = { liteMedia };
})();
