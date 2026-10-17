/** Static facts about each network, free of server-only code so the browser can import them too. */
export const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

export const TIKTOK_LIMITS = { video: 2200, photoTitle: 90, photoDescription: 4000 };

/** Maximum caption length per platform (TikTok photos also get a 90-character title cut from it). */
export const CAPTION_LIMITS = { facebook: 63000, instagram: 2200, tiktok: TIKTOK_LIMITS.video };
