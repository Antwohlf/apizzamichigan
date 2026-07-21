#!/usr/bin/env node
/**
 * Verify deterministic pizza chain style/price mappings used by the local
 * classifier before it calls the LLM.
 */

import { inferPriceFromChain, inferStyleFromName } from '../lib/style-inference.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cases = [
  { name: "Domino's Pizza", style: 'Standard Round', price: '$' },
  { name: 'Little Caesars', style: 'Standard Round', price: '$' },
  { name: "Papa John's", style: 'Standard Round', price: '$$' },
  { name: 'B.C. Pizza', style: 'Standard Round', price: '$$' },
  { name: 'BC Pizza', style: 'Standard Round', price: '$$' },
  { name: 'Kawkawlin Best Choice Pizza', style: 'Standard Round', price: '$$' },
  { name: "Fox's Pizza", style: 'Standard Round', price: '$$' },
  { name: 'Pizza Ranch', style: 'Standard Round', price: '$$' },
  { name: 'Round Table Pizza', style: 'Standard Round', price: '$$' },
  { name: "Simple Simon's Pizza", style: 'Standard Round', price: '$$' },
  { name: '&pizza', style: 'Standard Round', price: '$$' },
  { name: "LaRosa's Pizzeria", style: 'Standard Round', price: '$$' },
  { name: "Sal's Pizza", style: 'Standard Round', price: '$$' },
  { name: "Jet's Pizza", style: 'Detroit', price: '$$' },
  { name: 'Lou Malnati\'s', style: 'Chicago Deep Dish', price: '$$$' },
  { name: 'Frank Pepe New Haven', style: 'New Haven / Connecticut', price: null },
  { name: "Grandma Rosa's Pizza", style: 'Grandma', price: null },
  { name: 'St. Louis Pizza', style: 'St. Louis', price: null },
];

for (const testCase of cases) {
  const style = inferStyleFromName(testCase.name).style;
  const price = inferPriceFromChain(testCase.name).price;
  assert(style === testCase.style, `${testCase.name} style: expected ${testCase.style}, got ${style}`);
  assert(price === testCase.price, `${testCase.name} price: expected ${testCase.price}, got ${price}`);
}

console.log('# Style Inference Verification');
console.log(`cases=${cases.length}`);
console.log('status=ok');
