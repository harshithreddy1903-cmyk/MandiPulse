import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanPdf } from './planPdf.js';
import { mixedPlanLabels } from './planLabels.js';

const pdfText = pdf => pdf.internal.pages.filter(Boolean).flat().join('\n');
const vegetablePlan = (count = 10) => ({
  commodity: 'Vegetable stock', multi_commodity: true,
  quantity_value: count * 50, quantity_unit: 'kg', quantity_quintals: count / 2,
  source: 'AGMARKNET / data.gov.in', destination: 'Bengaluru',
  ranking: Array.from({ length: count }, (_, index) => ({
    commodity: `Vegetable ${String(index + 1).padStart(2, '0')}`,
    market: `Market ${index + 1}`, district: 'Bengaluru',
    suggested_kg: 50, modal_price: 1000 + index * 100,
    estimated_total_inr: (1000 + index * 100) / 2,
    arrival_date: '2026-10-23', variety: 'Local', grade: 'FAQ',
  })),
});

test('the live one-market Apple plan fits one page with one source label and complete buying warnings', async () => {
  const pdf = await createPlanPdf({
    commodity: 'Apple', quantity_value: 2, quantity_unit: 'tonnes', quantity_quintals: 20,
    destination: 'Bengaluru', budget_inr: 50000, freight_inr_per_quintal: 100,
    source: 'data.gov.in | AGMARKNET', updated_at: '2026-10-29T14:44:14Z',
    caveat: 'Based on official wholesale records. Freight is included only when you supplied a rate. Confirm quality, distance, actual transport charges, and current availability before buying.',
    ranking: [{ market: 'Binny Mill (FF&V) Bengaluru APMC', district: 'Bengaluru', variety: 'Apple', grade: 'Large',
      arrival_date: '29/10/2026', modal_price_inr_per_quintal: 14000, freight_inr_per_quintal: 100,
      landed_cost_inr_per_quintal: 14100, estimated_total_inr: 282000, source: 'AGMARKNET | data.gov.in' }],
  });
  assert.equal(pdf.getNumberOfPages(),1);
  const output = pdfText(pdf);
  assert.ok(output.includes('Rs. 2,82,000'));
  assert.ok(output.includes('Rs. 2,32,000'));
  assert.ok(output.includes('Source: data.gov.in | AGMARKNET'));
  assert.ok(!output.includes('AGMARKNET | AGMARKNET'));
  assert.ok(output.includes('not a supplier quote'));
  assert.ok(output.includes('actual transport charges before buying.'));
});

test('mixed plan prints every crop weight and sums every crop rather than the first market', async () => {
  const pdf = await createPlanPdf(vegetablePlan());
  const output = pdfText(pdf);
  for (let index = 1; index <= 10; index += 1) assert.ok(output.includes(`Vegetable ${String(index).padStart(2, '0')}`));
  assert.equal((output.match(/\(50 kg\)/g) || []).length, 10);
  assert.ok(output.includes('Rs. 7,250'));
  assert.ok(output.includes('500 kg in total'));
  assert.ok(output.includes('Variety: Local | Grade: FAQ'));
  assert.ok(output.includes('Transport is excluded'));
  assert.ok(output.includes('YOUR VEGETABLE STOCK PLAN'));
  assert.equal(mixedPlanLabels(vegetablePlan()).filenameStem, 'mixed-vegetables');
});

test('mixed labels recognize pulse aliases and use crop wording for other mixed plans', () => {
  for (const commodity of ['Dal starter mix', 'Pulse starter mix', 'Lentil starter mix']) {
    const labels = mixedPlanLabels({ commodity });
    assert.equal(labels.countLabel, 'Pulse types');
    assert.equal(labels.filenameStem, 'mixed-pulses');
  }
  assert.equal(mixedPlanLabels({ category: 'pulses', commodity: 'Starter mix' }).countLabel, 'Pulse types');
  assert.equal(mixedPlanLabels({ commodity: 'Mixed grain stock' }).countLabel, 'Crop types');
  assert.equal(mixedPlanLabels({ commodity: 'Mixed grain stock' }).filenameStem, 'mixed-crops');
});

test('pulse PDF preserves whole and processed crop labels, every weight and the freight total', async () => {
  const commodities = ['Arhar (Tur/Red Gram)(Whole)', 'Bengal Gram Dal (Chana Dal)', 'Green Gram Dal (Moong Dal)', 'Lentil (Masur)(Whole)'];
  const prices = [8000, 6500, 9000, 7500];
  const caveat = 'Whole pulses and split/processed dal are different products; confirm processing, variety, grade and availability before buying.';
  const plan = {
    commodity: 'Dal starter mix', multi_commodity: true, quantity_value: 100, quantity_unit: 'kg', quantity_quintals: 1,
    destination: 'Bengaluru', budget_inr: 10000, freight_inr_per_quintal: 200,
    source: 'Illustrative QA fixture - not live prices', caveat,
    ranking: commodities.map((commodity, index) => ({
      commodity, market: `Illustrative market ${index + 1}`, district: 'Bengaluru',
      suggested_kg: 25, modal_price_inr_per_quintal: prices[index],
      freight_inr_per_quintal: 200, landed_cost_inr_per_quintal: prices[index] + 200,
      estimated_total_inr: (prices[index] + 200) / 4, arrival_date: '29/10/2026',
      product_form: index === 0 || index === 3 ? 'Whole pulse' : 'Processed dal',
      variety: 'Illustrative variety', grade: 'Illustrative grade',
    })),
  };
  const pdf = await createPlanPdf(plan);
  const output = pdfText(pdf).replace(/\\([\\()])/g, '$1');
  assert.ok(output.includes('YOUR PULSE STOCK PLAN'));
  assert.ok(output.includes('PULSES, WEIGHTS AND COSTS'));
  assert.ok(output.includes('4 pulse types in this plan'));
  assert.ok(!output.includes('VEGETABLE'));
  for (const commodity of commodities) assert.ok(output.includes(commodity), `Missing pulse product: ${commodity}`);
  assert.equal((output.match(/\(25 kg\)/g) || []).length, 4);
  for (const cost of ['Rs. 2,050', 'Rs. 1,675', 'Rs. 2,300', 'Rs. 1,925']) assert.ok(output.includes(cost));
  assert.ok(output.includes('Wholesale: Rs. 7,750 + entered freight: Rs. 200 = Rs. 7,950'));
  assert.ok(output.includes('Whole pulses and split/processed dal are different products;'));
  assert.ok(output.includes('Form: Whole pulse'));
  assert.ok(output.includes('Form: Processed dal'));
  assert.ok(output.includes('not live prices'));
  assert.equal(mixedPlanLabels(plan).filenameStem, 'mixed-pulses');
});

test('tonne input preserves units and derives stock kilograms and single-market freight math', async () => {
  const pdf = await createPlanPdf({
    commodity: 'Onion', quantity_value: 2, quantity_unit: 'tonnes', quantity_quintals: 20,
    freight_inr_per_quintal: 50, budget_inr: 22000,
    ranking: [{ market: 'Bengaluru', modal_price_inr_per_quintal: 1000, arrival_date: '2026-10-23' }],
  });
  const output = pdfText(pdf);
  assert.ok(output.includes('2 tonnes'));
  assert.ok(output.includes('2,000 kg in total'));
  assert.ok(output.includes('Rs. 21,000'));
  assert.ok(output.includes('Rs. 1,050'));
  assert.ok(output.includes('Rs. 50'));
  assert.ok(output.includes('Rs. 1,000'));
});

test('mixed freight is included exactly once with a transparent subtotal and transport rate', async () => {
  const plan = vegetablePlan();
  plan.freight_inr_per_quintal = 200;
  plan.budget_inr = 9000;
  plan.ranking = plan.ranking.map(row => ({ ...row, freight_inr_per_quintal: 200,
    landed_cost_inr_per_quintal: row.modal_price + 200,
    estimated_total_inr: (row.modal_price + 200) * row.suggested_kg / 100 }));
  const output = pdfText(await createPlanPdf(plan));
  assert.ok(output.includes('LANDED ESTIMATE'));
  assert.ok(output.includes('Rs. 8,250'));
  assert.ok(output.includes('Wholesale: Rs. 7,250 + entered freight: Rs. 1,000 = Rs. 8,250'));
  assert.ok(output.includes('incl. Rs. 200/qtl freight'));
  assert.ok(!output.includes('Transport is excluded'));
  assert.ok(!output.includes('before transport'));
  const derived = { ...plan, ranking: plan.ranking.map(({ estimated_total_inr, ...row }) => row) };
  assert.ok(pdfText(await createPlanPdf(derived)).includes('Rs. 8,250'));
});

test('the real six-dal 50 kg split keeps freight at exactly 50 rupees and reconciles the wholesale subtotal', async () => {
  const names = ['Chennangi Dal', 'Bengal Gram Dal(Chana Dal)', 'Avare Dal', 'Green Gram Dal(Moong Dal)', 'Red gram split/Arhar dal/Tur dal', 'Black Gram Dal(Urd Dal)'];
  const weights = [8.334, 8.334, 8.333, 8.333, 8.333, 8.333];
  const prices = [8100, 8800, 9000, 10400, 11800, 14300];
  const totals = [683.39, 741.73, 758.3, 874.97, 991.63, 1199.95];
  const pdf = await createPlanPdf({
    commodity: 'Dal starter mix', multi_commodity: true, quantity_value: 50, quantity_unit: 'kg', quantity_quintals: 0.5,
    destination: 'Bengaluru', budget_inr: 6000, freight_inr_per_quintal: 100,
    ranking: names.map((commodity, index) => ({ commodity, suggested_kg: weights[index],
      product_form: 'Processed dal', market: 'Bengaluru APMC', district: 'Bengaluru', arrival_date: '2026-10-30',
      modal_price_inr_per_quintal: prices[index], freight_inr_per_quintal: 100,
      landed_cost_inr_per_quintal: prices[index] + 100, estimated_total_inr: totals[index] })),
  });
  const output = pdfText(pdf);
  assert.ok(output.includes('50 kg in total'));
  assert.ok(output.includes('Rs. 5,249.97'));
  assert.ok(output.includes('Wholesale: Rs. 5,199.97 + entered freight: Rs. 50 = Rs. 5,249.97'));
  assert.ok(!output.includes('Rs. 50.02'));
  const parts = output.match(/Wholesale: Rs\. (\d[\d,]*(?:\.\d{1,2})?) \+ entered freight: Rs\. (\d[\d,]*(?:\.\d{1,2})?) = Rs\. (\d[\d,]*(?:\.\d{1,2})?)/);
  assert.ok(parts);
  const paise = value => Math.round(Number(value.replaceAll(',', '')) * 100);
  assert.equal(paise(parts[1]) + paise(parts[2]), paise(parts[3]));
  assert.equal(paise(parts[2]), 5000);
});

test('mixed plans with different per-crop freight rates calculate freight directly before reconciling totals', async () => {
  const output = pdfText(await createPlanPdf({
    commodity: 'Pulse starter mix', multi_commodity: true, quantity_quintals: 1,
    ranking: [
      { commodity: 'Whole pulse', suggested_kg: 25, modal_price: 1000, freight_inr_per_quintal: 100, estimated_total_inr: 275 },
      { commodity: 'Processed dal', suggested_kg: 75, modal_price: 2000, freight_inr_per_quintal: 200, estimated_total_inr: 1650.01 },
    ],
  }));
  assert.ok(output.includes('Wholesale: Rs. 1,750.01 + entered freight: Rs. 175 = Rs. 1,925.01'));
});

test('many records paginate without dropping the final crop', async () => {
  const pdf = await createPlanPdf(vegetablePlan(35));
  assert.ok(pdf.getNumberOfPages() >= 5);
  const output = pdfText(pdf);
  for (let index = 1; index <= 35; index += 1) assert.ok(output.includes(`Vegetable ${String(index).padStart(2, '0')}`));
  assert.ok(output.includes(`1 / ${pdf.getNumberOfPages()}`));
});

test('a typical one-market plan fits on one page with preparation date in its footer', async () => {
  const pdf = await createPlanPdf({
    commodity: 'Onion', quantity_value: 2, quantity_unit: 'tonnes', quantity_quintals: 20,
    destination: 'Bengaluru', budget_inr: 50000, freight_inr_per_quintal: 200,
    source: 'AGMARKNET / data.gov.in', updated_at: '2026-10-26T14:00:00+00:00',
    caveat: 'Wholesale prices are indicative. Freight is your estimate; confirm transport and availability.',
    ranking: [{ market: 'Haveri', district: 'Haveri', variety: 'Local', grade: 'FAQ',
      modal_price_inr_per_quintal: 2000, freight_inr_per_quintal: 200,
      landed_cost_inr_per_quintal: 2200, estimated_total_inr: 44000,
      arrival_date: '2026-10-23', source: 'AGMARKNET / data.gov.in' }],
  });
  assert.equal(pdf.getNumberOfPages(), 1);
  const output = pdfText(pdf);
  assert.ok(output.includes('Rs. 44,000'));
  assert.ok(output.includes(`Prepared ${new Date().toISOString().slice(0, 10)}`));
  assert.ok(!output.includes('100 kg = 1 quintal'));
});

test('a multi-market plan keeps the cost-flow heading and all three cards together', async () => {
  const pdf = await createPlanPdf({
    commodity: 'Tomato', quantity_value: 100, quantity_unit: 'kg', quantity_quintals: 1,
    destination: 'Bengaluru', freight_inr_per_quintal: 0,
    ranking: ['Haveri','Mysore','Bengaluru'].map((market,index)=>({
      market, district: market, variety: 'Local', grade: 'FAQ',
      modal_price_inr_per_quintal: 1000 + index * 200, arrival_date: '2026-10-26',
    })),
  });
  const pages = pdf.internal.pages.filter(Boolean).map(page=>page.join('\n'));
  const costFlowPages = pages.filter(page=>page.includes('HOW THE FIRST MARKET COST ADDS UP'));
  assert.equal(costFlowPages.length,1);
  for (const label of ['Market price + entered freight estimate', 'MARKET / QUINTAL', 'FREIGHT / QUINTAL', 'DELIVERED / QUINTAL']) {
    assert.ok(costFlowPages[0].includes(label), `Cost-flow section split before ${label}`);
  }
  assert.equal(pdf.getNumberOfPages(),2);
});

test('versioned saved-plan snapshots export the same mixed total and weights', async () => {
  const plan = vegetablePlan();
  const saved = { commodity: plan.commodity, quantity_quintals: plan.quantity_quintals, recommendation: { version: 2, plan } };
  const output = pdfText(await createPlanPdf(saved));
  assert.ok(output.includes('Rs. 7,250'));
  assert.equal((output.match(/\(50 kg\)/g) || []).length, 10);
});

test('long destinations and market descriptions wrap and paginate without losing text', async () => {
  const marker = 'LAST_DESTINATION_WORD';
  const pdf = await createPlanPdf({
    commodity: 'Tomato', quantity_quintals: 1,
    destination: `${'A long destination description '.repeat(250)} ${marker}`,
    caveat: 'Confirm the cold-room booking before pickup.',
    ranking: [{ market: 'Market description '.repeat(250) + 'LAST_MARKET_WORD', modal_price: 1800 }],
  });
  const output = pdfText(pdf);
  assert.ok(pdf.getNumberOfPages() > 3);
  assert.ok(output.includes(marker));
  assert.ok(output.includes('LAST_MARKET_WORD'));
  assert.ok(output.includes('Rs. 1,800'));
  assert.ok(output.includes('Confirm the cold-room booking before pickup.'));
});

test('missing records reject instead of creating an empty zero-cost PDF', async () => {
  await assert.rejects(createPlanPdf({ commodity: 'Onion', ranking: [] }), /no market records/i);
});

test('cost math keeps minimum supported weight precision and singular quintal wording', async () => {
  const small = pdfText(await createPlanPdf({commodity:'Tomato',quantity_value:0.001,quantity_unit:'kg',quantity_quintals:0.00001,ranking:[{market:'QA market',modal_price_inr_per_quintal:1000}]}));
  assert.ok(small.includes('0.00001 quintals'));
  assert.ok(small.includes('Rs. 0.01 estimated total'));
  const single = pdfText(await createPlanPdf({commodity:'Tomato',quantity_value:100,quantity_unit:'kg',quantity_quintals:1,ranking:[{market:'QA market',modal_price_inr_per_quintal:1000}]}));
  assert.ok(single.includes('x 1 quintal ='));
  assert.ok(!single.includes('x 1 quintals'));
});
