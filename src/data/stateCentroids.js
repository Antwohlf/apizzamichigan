// US State, Canadian Province, and Mexican State centroids (approximate geographic centers)
// Used for state-level aggregate markers before zoom
export const STATE_CENTROIDS = {
  // === US States ===
  AL: { lat: 32.806671, lng: -86.791130, name: 'Alabama' },
  AK: { lat: 61.370716, lng: -152.404419, name: 'Alaska' },
  AZ: { lat: 33.729759, lng: -111.431221, name: 'Arizona' },
  AR: { lat: 34.969704, lng: -92.373123, name: 'Arkansas' },
  CA: { lat: 36.116203, lng: -119.681564, name: 'California' },
  CO: { lat: 39.059811, lng: -105.311104, name: 'Colorado' },
  CT: { lat: 41.597782, lng: -72.755371, name: 'Connecticut' },
  DE: { lat: 39.318523, lng: -75.507141, name: 'Delaware' },
  DC: { lat: 38.897438, lng: -77.026817, name: 'District of Columbia' },
  FL: { lat: 27.766279, lng: -81.686783, name: 'Florida' },
  GA: { lat: 33.040619, lng: -83.643074, name: 'Georgia' },
  HI: { lat: 21.094318, lng: -157.498337, name: 'Hawaii' },
  ID: { lat: 44.240459, lng: -114.478828, name: 'Idaho' },
  IL: { lat: 40.349457, lng: -88.986137, name: 'Illinois' },
  IN: { lat: 39.849426, lng: -86.258278, name: 'Indiana' },
  IA: { lat: 42.011539, lng: -93.210526, name: 'Iowa' },
  KS: { lat: 38.526600, lng: -96.726486, name: 'Kansas' },
  KY: { lat: 37.668140, lng: -84.670067, name: 'Kentucky' },
  LA: { lat: 31.169546, lng: -91.867805, name: 'Louisiana' },
  ME: { lat: 44.693947, lng: -69.381927, name: 'Maine' },
  MD: { lat: 39.063946, lng: -76.802101, name: 'Maryland' },
  MA: { lat: 42.230171, lng: -71.530106, name: 'Massachusetts' },
  MI: { lat: 43.326618, lng: -84.536095, name: 'Michigan' },
  MN: { lat: 45.694454, lng: -93.900192, name: 'Minnesota' },
  MS: { lat: 32.741646, lng: -89.678696, name: 'Mississippi' },
  MO: { lat: 38.456085, lng: -92.288368, name: 'Missouri' },
  MT: { lat: 46.921925, lng: -110.454353, name: 'Montana' },
  NE: { lat: 41.125370, lng: -98.268082, name: 'Nebraska' },
  NV: { lat: 38.313515, lng: -117.055374, name: 'Nevada' },
  NH: { lat: 43.452492, lng: -71.563896, name: 'New Hampshire' },
  NJ: { lat: 40.298904, lng: -74.521011, name: 'New Jersey' },
  NM: { lat: 34.840515, lng: -106.248482, name: 'New Mexico' },
  NY: { lat: 42.165726, lng: -74.948051, name: 'New York' },
  NC: { lat: 35.630066, lng: -79.806419, name: 'North Carolina' },
  ND: { lat: 47.528912, lng: -99.784012, name: 'North Dakota' },
  OH: { lat: 40.388783, lng: -82.764915, name: 'Ohio' },
  OK: { lat: 35.565342, lng: -96.928917, name: 'Oklahoma' },
  OR: { lat: 44.572021, lng: -122.070938, name: 'Oregon' },
  PA: { lat: 40.590752, lng: -77.209755, name: 'Pennsylvania' },
  PR: { lat: 18.220833, lng: -66.590149, name: 'Puerto Rico' },
  RI: { lat: 41.680893, lng: -71.511780, name: 'Rhode Island' },
  SC: { lat: 33.856892, lng: -80.945007, name: 'South Carolina' },
  SD: { lat: 44.299782, lng: -99.438828, name: 'South Dakota' },
  TN: { lat: 35.747845, lng: -86.692345, name: 'Tennessee' },
  TX: { lat: 31.054487, lng: -97.563461, name: 'Texas' },
  UT: { lat: 40.150032, lng: -111.862434, name: 'Utah' },
  VT: { lat: 44.045876, lng: -72.710686, name: 'Vermont' },
  VA: { lat: 37.769337, lng: -78.169968, name: 'Virginia' },
  WA: { lat: 47.400902, lng: -121.490494, name: 'Washington' },
  WV: { lat: 38.491226, lng: -80.954453, name: 'West Virginia' },
  WI: { lat: 44.268543, lng: -89.616508, name: 'Wisconsin' },
  WY: { lat: 42.755966, lng: -107.302490, name: 'Wyoming' },

  // === Canadian Provinces & Territories ===
  ON: { lat: 51.253775, lng: -85.323214, name: 'Ontario', country: 'CA' },
  QC: { lat: 52.939916, lng: -73.549136, name: 'Québec', country: 'CA' },
  BC: { lat: 53.726669, lng: -127.647621, name: 'British Columbia', country: 'CA' },
  AB: { lat: 53.933271, lng: -116.576503, name: 'Alberta', country: 'CA' },
  MB: { lat: 53.760861, lng: -98.813876, name: 'Manitoba', country: 'CA' },
  SK: { lat: 52.939916, lng: -106.450864, name: 'Saskatchewan', country: 'CA' },
  NS: { lat: 44.681987, lng: -63.744311, name: 'Nova Scotia', country: 'CA' },
  NB: { lat: 46.565315, lng: -66.461914, name: 'New Brunswick', country: 'CA' },
  NL: { lat: 53.135509, lng: -57.660435, name: 'Newfoundland and Labrador', country: 'CA' },
  PE: { lat: 46.510712, lng: -63.416813, name: 'Prince Edward Island', country: 'CA' },
  NT: { lat: 64.825520, lng: -124.845703, name: 'Northwest Territories', country: 'CA' },
  YT: { lat: 64.282823, lng: -135.000000, name: 'Yukon', country: 'CA' },
  NU: { lat: 70.298691, lng: -83.107895, name: 'Nunavut', country: 'CA' },

  // === Mexican States ===
  CDMX: { lat: 19.432608, lng: -99.133209, name: 'Ciudad de México', country: 'MX' },
  JAL: { lat: 20.659698, lng: -103.349609, name: 'Jalisco', country: 'MX' },
  NLE: { lat: 25.592172, lng: -99.996063, name: 'Nuevo León', country: 'MX' },
  BCN: { lat: 30.840628, lng: -115.283768, name: 'Baja California', country: 'MX' },
  BCS: { lat: 26.044444, lng: -111.666389, name: 'Baja California Sur', country: 'MX' },
  SON: { lat: 29.072967, lng: -110.955919, name: 'Sonora', country: 'MX' },
  CHH: { lat: 28.632996, lng: -106.069099, name: 'Chihuahua', country: 'MX' },
  COA: { lat: 27.058676, lng: -101.706825, name: 'Coahuila', country: 'MX' },
  TAM: { lat: 24.266667, lng: -98.836111, name: 'Tamaulipas', country: 'MX' },
  SIN: { lat: 25.172339, lng: -107.479528, name: 'Sinaloa', country: 'MX' },
  DUR: { lat: 24.033333, lng: -104.666667, name: 'Durango', country: 'MX' },
  ZAC: { lat: 22.770833, lng: -102.583333, name: 'Zacatecas', country: 'MX' },
  SLP: { lat: 22.156469, lng: -100.985847, name: 'San Luis Potosí', country: 'MX' },
  AGS: { lat: 21.876403, lng: -102.295825, name: 'Aguascalientes', country: 'MX' },
  NAY: { lat: 21.751381, lng: -104.845467, name: 'Nayarit', country: 'MX' },
  COL: { lat: 19.245236, lng: -103.724657, name: 'Colima', country: 'MX' },
  MIC: { lat: 19.566667, lng: -101.706825, name: 'Michoacán', country: 'MX' },
  GUA: { lat: 21.019, lng: -101.257, name: 'Guanajuato', country: 'MX' },
  QUE: { lat: 20.588793, lng: -100.389885, name: 'Querétaro', country: 'MX' },
  HID: { lat: 20.091096, lng: -98.762559, name: 'Hidalgo', country: 'MX' },
  MEX: { lat: 19.494000, lng: -99.686000, name: 'Estado de México', country: 'MX' },
  MOR: { lat: 18.681300, lng: -99.101349, name: 'Morelos', country: 'MX' },
  TLA: { lat: 19.318154, lng: -98.237533, name: 'Tlaxcala', country: 'MX' },
  PUE: { lat: 19.041297, lng: -98.206199, name: 'Puebla', country: 'MX' },
  VER: { lat: 19.173773, lng: -96.134224, name: 'Veracruz', country: 'MX' },
  GRO: { lat: 17.439192, lng: -99.545097, name: 'Guerrero', country: 'MX' },
  OAX: { lat: 17.073182, lng: -96.726608, name: 'Oaxaca', country: 'MX' },
  CHP: { lat: 16.753500, lng: -93.115278, name: 'Chiapas', country: 'MX' },
  TAB: { lat: 17.840816, lng: -92.618830, name: 'Tabasco', country: 'MX' },
  CAM: { lat: 19.830095, lng: -90.534898, name: 'Campeche', country: 'MX' },
  YUC: { lat: 20.709871, lng: -89.094337, name: 'Yucatán', country: 'MX' },
  ROO: { lat: 19.181390, lng: -88.479143, name: 'Quintana Roo', country: 'MX' },
}

// Michigan is always loaded in detail, other states show aggregates until zoomed
export const HOME_STATE = 'MI'

// Zoom level at which to show individual markers for non-home states
export const STATE_DETAIL_ZOOM = 7

// Get centroid for a state
export function getStateCentroid(stateCode) {
  return STATE_CENTROIDS[stateCode] || null
}

// Check if a state code is valid
export function isValidState(stateCode) {
  return stateCode && STATE_CENTROIDS.hasOwnProperty(stateCode)
}
