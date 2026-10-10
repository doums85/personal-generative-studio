import { slugify } from '../gateway/media-files.mjs';

export const KIND_LABELS = {
  character: { fr: 'Personnage', en: 'character', role: 'the character' },
  avatar: { fr: 'Avatar', en: 'presenter avatar', role: 'the presenter' },
  place: { fr: 'Lieu', en: 'location', role: 'the location' },
  object: { fr: 'Objet', en: 'object', role: 'the object' },
  product: { fr: 'Produit', en: 'product', role: 'the product' },
  style: { fr: 'Style visuel', en: 'visual style', role: 'the visual style' },
  other: { fr: 'Référence', en: 'reference', role: 'the reference' },
};

const MENTION = /@([\p{L}\p{N}][\p{L}\p{N}_-]*(?:\s[\p{L}\p{N}][\p{L}\p{N}_-]*)?)/gu;

/** Extracts `@Name` mentions from a prompt. Two-word names are supported when they match an element. */
export function extractMentions(prompt, elements) {
  const bySlug = new Map(elements.map((element) => [slugify(element.name), element]));
  const byFirstWord = new Map();
  for (const element of elements) {
    const first = slugify(element.name.split(/\s+/)[0]);
    byFirstWord.set(first, byFirstWord.has(first) ? null : element);
  }
  const lookup = (candidate) => {
    const slug = slugify(candidate);
    return bySlug.get(slug) || byFirstWord.get(slug) || null;
  };
  const found = [];
  for (const match of String(prompt || '').matchAll(MENTION)) {
    const raw = match[1];
    const candidates = [raw, raw.split(/\s/)[0]];
    for (const candidate of candidates) {
      const element = lookup(candidate);
      if (element && !found.some((item) => item.element.id === element.id)) {
        found.push({ element, mention: `@${candidate}` });
        break;
      }
    }
  }
  return found;
}

function describe(element, index) {
  const label = KIND_LABELS[element.kind] || KIND_LABELS.object;
  const reference = element.images?.length ? ` (see reference image ${index + 1})` : '';
  const description = element.description?.trim() ? `: ${element.description.trim()}` : '';
  return `- ${element.name}, ${label.en}${reference}${description}`;
}

/**
 * Builds the final prompt sent to a model from the user's text plus the selected elements.
 * Mentions such as `@Maya` are replaced by the element name, and a continuity block lists
 * every element so the model keeps faces, places and products consistent.
 */
export function composePrompt({ prompt, elements = [], selectedIds = [], styleNotes = '' }) {
  const mentioned = extractMentions(prompt, elements);
  const ordered = [];
  for (const { element } of mentioned) if (!ordered.includes(element)) ordered.push(element);
  for (const id of selectedIds) {
    const element = elements.find((item) => item.id === id);
    if (element && !ordered.includes(element)) ordered.push(element);
  }

  let text = String(prompt || '').trim();
  for (const { element, mention } of mentioned) text = text.split(mention).join(element.name);

  const withImages = ordered.filter((element) => element.images?.length);
  const sections = [text];
  if (ordered.length) {
    sections.push(`Continuity references, keep them strictly consistent:\n${ordered.map((element) => describe(element, withImages.indexOf(element))).join('\n')}`);
  }
  if (styleNotes?.trim()) sections.push(`Project style: ${styleNotes.trim()}`);

  return {
    text: sections.join('\n\n'),
    elements: ordered,
    referenceFiles: withImages.map((element) => element.images[0]),
    elementIds: ordered.map((element) => element.id),
  };
}

/**
 * Character-sheet prompt inspired by production model-sheet workflows: one identical original
 * character rendered twice (full body + close-up) on a seamless studio background, with an
 * anti-retouch realism block so the reference stays usable across models.
 */
export function characterSheetPrompt({ name, description, style = 'photoreal', kind = 'character' }) {
  const realism = {
    photoreal: 'visible fine skin texture with natural pores and subtle asymmetries, natural sheen rather than glossy retouched finish, no beauty filter, no digital smoothing, no AI-airbrushed look, high-end but unretouched commercial photography, soft diffused studio lighting without harsh reflections, cinematic realism, 4K, sharp focus',
    editorial: 'flawless-but-natural skin with fine texture retained, soft dewy highlight on cheekbones, editorial beauty lighting with a soft key and gentle fill, high-end fashion editorial photography, magazine cover quality, 4K',
    anime: 'clean anime illustration, crisp lineart, cel-shaded flat color with soft gradient shadows, consistent character model-sheet style, even flat lighting, high-quality anime key visual, 4K',
    '3d': 'stylized 3D character render, appealing proportions, smooth subsurface-scattering skin, detailed hair strands and cloth, soft global illumination, three-point studio lighting, high-end 3D animation studio quality, 4K',
    concept: 'painterly game concept art, semi-realistic rendering, orthographic model sheet, clear silhouette, neutral even concept-art lighting, professional character concept art, 4K',
  }[style] || '';

  if (kind === 'place') {
    return `Location reference sheet for "${name}": wide establishing shot on the left and a detailed close-up of the most recognisable feature on the right, identical location in both panels, consistent lighting and time of day, ${description}. ${realism} no people, no text, no watermark, no logos, no frame borders.`;
  }
  if (kind === 'product' || kind === 'object') {
    return `Product reference sheet for "${name}": front view, three-quarter view and detail close-up of the identical object side by side on a pure white seamless studio background, consistent proportions, materials and colours, ${description}. ${realism} no hands, no text, no watermark, no logos, no frame borders.`;
  }
  if (kind === 'style') {
    return `Visual style reference board for "${name}": a grid of four small scenes rendered in the identical visual style, ${description}. Consistent palette, lighting, grain, lens and colour grading across all four. no text, no watermark, no logos.`;
  }
  return `Split-screen character sheet composition, left side a full-body shot of the character standing upright in a neutral pose facing the camera with both feet visible, right side a tight chest-up portrait of the same character, identical original character on both sides, single subject only, exactly one person, pure white seamless studio background, professional character sheet presentation. ${description}. ${realism} natural anatomy, no other people, no duplicate figures, no props, no furniture, no text, no watermark, no logos, no frame borders.`;
}
