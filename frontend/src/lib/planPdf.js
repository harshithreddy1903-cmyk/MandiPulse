import { normalizePlan, planQuantityLabel } from './planData.js';
import { mixedPlanLabels } from './planLabels.js';

const PAGE = { width: 210, height: 297, margin: 16, bottom: 277 };
const WIDTH = PAGE.width - PAGE.margin * 2;
const MM_PER_PT = 25.4 / 72;
const COLORS = {
  ink: [28, 35, 53], muted: [97, 107, 127], blue: [47, 94, 226],
  violet: [103, 76, 210], pale: [239, 243, 255], green: [24, 116, 82],
  paleGreen: [235, 247, 241], line: [221, 227, 238], white: [255, 255, 255],
};
const SYSTEM_FONT = '"Nirmala UI", "Noto Sans Kannada", Tunga, Arial, sans-serif';
const number = (value, digits = 2) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
const finite = value => value === null || value === undefined || value === '' || typeof value === 'boolean'
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const nonnegative = value => { const result = finite(value); return result !== null && result >= 0 ? result : null; };
const money = value => value === null ? 'Not available' : `Rs. ${number(value)}`;
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
const clean = value => String(value ?? '')
  .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/[\u00b7\u2022]/g, ' | ').replace(/₹/g, 'Rs. ');
const usesCanvas = value => /[^\x20-\x7e\n]/.test(value);
const normalizeCaveat = value => clean(value).replace(/\s+/g, ' ').trim().toLowerCase();
// These API boilerplates repeat the full buying note below. Other caveats may
// contain plan-specific instructions and must remain intact.
const standardCaveats = new Set([
  'Based on official wholesale records. Freight is included only when you supplied a rate. Confirm quality, distance, actual transport charges, and current availability before buying.',
  'Wholesale market prices are indicative. Freight is your estimate, and current availability and transport costs should be confirmed before purchase.',
  'Wholesale prices are indicative. Freight is your estimate; confirm transport and availability.',
].map(normalizeCaveat));

function planModel(input) {
  const plan = normalizePlan(input);
  if (!plan || !Array.isArray(plan.ranking) || !plan.ranking.length) {
    throw new Error('This plan has no market records. Rebuild the plan before creating its PDF.');
  }
  const quantityValue = nonnegative(plan.quantity_value);
  const factor = plan.quantity_unit === 'kg' ? 0.01 : plan.quantity_unit === 'tonnes' ? 10 : 1;
  const quantity = nonnegative(plan.quantity_quintals) ?? (quantityValue === null ? null : quantityValue * factor);
  const mixed = Boolean(plan.multi_commodity);
  const count = plan.ranking.length;
  const requestedKg = quantity === null ? null : quantity * 100;
  const fallbackKg = requestedKg === null ? null : requestedKg / count;
  const rows = plan.ranking.map((row, index) => {
    const modal = nonnegative(row.modal_price_inr_per_quintal) ?? nonnegative(row.modal_price);
    const freight = nonnegative(row.freight_inr_per_quintal) ?? nonnegative(plan.freight_inr_per_quintal) ?? 0;
    const landed = nonnegative(row.landed_cost_inr_per_quintal) ?? (modal === null ? null : modal + freight);
    const suppliedWeight = nonnegative(row.suggested_kg);
    const weight = suppliedWeight ?? fallbackKg;
    const total = nonnegative(row.estimated_total_inr) ?? (mixed
      ? landed === null || weight === null ? null : landed * weight / 100
      : landed === null || quantity === null ? null : landed * quantity);
    return { ...row, index, modal, freight, landed, weight, total, inferredWeight: mixed && suppliedWeight === null };
  });
  const allCostsKnown = rows.every(row => row.total !== null);
  const total = mixed ? allCostsKnown ? rows.reduce((sum, row) => sum + row.total, 0) : null : rows[0].total;
  const allWeightsKnown = rows.every(row => row.weight !== null);
  const totalKg = mixed && allWeightsKnown ? rows.reduce((sum, row) => sum + row.weight, 0) : requestedKg;
  const budget = nonnegative(plan.budget_inr);
  const hasFreight = mixed && rows.some(row => row.freight > 0);
  // Freight follows the entered rate and exact requested quantity. Rounded crop
  // costs can differ by a few paise; reconcile those in the wholesale subtotal.
  const uniformFreight = rows.every(row => row.freight === rows[0].freight);
  let freightAmount = null;
  if (quantity !== null && (!mixed || uniformFreight && quantity > 0)) {
    freightAmount = quantity * rows[0].freight;
  } else if (mixed && allWeightsKnown) {
    freightAmount = rows.reduce((sum, row) => sum + row.freight * row.weight / 100, 0);
  }
  const freightTotal = freightAmount === null ? null : roundMoney(freightAmount);
  const wholesaleTotal = total === null || freightTotal === null ? null : roundMoney(roundMoney(total) - freightTotal);
  return { plan, mixed, mixedLabels: mixedPlanLabels(plan), rows, quantity, totalKg, total, budget, hasFreight, wholesaleTotal, freightTotal, inferredWeights: rows.some(row => row.inferredWeight) };
}

// Keep text as real PDF text for Latin fields. Canvas uses installed system fonts for
// user-entered Kannada and other scripts, without a font request or font embedding.
function makeLayout(pdf, model) {
  let y = 0;
  let canvas;
  let context;
  const canvasContext = () => {
    if (!context) {
      if (typeof document === 'undefined') throw new Error('Create this PDF in the browser to preserve non-Latin text.');
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
      if (!context) throw new Error('The browser could not render the plan text. Please try another browser.');
    }
    return context;
  };
  const font = (size, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
  };
  const measure = (value, size, bold = false) => {
    font(size, bold);
    if (!usesCanvas(value)) return pdf.getTextWidth(value);
    const ctx = canvasContext();
    ctx.font = `${bold ? '600' : '400'} ${size * 96 / 72}px ${SYSTEM_FONT}`;
    return ctx.measureText(value).width * 25.4 / 96;
  };
  const graphemes = value => typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), entry => entry.segment)
    : Array.from(value);
  const wrap = (value, width, size = 9, bold = false) => {
    const output = [];
    for (const paragraph of clean(value).split('\n')) {
      if (!paragraph.trim()) { output.push(''); continue; }
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u)) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, size, bold) <= width) { line = next; continue; }
        if (line) { output.push(line); line = ''; }
        if (measure(word, size, bold) <= width) { line = word; continue; }
        for (const glyph of graphemes(word)) {
          if (line && measure(line + glyph, size, bold) > width) { output.push(line); line = ''; }
          line += glyph;
        }
      }
      if (line) output.push(line);
    }
    return output;
  };
  const text = (value, x, top, size = 9, { bold = false, color = COLORS.ink, align = 'left' } = {}) => {
    const string = clean(value);
    font(size, bold);
    pdf.setTextColor(...color);
    const actualX = align === 'right' ? x - measure(string, size, bold) : align === 'center' ? x - measure(string, size, bold) / 2 : x;
    if (!usesCanvas(string)) { pdf.text(string, actualX, top + size * MM_PER_PT); return; }
    const ctx = canvasContext();
    const scale = 3;
    const pixelsPerMm = 96 / 25.4 * scale;
    const fontPx = size * 96 / 72 * scale;
    const imageWidth = measure(string, size, bold) + 1.5;
    const imageHeight = size * MM_PER_PT * 1.65;
    canvas.width = Math.max(1, Math.ceil(imageWidth * pixelsPerMm));
    canvas.height = Math.max(1, Math.ceil(imageHeight * pixelsPerMm));
    ctx.font = `${bold ? '600' : '400'} ${fontPx}px ${SYSTEM_FONT}`;
    ctx.fillStyle = `rgb(${color.join(',')})`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(string, 0, fontPx * 1.12);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', actualX, top - size * MM_PER_PT * 0.12, imageWidth, imageHeight, undefined, 'FAST');
  };
  const page = first => {
    if (!first) pdf.addPage();
    pdf.setFillColor(247, 249, 253);
    pdf.rect(0, 0, PAGE.width, PAGE.height, 'F');
    pdf.setFillColor(17, 23, 39);
    pdf.rect(0, 0, PAGE.width, first ? 46 : 28, 'F');
    pdf.setFillColor(...COLORS.blue);
    pdf.rect(0, first ? 45 : 27, PAGE.width, 1.2, 'F');
    text('MANDIPULSE  /  KARNATAKA MARKET DESK', PAGE.margin, 10, 8, { bold: true, color: [176, 195, 255] });
    text(first ? model.mixed ? model.mixedLabels.title : 'YOUR BUYING PLAN' : 'BUYING PLAN  /  CONTINUED', PAGE.margin, first ? 23 : 18, first ? 18 : 10, { bold: true, color: COLORS.white });
    if (first) text('Dated wholesale records. A provisional estimate for your next purchase.', PAGE.margin, 36, 8, { color: [189, 199, 218] });
    y = first ? 54 : 36;
  };
  const ensure = height => { if (y + height > PAGE.bottom) page(false); };
  const paragraph = (value, { size = 9, bold = false, color = COLORS.muted, width = WIDTH, x = PAGE.margin, gap = 4 } = {}) => {
    const lines = wrap(value, width, size, bold);
    const lineHeight = size * MM_PER_PT * 1.42;
    for (const line of lines) { ensure(lineHeight); text(line, x, y, size, { bold, color }); y += lineHeight; }
    y += gap;
  };
  const heading = (title, note = '') => {
    ensure(21);
    y += 3;
    paragraph(title, { size: 10, bold: true, color: COLORS.ink, gap: 2 });
    if (note) paragraph(note, { size: 8, gap: 4 });
  };
  const metricIcon = (kind, x, top, color) => {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(0.28);
    if (kind === 'weight') {
      pdf.circle(x + 2.4, top + 0.8, 0.75, 'S');
      pdf.lines([[2.6, 0], [0.9, 3.2], [-4.4, 0], [0.9, -3.2]], x + 1.1, top + 1.4, [1, 1], 'S', true);
    } else if (kind === 'transport') {
      pdf.rect(x, top + 0.8, 3.1, 2.7, 'S');
      pdf.lines([[1.1, 0], [0.7, 1.1], [0, 1.6], [-1.8, 0]], x + 3.1, top + 0.8, [1, 1], 'S', true);
      pdf.circle(x + 1, top + 3.8, 0.6, 'S');
      pdf.circle(x + 4, top + 3.8, 0.6, 'S');
    } else if (kind === 'market') {
      pdf.lines([[2.4, -1.3], [2.4, 1.3]], x, top + 1.4, [1, 1], 'S', false);
      pdf.rect(x + 0.4, top + 1.6, 4, 2.8, 'S');
      pdf.rect(x + 1.9, top + 2.6, 1.1, 1.8, 'S');
    } else {
      pdf.roundedRect(x, top + 1.2, 4.8, 3, 0.5, 0.5, 'S');
      pdf.circle(x + 2.4, top + 2.7, 0.7, 'S');
      pdf.line(x + 0.8, top + 0.4, x + 4.5, top + 0.4);
    }
    pdf.setLineWidth(0.2);
  };
  const measureMetrics = items => {
    const gap = 4;
    const width = (WIDTH - gap * (items.length - 1)) / items.length;
    const values = items.map(item => wrap(item.value, width - 10, 13, true));
    const notes = items.map(item => wrap(item.note || '', width - 10, 7.5));
    const height = Math.max(...items.map((_, index) => 16 + values[index].length * 5.6 + notes[index].length * 3.7));
    return { gap, width, values, notes, height };
  };
  const metrics = items => {
    const { gap, width, values, notes, height } = measureMetrics(items);
    ensure(height + 5);
    items.forEach((item, index) => {
      const x = PAGE.margin + index * (width + gap);
      pdf.setFillColor(...(item.green ? COLORS.paleGreen : COLORS.pale));
      pdf.roundedRect(x, y, width, height, 3, 3, 'F');
      metricIcon(item.icon || 'total', x + width - 10, y + 3, item.green ? COLORS.green : COLORS.blue);
      text(item.label, x + 5, y + 4, 7, { bold: true, color: COLORS.muted });
      values[index].forEach((line, lineIndex) => text(line, x + 5, y + 10 + lineIndex * 5.6, 13, { bold: true, color: item.green ? COLORS.green : COLORS.ink }));
      const noteY = y + 12 + values[index].length * 5.6;
      notes[index].forEach((line, lineIndex) => text(line, x + 5, noteY + lineIndex * 3.7, 7.5, { color: COLORS.muted }));
    });
    y += height + 6;
  };
  const record = (row, maxCost) => {
    const mixed = model.mixed;
    const title = mixed ? row.commodity || model.mixedLabels.itemFallback : row.market || 'Market not supplied';
    const location = mixed ? [row.market, row.district].filter(Boolean).join(', ') : row.district || 'District not supplied';
    const quality = [row.product_form && `Form: ${row.product_form}`, row.variety && `Variety: ${row.variety}`, row.grade && `Grade: ${row.grade}`].filter(Boolean).join(' | ');
    const blocks = [
      { value: title, size: 10, bold: true, color: COLORS.ink },
      { value: location, size: 8, color: COLORS.muted },
      ...(quality ? [{ value: quality, size: 7.5, color: COLORS.muted }] : []),
      { value: `Price date: ${row.arrival_date || 'Not supplied'} | ${money(row.modal)} / quintal`, size: 7.5, color: COLORS.muted },
      ...(mixed && row.price_trend ? [{ value: `7-day price trend: ${row.price_trend}`, size: 7.5, color: COLORS.muted }] : []),
    ];
    const leftWidth = WIDTH - 62;
    const lines = blocks.flatMap(block => wrap(block.value, leftWidth, block.size, block.bold).map(value => ({ ...block, value, height: block.size * MM_PER_PT * 1.45 })));
    const barHeight = mixed ? 0 : 5;
    const cardPadding = mixed ? 7 : 9;
    const minHeight = mixed ? 24 : 28;
    let continued = false;
    while (lines.length) {
      const fullHeight = Math.max(minHeight, cardPadding + barHeight + lines.reduce((sum, line) => sum + line.height, 0));
      const fullPageHeight = PAGE.bottom - 36;
      if (fullHeight <= fullPageHeight) ensure(fullHeight + 3);
      else ensure(35);
      const available = Math.min(fullHeight, PAGE.bottom - y - 3);
      const selected = [];
      let textHeight = 0;
      while (lines.length && textHeight + lines[0].height <= available - cardPadding - barHeight) {
        const next = lines.shift(); selected.push(next); textHeight += next.height;
      }
      const height = Math.max(minHeight, cardPadding + barHeight + textHeight);
      pdf.setFillColor(...COLORS.white);
      pdf.setDrawColor(...COLORS.line);
      pdf.roundedRect(PAGE.margin, y, WIDTH, height, 2.5, 2.5, 'FD');
      pdf.setFillColor(...(row.index === 0 ? COLORS.blue : COLORS.pale));
      pdf.circle(PAGE.margin + 5, y + 6, 2.6, 'F');
      text(String(row.index + 1), PAGE.margin + 5, y + 4.4, 7, { align: 'center', bold: true, color: row.index === 0 ? COLORS.white : COLORS.blue });
      let top = y + 3;
      selected.forEach(line => { text(line.value, PAGE.margin + 11, top, line.size, line); top += line.height; });
      const right = PAGE.width - PAGE.margin - 5;
      if (mixed) {
        text(row.weight === null ? 'Weight not set' : `${number(row.weight, 3)} kg`, right, y + 4, 11, { bold: true, align: 'right', color: COLORS.blue });
        text(money(row.total), right, y + 11, 9, { bold: true, align: 'right' });
        text(row.freight > 0 ? `incl. ${money(row.freight)}/qtl freight` : 'wholesale estimate', right, y + 16, 7, { align: 'right', color: COLORS.muted });
      } else {
        text(money(row.landed), right, y + 4, 11, { bold: true, align: 'right', color: COLORS.blue });
        text('per quintal, incl. freight', right, y + 10, 6.9, { align: 'right', color: COLORS.muted });
        text(`${money(row.total)} total`, right, y + 17, 8, { bold: true, align: 'right' });
        const barY = y + height - 5;
        pdf.setFillColor(231, 236, 246); pdf.roundedRect(PAGE.margin + 11, barY, WIDTH - 22, 1.6, 0.8, 0.8, 'F');
        if (row.landed !== null && row.landed > 0) {
          pdf.setFillColor(...COLORS.blue);
          pdf.roundedRect(PAGE.margin + 11, barY, Math.max(1.6, (WIDTH - 22) * row.landed / maxCost), 1.6, 0.8, 0.8, 'F');
        }
      }
      if (continued) text('continued', right, y + height - 4, 6, { align: 'right', color: COLORS.muted });
      y += height + 3;
      if (lines.length) { continued = true; page(false); }
    }
  };
  page(true);
  return { paragraph, heading, metrics, metricsHeight: items => measureMetrics(items).height + 6, record, text, wrap, page, ensure, get y() { return y; }, set y(value) { y = value; } };
}

/** Build a PDF without downloading it. Throws on missing records or rendering errors. */
export async function createPlanPdf(input) {
  const model = planModel(input);
  const { plan, mixed, mixedLabels, rows, totalKg, total, budget, hasFreight } = model;
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `${plan.commodity || 'Crop'} buying plan`, subject: 'Provisional wholesale buying estimate', author: 'MandiPulse', creator: 'MandiPulse' });
  const layout = makeLayout(pdf, model);
  layout.paragraph('PROVISIONAL BUYING ESTIMATE', { size: 7.5, bold: true, color: COLORS.blue, gap: 3 });
  layout.paragraph(plan.commodity || (mixed ? mixedLabels.stockName : 'Crop'), { size: 18, bold: true, color: COLORS.ink, gap: 3 });
  layout.paragraph(`Quantity: ${planQuantityLabel(plan)}${totalKg === null ? '' : ` | ${number(totalKg, 3)} kg in total`}`, { size: 9, gap: 2 });
  layout.paragraph(`Destination: ${plan.destination || 'Not specified'}`, { size: 9, gap: 5 });
  layout.metrics([
    { label: mixed ? hasFreight ? 'LANDED ESTIMATE' : 'WHOLESALE TOTAL' : 'ESTIMATED BUYING TOTAL', value: money(total), note: mixed ? hasFreight ? 'Includes your entered freight estimate' : 'Before transport and other charges' : 'For the first ranked market', green: true, icon: 'total' },
    mixed
      ? { label: 'STOCK TO BUY', value: totalKg === null ? 'Not supplied' : `${number(totalKg, 3)} kg`, note: `${rows.length} ${mixedLabels.typeName} ${rows.length === 1 ? 'type' : 'types'} in this plan`, icon: 'weight' }
      : { label: 'DELIVERED / QUINTAL', value: money(rows[0].landed), note: 'Includes the entered freight estimate' },
  ]);
  if (budget !== null) {
    const balance = total === null ? 'Cost is incomplete; compare the budget after confirming prices.' : total <= budget ? `Estimated balance: ${money(budget - total)}.` : `Estimated amount above budget: ${money(total - budget)}.`;
    layout.paragraph(`Budget: ${money(budget)}. ${balance}${mixed && !hasFreight ? ' Transport is excluded from this comparison.' : ''}`, { size: 8.5, bold: true, color: total !== null && total > budget ? [156, 66, 35] : COLORS.green });
  }
  if (mixed) {
    layout.heading(mixedLabels.sectionTitle, hasFreight
      ? 'Each crop cost includes the entered freight estimate. The rate is shown alongside the cost; confirm actual delivery charges.'
      : 'Every amount below is a wholesale estimate for the weight shown. Transport is excluded.');
    if (model.inferredWeights) layout.paragraph('Some saved weights were missing. Those weights are an estimated equal split of the requested total; confirm them before ordering.', { size: 8, color: [146, 92, 29] });
  } else {
    layout.heading('COMPARE THE MATCHING MARKETS', 'Bars compare estimated delivered cost per quintal. A shorter bar means a lower entered cost.');
  }
  const maxCost = Math.max(1, ...rows.map(row => row.landed || 0));
  for (const row of rows) layout.record(row, maxCost);
  if (mixed) {
    layout.heading('YOUR STOCK TOTAL');
    layout.paragraph(`${totalKg === null ? 'Weight not available' : `${number(totalKg, 3)} kg`} across ${rows.length} crops. ${hasFreight ? 'Landed' : 'Wholesale'} estimate: ${money(total)} ${hasFreight ? 'including entered freight' : 'before transport'}.`, { size: 10, bold: true, color: COLORS.green });
    if (hasFreight) layout.paragraph(`Wholesale: ${money(model.wholesaleTotal)} + entered freight: ${money(model.freightTotal)} = ${money(total)}. Other charges are not included.`, { size: 8.5, color: COLORS.ink });
    layout.paragraph('The stock split is a provisional trial mix. Market prices do not show what your customers will buy; adjust weights using your own sales demand.', { size: 8.5 });
  } else {
    const best = rows[0];
    const costCards = [
      { label: 'MARKET / QUINTAL', value: money(best.modal), note: 'Dated wholesale modal price', icon: 'market' },
      { label: 'FREIGHT / QUINTAL', value: money(best.freight), note: 'Your estimate; confirm with a transporter', icon: 'transport' },
      { label: 'DELIVERED / QUINTAL', value: money(best.landed), note: 'Estimated price including entered freight', green: true, icon: 'total' },
    ];
    // Reserve the heading/subtitle and measured cards as one readable section.
    layout.ensure(22 + layout.metricsHeight(costCards));
    layout.heading('HOW THE FIRST MARKET COST ADDS UP', 'Market price + entered freight estimate = estimated delivered price per quintal.');
    layout.metrics(costCards);
    layout.paragraph(`${money(best.landed)} per quintal x ${model.quantity === null ? 'quantity not supplied' : `${number(model.quantity, 5)} ${model.quantity === 1 ? 'quintal' : 'quintals'}`} = ${money(total)} estimated total.`, { size: 8.5, bold: true, color: COLORS.ink });
    if (!best.freight) layout.paragraph('No transport charge has been included. A zero freight entry does not confirm free delivery.', { size: 8.5, color: [146, 92, 29] });
  }
  layout.heading('SOURCE, DATES AND BUYING NOTES');
  const sourceLabel = source => typeof source === 'string' ? source : source?.name || source?.title || source?.url || '';
  const sources = [], seenSources = new Set();
  for (const label of [sourceLabel(plan.source), ...rows.map(row => sourceLabel(row.source))]) {
    for (const part of clean(label).split(/\s*\|\s*|\s+\/\s+/).map(value => value.trim()).filter(Boolean)) {
      const identity = part.toLowerCase();
      if (!seenSources.has(identity)) { seenSources.add(identity); sources.push(part); }
    }
  }
  layout.paragraph(`Source: ${sources.length ? sources.join(' | ') : 'Not supplied with this saved plan. Confirm the source before purchasing.'}`, { size: 8, gap: 2 });
  const dates = [...new Set(rows.map(row => row.arrival_date).filter(Boolean))];
  layout.paragraph(`Record dates: ${dates.length ? dates.join(', ') : 'Not supplied'}.${plan.updated_at ? ` Feed update: ${clean(plan.updated_at)}.` : ''}`, { size: 8, gap: 2 });
  layout.paragraph('Dated wholesale prices and entered freight are estimates, not a supplier quote. Confirm today\'s price, quality, variety/grade, current stock, distance, loading and actual transport charges before buying.', { size: 8.5, color: COLORS.ink, gap: 0 });
  if (plan.caveat && !standardCaveats.has(normalizeCaveat(plan.caveat))) layout.paragraph(plan.caveat, { size: 8, gap: 0 });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...COLORS.line); pdf.line(PAGE.margin, 282, PAGE.width - PAGE.margin, 282);
    layout.text(`MandiPulse | Prepared ${new Date().toISOString().slice(0, 10)} | Confirm price and availability`, PAGE.margin, 285, 7, { color: COLORS.muted });
    layout.text(`${page} / ${pages}`, PAGE.width - PAGE.margin, 285, 7, { color: COLORS.muted, align: 'right' });
  }
  return pdf;
}

/** Start a browser download. Errors propagate so the caller can show a truthful result. */
export async function downloadPlanPdf(input) {
  const model = planModel(input);
  const pdf = await createPlanPdf(model.plan);
  const crop = clean(model.mixed ? model.mixedLabels.filenameStem : model.plan.commodity || 'crop')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'crop';
  const quantity = model.totalKg === null ? '' : `-${String(Number(model.totalKg.toFixed(3))).replace('.', '-')}-kg`;
  const filename = `mandipulse-${crop}${quantity}-buying-plan-${new Date().toISOString().slice(0, 10)}.pdf`;
  // jsPDF's promise form reports save failures rather than claiming success early.
  await pdf.save(filename, { returnPromise: true });
  return { filename, pages: pdf.getNumberOfPages() };
}
