const LABELS = {
  vegetables: {
    title: 'YOUR VEGETABLE STOCK PLAN', countLabel: 'Vegetable types', typeName: 'vegetable',
    itemFallback: 'Vegetable', stockName: 'Vegetable stock',
    sectionTitle: 'VEGETABLES, WEIGHTS AND COSTS', filenameStem: 'mixed-vegetables',
  },
  pulses: {
    title: 'YOUR PULSE STOCK PLAN', countLabel: 'Pulse types', typeName: 'pulse',
    itemFallback: 'Pulse', stockName: 'Pulse stock',
    sectionTitle: 'PULSES, WEIGHTS AND COSTS', filenameStem: 'mixed-pulses',
  },
  crops: {
    title: 'YOUR MIXED CROP STOCK PLAN', countLabel: 'Crop types', typeName: 'crop',
    itemFallback: 'Crop', stockName: 'Mixed crop stock',
    sectionTitle: 'CROPS, WEIGHTS AND COSTS', filenameStem: 'mixed-crops',
  },
};

// Commodity names also identify saved plans that predate category metadata.
export function mixedPlanLabels(plan = {}) {
  const category = String(plan.category || '').trim();
  const commodity = String(plan.commodity || '').trim();
  const classify = value => /\b(?:dals?|pulses?|lentils?)\b/i.test(value) ? 'pulses'
    : /\b(?:vegetables?|veggies)\b/i.test(value) ? 'vegetables' : null;
  return LABELS[classify(category) || classify(commodity) || 'crops'];
}
