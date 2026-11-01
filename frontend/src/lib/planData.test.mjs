import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, serializePlanRecommendation, totalPlanCost, planQuantityLabel } from './planData.js';
const mixed = { commodity:'Vegetable shop starter', quantity_quintals:20, quantity_value:2, quantity_unit:'tonnes', multi_commodity:true, freight_inr_per_quintal:12, caveat:'Confirm stock.', sources:[{market:'A'}], ranking:[{commodity:'Tomato',market:'A',suggested_kg:1000,estimated_total_inr:9000},{commodity:'Onion',market:'B',suggested_kg:1000,estimated_total_inr:14000}] };
test('saved mixed plans round trip every crop, weight, unit and cost',()=>{
 const saved={id:'saved',commodity:mixed.commodity,quantity_quintals:20,recommendation:serializePlanRecommendation(mixed)};
 const restored=normalizePlan(saved);
 assert.equal(restored.multi_commodity,true);assert.equal(restored.quantity_unit,'tonnes');assert.equal(restored.quantity_value,2);assert.equal(restored.freight_inr_per_quintal,12);assert.deepEqual(restored.ranking,mixed.ranking);assert.equal(totalPlanCost(restored),23000);assert.equal(restored.caveat,mixed.caveat);assert.deepEqual(restored.sources,mixed.sources);
});
test('legacy saved mixed plans recover their type from weighted rows',()=>{
 const old={commodity:mixed.commodity,quantity_quintals:20,assumptions:{freight_inr_per_quintal:25},recommendation:{ranking:mixed.ranking,summary:'Trial mix',quantity_value:2000,quantity_unit:'kg'}};
 assert.equal(normalizePlan(old).multi_commodity,true);assert.equal(normalizePlan(old).freight_inr_per_quintal,25);assert.equal(totalPlanCost(old),23000);
});
test('saved pulse plans preserve official names and whole or processed form metadata',()=>{
 const plan={commodity:'Pulse starter mix',multi_commodity:true,quantity_quintals:1,ranking:[
  {commodity:'Alasande Gram',product_form:'Whole pulse',suggested_kg:50,estimated_total_inr:3000},
  {commodity:'Bengal Gram Dal',product_form:'Processed dal',suggested_kg:50,estimated_total_inr:3500},
 ]};
 const snapshot=serializePlanRecommendation(plan);
 const restored=normalizePlan({commodity:plan.commodity,quantity_quintals:1,recommendation:snapshot});
 assert.deepEqual(restored.ranking,plan.ranking);
 assert.equal(restored.ranking[0].commodity,'Alasande Gram');
 assert.equal(restored.ranking[0].product_form,'Whole pulse');
 assert.equal(restored.ranking[1].product_form,'Processed dal');
 assert.deepEqual(serializePlanRecommendation(restored).plan.ranking,plan.ranking);
});
test('legacy single crop totals use the best option, not sum of alternatives',()=>{
 const old={commodity:'Tomato',quantity_quintals:2,recommendation:{ranking:[{estimated_total_inr:2000},{estimated_total_inr:3000}]}};
 assert.equal(normalizePlan(old).multi_commodity,false);assert.equal(totalPlanCost(old),2000);assert.equal(planQuantityLabel(old),'2 quintals');
});
test('unit displays preserve the requested tonne or kilogram unit',()=>{
 assert.equal(planQuantityLabel(mixed),'2 tonnes (20 quintals)');assert.equal(planQuantityLabel({quantity_quintals:0.5,quantity_unit:'kg',quantity_value:50}),'50 kg (0.5 quintals)');
});

test('v2 saved 0.1 kg keeps its exact snapshot quantity despite a rounded database zero',()=>{
 const original={commodity:'Tomato',quantity_quintals:0.001,quantity_value:0.1,quantity_unit:'kg',ranking:[{market:'A',estimated_total_inr:1}]};
 const saved={commodity:'Tomato',quantity_quintals:0,quantity_value:0,quantity_unit:'quintals',recommendation:serializePlanRecommendation(original)};
 const restored=normalizePlan(saved);
 assert.equal(restored.quantity_quintals,0.001);assert.equal(restored.quantity_value,0.1);assert.equal(restored.quantity_unit,'kg');
 assert.equal(planQuantityLabel(saved),'0.1 kg (0.001 quintals)');assert.equal(totalPlanCost(saved),1);
 assert.equal(planQuantityLabel({quantity_quintals:0.00001,quantity_value:0.001,quantity_unit:'kg'}),'0.001 kg (0.00001 quintals)');
});

test('v2 saved 1.5 kg keeps matching weight and units despite conflicting rounded database fields',()=>{
 const original={commodity:'Tomato',quantity_quintals:0.015,quantity_value:1.5,quantity_unit:'kg',ranking:[{market:'A',estimated_total_inr:15}]};
 const saved={commodity:'Tomato',quantity_quintals:0.02,quantity_value:0.02,quantity_unit:'quintals',recommendation:serializePlanRecommendation(original)};
 const restored=normalizePlan(saved);
 assert.equal(restored.quantity_quintals,0.015);assert.equal(restored.quantity_value,1.5);assert.equal(restored.quantity_unit,'kg');
 assert.equal(planQuantityLabel(saved),'1.5 kg (0.015 quintals)');assert.equal(totalPlanCost(saved),15);
 assert.equal(serializePlanRecommendation(restored).plan.quantity_quintals,0.015);
});
