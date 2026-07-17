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
  { name: "Domino's Pizza", style: 'Traditional', price: '$' },
  { name: 'Little Caesars', style: 'Traditional', price: '$' },
  { name: "Papa John's", style: 'Traditional', price: '$$' },
  { name: 'B.C. Pizza', style: 'Traditional', price: '$$' },
  { name: 'BC Pizza', style: 'Traditional', price: '$$' },
  { name: 'Kawkawlin Best Choice Pizza', style: 'Traditional', price: '$$' },
  { name: "Fox's Pizza", style: 'Traditional', price: '$$' },
  { name: 'Pizza Ranch', style: 'Traditional', price: '$$' },
  { name: 'Round Table Pizza', style: 'Traditional', price: '$$' },
  { name: "Simple Simon's Pizza", style: 'Traditional', price: '$$' },
  { name: '&pizza', style: 'Traditional', price: '$$' },
  { name: "LaRosa's Pizzeria", style: 'Traditional', price: '$$' },
  { name: "Sal's Pizza", style: 'Traditional', price: '$$' },
  { name: "Jet's Pizza", style: 'Detroit', price: '$$' },
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
