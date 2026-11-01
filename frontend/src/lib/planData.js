const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizePlan(input = {}) {
  const recommendation = input.recommendation && typeof input.recommendation === 'object' ? input.recommendation : {};
  const stored = recommendation.plan && typeof recommendation.plan === 'object' ? recommendation.plan : recommendation;
  const exactSnapshot = recommendation.version === 2 && stored === recommendation.plan;
  const merged = { ...stored, ...input };
  const ranking = Array.isArray(input.ranking) ? input.ranking : Array.isArray(stored.ranking) ? stored.ranking : [];
  // Older database columns rounded quintals to whole kilograms. Keep the v2
  // snapshot's quantity and display unit together when restoring those rows.
  const quantityQuintals = numeric(exactSnapshot ? stored.quantity_quintals ?? input.quantity_quintals : input.quantity_quintals ?? stored.quantity_quintals);
  const unit = (exactSnapshot ? stored.quantity_unit || input.quantity_unit : input.quantity_unit || stored.quantity_unit) || 'quintals';
  const factor = unit === 'kg' ? 100 : unit === 'tonnes' ? 0.1 : 1;
  const quantityValue = numeric(exactSnapshot ? stored.quantity_value : input.quantity_value ?? stored.quantity_value, quantityQuintals * factor);
  return {
    ...merged,
    commodity: input.commodity || stored.commodity || 'Crop',
    summary: input.summary || stored.summary || '',
    quantity_quintals: quantityQuintals,
    quantity_value: quantityValue,
    quantity_unit: unit,
    budget_inr: input.budget_inr !== undefined ? input.budget_inr : stored.budget_inr ?? null,
    destination: input.destination || stored.destination || 'Not specified',
    freight_inr_per_quintal: numeric(input.freight_inr_per_quintal ?? stored.freight_inr_per_quintal ?? input.assumptions?.freight_inr_per_quintal),
    ranking,
    sources: Array.isArray(input.sources) ? input.sources : Array.isArray(stored.sources) ? stored.sources : [],
    multi_commodity: Boolean(input.multi_commodity ?? stored.multi_commodity ?? ranking.some(row => row.suggested_kg != null)),
    caveat: input.caveat || stored.caveat || '',
    source: input.source || stored.source || 'AGMARKNET / data.gov.in',
    updated_at: input.updated_at || stored.updated_at || null,
  };
}

export function planQuantityLabel(input) {
  const plan = normalizePlan(input);
  const number = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
  const amount = number(plan.quantity_value);
  const quintals = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 5 }).format(plan.quantity_quintals);
  const quintalUnit = plan.quantity_quintals === 1 ? 'quintal' : 'quintals';
  if (plan.quantity_unit === 'kg') return `${amount} kg (${quintals} ${quintalUnit})`;
  if (plan.quantity_unit === 'tonnes') return `${amount} ${plan.quantity_value === 1 ? 'tonne' : 'tonnes'} (${quintals} ${quintalUnit})`;
  return `${amount} ${plan.quantity_value === 1 ? 'quintal' : 'quintals'}`;
}

export function totalPlanCost(input) {
  const plan = normalizePlan(input);
  return plan.multi_commodity
    ? plan.ranking.reduce((sum, row) => sum + numeric(row.estimated_total_inr), 0)
    : numeric(plan.ranking[0]?.estimated_total_inr);
}

export function serializePlanRecommendation(input) {
  const plan = normalizePlan(input);
  const snapshot = {};
  for (const key of ['commodity', 'summary', 'quantity_quintals', 'quantity_value', 'quantity_unit', 'budget_inr', 'destination', 'freight_inr_per_quintal', 'ranking', 'sources', 'multi_commodity', 'caveat', 'source', 'updated_at']) snapshot[key] = plan[key];
  return { version: 2, market: plan.ranking[0]?.market || '', summary: plan.summary, plan: snapshot };
}
