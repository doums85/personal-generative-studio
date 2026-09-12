const QUALITY_HINTS = [['pro', 4], ['ultra', 4], ['max', 4], ['flash', 2], ['turbo', 2], ['fast', 1]];

function qualityScore(model) {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return QUALITY_HINTS.reduce((score, [hint, weight]) => score + (text.includes(hint) ? weight : 0), 3);
}

function priceScore(model) {
  if (model.comparableUnitPrice === null) return 0;
  return 1 / (1 + model.comparableUnitPrice);
}

export function selectModel(models, { modality, mode = 'balanced', requestedModel } = {}) {
  const compatible = models.filter((model) => model.modality === modality);
  if (!compatible.length) return null;
  if (requestedModel) return compatible.find((model) => model.id === requestedModel) || null;

  if (mode === 'economy') {
    return [...compatible].sort((a, b) => {
      const aPrice = a.comparableUnitPrice ?? Number.POSITIVE_INFINITY;
      const bPrice = b.comparableUnitPrice ?? Number.POSITIVE_INFINITY;
      return aPrice - bPrice || a.id.localeCompare(b.id);
    })[0];
  }

  const ranked = compatible.map((model) => {
    const quality = qualityScore(model);
    const price = priceScore(model);
    const score = mode === 'quality'
        ? quality * 10 + price
        : quality * 2 + price * 5;
    return { model, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id));
  return ranked[0].model;
}
