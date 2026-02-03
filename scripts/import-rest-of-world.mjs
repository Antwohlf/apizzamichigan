#!/usr/bin/env node
/**
 * Import Rest of World - Europe (remaining) + Africa + Middle East + Asia-Pacific
 *
 * Usage:
 *   node scripts/import-rest-of-world.mjs --region europe
 *   node scripts/import-rest-of-world.mjs --region africa
 *   node scripts/import-rest-of-world.mjs --region middle-east
 *   node scripts/import-rest-of-world.mjs --region asia-pacific
 *   node scripts/import-rest-of-world.mjs --all
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROGRESS_FILE = join(__dirname, '.rest-of-world-progress.json')
const OSM_CACHE_FILE = join(__dirname, '.osm-id-cache.json')

// Supabase setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

// Rate limiting - increased to avoid 429 errors
const DELAY_BETWEEN_REQUESTS = 4000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Remaining European countries with bounding boxes (south,west,north,east)
const EUROPE_REMAINING = [
  { name: 'Russia (European)', code: 'RU', iso: 'RU', regions: [
    { name: 'Moscow', code: 'MOW', bbox: [55.4, 37.2, 56.0, 37.9] },
    { name: 'Saint Petersburg', code: 'SPE', bbox: [59.7, 29.9, 60.1, 30.6] },
    { name: 'Kazan', code: 'KAZ', bbox: [55.6, 48.8, 55.9, 49.3] },
    { name: 'Nizhny Novgorod', code: 'NIZ', bbox: [56.2, 43.8, 56.4, 44.1] },
    { name: 'Samara', code: 'SAM', bbox: [53.1, 50.0, 53.3, 50.3] },
    { name: 'Yekaterinburg', code: 'SVE', bbox: [56.7, 60.4, 57.0, 60.8] },
    { name: 'Novosibirsk', code: 'NVS', bbox: [54.9, 82.7, 55.1, 83.2] },
    { name: 'Krasnodar', code: 'KDA', bbox: [44.9, 38.8, 45.2, 39.2] },
    { name: 'Sochi', code: 'SOC', bbox: [43.4, 39.7, 43.7, 40.0] },
  ]},
  { name: 'Ukraine', code: 'UA', iso: 'UA', regions: [
    { name: 'Kyiv', code: 'KYI', bbox: [50.3, 30.2, 50.6, 30.8] },
    { name: 'Kharkiv', code: 'KHA', bbox: [49.9, 36.1, 50.1, 36.4] },
    { name: 'Odesa', code: 'ODE', bbox: [46.4, 30.6, 46.6, 30.9] },
    { name: 'Dnipro', code: 'DNI', bbox: [48.4, 34.9, 48.6, 35.2] },
    { name: 'Lviv', code: 'LVI', bbox: [49.8, 23.9, 50.0, 24.1] },
  ]},
  { name: 'Serbia', code: 'RS', iso: 'RS', regions: [
    { name: 'Belgrade', code: 'BEG', bbox: [44.7, 20.3, 44.9, 20.6] },
    { name: 'Novi Sad', code: 'NSD', bbox: [45.2, 19.8, 45.3, 19.9] },
  ]},
  { name: 'Slovenia', code: 'SI', iso: 'SI', small: true },
  { name: 'Bosnia and Herzegovina', code: 'BA', iso: 'BA', regions: [
    { name: 'Sarajevo', code: 'SAR', bbox: [43.8, 18.3, 43.9, 18.5] },
    { name: 'Banja Luka', code: 'BAN', bbox: [44.7, 17.1, 44.8, 17.3] },
  ]},
  { name: 'North Macedonia', code: 'MK', iso: 'MK', small: true },
  { name: 'Albania', code: 'AL', iso: 'AL', small: true },
  { name: 'Montenegro', code: 'ME', iso: 'ME', small: true },
  { name: 'Moldova', code: 'MD', iso: 'MD', regions: [
    { name: 'Chisinau', code: 'CHI', bbox: [46.9, 28.7, 47.1, 29.0] },
  ]},
  { name: 'Belarus', code: 'BY', iso: 'BY', regions: [
    { name: 'Minsk', code: 'MIN', bbox: [53.8, 27.4, 54.0, 27.7] },
  ]},
  { name: 'Cyprus', code: 'CY', iso: 'CY', small: true },
  { name: 'Malta', code: 'MT', iso: 'MT', small: true },
  { name: 'Iceland', code: 'IS', iso: 'IS', small: true },
  { name: 'Luxembourg', code: 'LU', iso: 'LU', small: true },
  { name: 'Kosovo', code: 'XK', iso: 'XK', regions: [
    { name: 'Pristina', code: 'PRI', bbox: [42.6, 21.1, 42.7, 21.2] },
  ]},
]

// African countries with bounding boxes (south,west,north,east)
const AFRICA = [
  { name: 'South Africa', code: 'ZA', iso: 'ZA', regions: [
    { name: 'Johannesburg', code: 'JNB', bbox: [-26.4, 27.8, -26.0, 28.2] },
    { name: 'Cape Town', code: 'CPT', bbox: [-34.2, 18.3, -33.8, 18.7] },
    { name: 'Durban', code: 'DUR', bbox: [-30.0, 30.8, -29.7, 31.1] },
    { name: 'Pretoria', code: 'PTA', bbox: [-25.9, 28.1, -25.6, 28.4] },
    { name: 'Port Elizabeth', code: 'PLZ', bbox: [-34.0, 25.5, -33.8, 25.8] },
  ]},
  { name: 'Egypt', code: 'EG', iso: 'EG', regions: [
    { name: 'Cairo', code: 'CAI', bbox: [29.9, 31.1, 30.2, 31.5] },
    { name: 'Alexandria', code: 'ALX', bbox: [31.1, 29.8, 31.3, 30.0] },
    { name: 'Giza', code: 'GIZ', bbox: [29.9, 30.9, 30.1, 31.3] },
  ]},
  { name: 'Morocco', code: 'MA', iso: 'MA', regions: [
    { name: 'Casablanca', code: 'CAS', bbox: [33.5, -7.7, 33.7, -7.4] },
    { name: 'Rabat', code: 'RAB', bbox: [33.9, -6.9, 34.1, -6.7] },
    { name: 'Marrakech', code: 'MRK', bbox: [31.5, -8.1, 31.7, -7.9] },
    { name: 'Tangier', code: 'TNG', bbox: [35.7, -5.9, 35.8, -5.7] },
  ]},
  { name: 'Tunisia', code: 'TN', iso: 'TN', regions: [
    { name: 'Tunis', code: 'TUN', bbox: [36.7, 10.1, 36.9, 10.3] },
  ]},
  { name: 'Algeria', code: 'DZ', iso: 'DZ', regions: [
    { name: 'Algiers', code: 'ALG', bbox: [36.7, 2.9, 36.8, 3.2] },
    { name: 'Oran', code: 'ORA', bbox: [35.6, -0.7, 35.8, -0.5] },
  ]},
  { name: 'Nigeria', code: 'NG', iso: 'NG', regions: [
    { name: 'Lagos', code: 'LAG', bbox: [6.4, 3.2, 6.7, 3.6] },
    { name: 'Abuja', code: 'ABU', bbox: [8.9, 7.3, 9.2, 7.6] },
  ]},
  { name: 'Kenya', code: 'KE', iso: 'KE', regions: [
    { name: 'Nairobi', code: 'NAI', bbox: [-1.4, 36.7, -1.2, 37.0] },
    { name: 'Mombasa', code: 'MOM', bbox: [-4.1, 39.6, -4.0, 39.7] },
  ]},
  { name: 'Ghana', code: 'GH', iso: 'GH', regions: [
    { name: 'Accra', code: 'ACC', bbox: [5.5, -0.3, 5.7, 0.0] },
  ]},
  { name: 'Tanzania', code: 'TZ', iso: 'TZ', regions: [
    { name: 'Dar es Salaam', code: 'DAR', bbox: [-6.9, 39.1, -6.7, 39.4] },
  ]},
  { name: 'Ethiopia', code: 'ET', iso: 'ET', regions: [
    { name: 'Addis Ababa', code: 'ADD', bbox: [8.9, 38.6, 9.1, 38.9] },
  ]},
  { name: 'Senegal', code: 'SN', iso: 'SN', regions: [
    { name: 'Dakar', code: 'DAK', bbox: [14.6, -17.5, 14.8, -17.3] },
  ]},
  { name: 'Ivory Coast', code: 'CI', iso: 'CI', regions: [
    { name: 'Abidjan', code: 'ABI', bbox: [5.2, -4.1, 5.4, -3.9] },
  ]},
  { name: 'Uganda', code: 'UG', iso: 'UG', regions: [
    { name: 'Kampala', code: 'KAM', bbox: [0.2, 32.5, 0.4, 32.7] },
  ]},
  { name: 'Rwanda', code: 'RW', iso: 'RW', small: true },
  { name: 'Mauritius', code: 'MU', iso: 'MU', small: true },
  // Additional African countries
  { name: 'Zimbabwe', code: 'ZW', iso: 'ZW', regions: [
    { name: 'Harare', code: 'HAR', bbox: [-17.9, 31.0, -17.7, 31.2] },
    { name: 'Bulawayo', code: 'BUL', bbox: [-20.2, 28.5, -20.1, 28.6] },
  ]},
  { name: 'Zambia', code: 'ZM', iso: 'ZM', regions: [
    { name: 'Lusaka', code: 'LUS', bbox: [-15.5, 28.2, -15.3, 28.4] },
  ]},
  { name: 'Botswana', code: 'BW', iso: 'BW', regions: [
    { name: 'Gaborone', code: 'GAB', bbox: [-24.7, 25.8, -24.6, 26.0] },
  ]},
  { name: 'Namibia', code: 'NA', iso: 'NA', regions: [
    { name: 'Windhoek', code: 'WIN', bbox: [-22.6, 17.0, -22.5, 17.1] },
  ]},
  { name: 'Mozambique', code: 'MZ', iso: 'MZ', regions: [
    { name: 'Maputo', code: 'MPM', bbox: [-26.0, 32.5, -25.9, 32.6] },
  ]},
  { name: 'Angola', code: 'AO', iso: 'AO', regions: [
    { name: 'Luanda', code: 'LUA', bbox: [-8.9, 13.1, -8.8, 13.3] },
  ]},
  { name: 'Cameroon', code: 'CM', iso: 'CM', regions: [
    { name: 'Douala', code: 'DLA', bbox: [4.0, 9.6, 4.1, 9.8] },
    { name: 'Yaounde', code: 'YAO', bbox: [3.8, 11.4, 3.9, 11.6] },
  ]},
  { name: 'DR Congo', code: 'CD', iso: 'CD', regions: [
    { name: 'Kinshasa', code: 'KIN', bbox: [-4.4, 15.2, -4.3, 15.4] },
  ]},
  { name: 'Libya', code: 'LY', iso: 'LY', regions: [
    { name: 'Tripoli', code: 'TRI', bbox: [32.8, 13.1, 32.9, 13.2] },
  ]},
  { name: 'Sudan', code: 'SD', iso: 'SD', regions: [
    { name: 'Khartoum', code: 'KRT', bbox: [15.5, 32.5, 15.6, 32.6] },
  ]},
  { name: 'Mali', code: 'ML', iso: 'ML', regions: [
    { name: 'Bamako', code: 'BAM', bbox: [12.6, -8.0, 12.7, -7.9] },
  ]},
  { name: 'Burkina Faso', code: 'BF', iso: 'BF', regions: [
    { name: 'Ouagadougou', code: 'OUA', bbox: [12.3, -1.6, 12.4, -1.5] },
  ]},
  { name: 'Niger', code: 'NE', iso: 'NE', regions: [
    { name: 'Niamey', code: 'NIA', bbox: [13.5, 2.0, 13.6, 2.2] },
  ]},
  { name: 'Chad', code: 'TD', iso: 'TD', regions: [
    { name: 'NDjamena', code: 'NDJ', bbox: [12.1, 15.0, 12.2, 15.1] },
  ]},
  { name: 'Madagascar', code: 'MG', iso: 'MG', regions: [
    { name: 'Antananarivo', code: 'ANT', bbox: [-18.9, 47.5, -18.8, 47.6] },
  ]},
  { name: 'Malawi', code: 'MW', iso: 'MW', regions: [
    { name: 'Lilongwe', code: 'LIL', bbox: [-13.98, 33.7, -13.9, 33.8] },
  ]},
  { name: 'Benin', code: 'BJ', iso: 'BJ', regions: [
    { name: 'Cotonou', code: 'COT', bbox: [6.3, 2.4, 6.4, 2.5] },
  ]},
  { name: 'Togo', code: 'TG', iso: 'TG', small: true },
  { name: 'Gabon', code: 'GA', iso: 'GA', regions: [
    { name: 'Libreville', code: 'LBV', bbox: [0.3, 9.4, 0.5, 9.5] },
  ]},
  { name: 'Republic of Congo', code: 'CG', iso: 'CG', regions: [
    { name: 'Brazzaville', code: 'BRZ', bbox: [-4.3, 15.2, -4.2, 15.3] },
  ]},
  { name: 'Eswatini', code: 'SZ', iso: 'SZ', small: true },
  { name: 'Lesotho', code: 'LS', iso: 'LS', small: true },
  { name: 'Djibouti', code: 'DJ', iso: 'DJ', small: true },
  { name: 'Cabo Verde', code: 'CV', iso: 'CV', small: true },
  { name: 'Seychelles', code: 'SC', iso: 'SC', small: true },
  { name: 'Sao Tome and Principe', code: 'ST', iso: 'ST', small: true },
  { name: 'Comoros', code: 'KM', iso: 'KM', small: true },
  { name: 'Gambia', code: 'GM', iso: 'GM', small: true },
  { name: 'Guinea-Bissau', code: 'GW', iso: 'GW', small: true },
  { name: 'Equatorial Guinea', code: 'GQ', iso: 'GQ', small: true },
  { name: 'Eritrea', code: 'ER', iso: 'ER', regions: [
    { name: 'Asmara', code: 'ASM', bbox: [15.3, 38.9, 15.4, 39.0] },
  ]},
  { name: 'Sierra Leone', code: 'SL', iso: 'SL', regions: [
    { name: 'Freetown', code: 'FNA', bbox: [8.4, -13.3, 8.5, -13.2] },
  ]},
  { name: 'Liberia', code: 'LR', iso: 'LR', regions: [
    { name: 'Monrovia', code: 'MLW', bbox: [6.3, -10.8, 6.4, -10.7] },
  ]},
  { name: 'Guinea', code: 'GN', iso: 'GN', regions: [
    { name: 'Conakry', code: 'CKY', bbox: [9.5, -13.7, 9.6, -13.6] },
  ]},
  { name: 'Central African Republic', code: 'CF', iso: 'CF', regions: [
    { name: 'Bangui', code: 'BGF', bbox: [4.3, 18.5, 4.4, 18.6] },
  ]},
  { name: 'South Sudan', code: 'SS', iso: 'SS', regions: [
    { name: 'Juba', code: 'JUB', bbox: [4.8, 31.5, 4.9, 31.6] },
  ]},
  { name: 'Burundi', code: 'BI', iso: 'BI', small: true },
  { name: 'Somalia', code: 'SO', iso: 'SO', regions: [
    { name: 'Mogadishu', code: 'MGQ', bbox: [2.0, 45.3, 2.1, 45.4] },
  ]},
]

// Middle East (with bboxes)
const MIDDLE_EAST = [
  { name: 'United Arab Emirates', code: 'AE', iso: 'AE', regions: [
    { name: 'Dubai', code: 'DXB', bbox: [25.0, 55.1, 25.3, 55.4] },
    { name: 'Abu Dhabi', code: 'AUH', bbox: [24.4, 54.3, 24.5, 54.5] },
    { name: 'Sharjah', code: 'SHJ', bbox: [25.3, 55.3, 25.4, 55.5] },
  ]},
  { name: 'Israel', code: 'IL', iso: 'IL', regions: [
    { name: 'Tel Aviv', code: 'TLV', bbox: [32.0, 34.7, 32.1, 34.9] },
    { name: 'Jerusalem', code: 'JRS', bbox: [31.7, 35.1, 31.8, 35.3] },
    { name: 'Haifa', code: 'HFA', bbox: [32.7, 34.9, 32.9, 35.1] },
  ]},
  { name: 'Turkey', code: 'TR', iso: 'TR', regions: [
    { name: 'Istanbul', code: 'IST', bbox: [40.9, 28.8, 41.2, 29.2] },
    { name: 'Ankara', code: 'ANK', bbox: [39.8, 32.7, 40.0, 33.0] },
    { name: 'Izmir', code: 'IZM', bbox: [38.3, 27.0, 38.5, 27.2] },
    { name: 'Antalya', code: 'ANT', bbox: [36.8, 30.6, 37.0, 30.8] },
    { name: 'Bursa', code: 'BUR', bbox: [40.1, 28.9, 40.3, 29.1] },
  ]},
  { name: 'Saudi Arabia', code: 'SA', iso: 'SA', regions: [
    { name: 'Riyadh', code: 'RIY', bbox: [24.5, 46.5, 24.8, 46.9] },
    { name: 'Jeddah', code: 'JED', bbox: [21.4, 39.1, 21.6, 39.3] },
    { name: 'Dammam', code: 'DAM', bbox: [26.3, 50.0, 26.5, 50.2] },
    { name: 'Mecca', code: 'MEC', bbox: [21.4, 39.7, 21.5, 39.9] },
  ]},
  { name: 'Qatar', code: 'QA', iso: 'QA', small: true },
  { name: 'Kuwait', code: 'KW', iso: 'KW', regions: [
    { name: 'Kuwait City', code: 'KWC', bbox: [29.3, 47.9, 29.4, 48.1] },
  ]},
  { name: 'Bahrain', code: 'BH', iso: 'BH', small: true },
  { name: 'Oman', code: 'OM', iso: 'OM', regions: [
    { name: 'Muscat', code: 'MUS', bbox: [23.5, 58.3, 23.7, 58.6] },
  ]},
  { name: 'Jordan', code: 'JO', iso: 'JO', regions: [
    { name: 'Amman', code: 'AMM', bbox: [31.9, 35.8, 32.0, 36.0] },
  ]},
  { name: 'Lebanon', code: 'LB', iso: 'LB', small: true },
  // Additional Middle East countries
  { name: 'Iran', code: 'IR', iso: 'IR', regions: [
    { name: 'Tehran', code: 'THR', bbox: [35.6, 51.3, 35.8, 51.5] },
    { name: 'Isfahan', code: 'IFN', bbox: [32.6, 51.6, 32.7, 51.7] },
    { name: 'Shiraz', code: 'SYZ', bbox: [29.5, 52.5, 29.7, 52.6] },
    { name: 'Mashhad', code: 'MHD', bbox: [36.2, 59.5, 36.4, 59.7] },
  ]},
  { name: 'Iraq', code: 'IQ', iso: 'IQ', regions: [
    { name: 'Baghdad', code: 'BGW', bbox: [33.2, 44.3, 33.4, 44.5] },
    { name: 'Erbil', code: 'EBL', bbox: [36.1, 44.0, 36.2, 44.1] },
    { name: 'Basra', code: 'BSR', bbox: [30.5, 47.8, 30.6, 47.9] },
  ]},
  { name: 'Yemen', code: 'YE', iso: 'YE', regions: [
    { name: 'Sanaa', code: 'SAH', bbox: [15.3, 44.1, 15.4, 44.3] },
    { name: 'Aden', code: 'ADE', bbox: [12.7, 45.0, 12.8, 45.1] },
  ]},
  { name: 'Syria', code: 'SY', iso: 'SY', regions: [
    { name: 'Damascus', code: 'DAM', bbox: [33.4, 36.2, 33.6, 36.4] },
  ]},
  { name: 'Palestine', code: 'PS', iso: 'PS', regions: [
    { name: 'Gaza', code: 'GZA', bbox: [31.4, 34.4, 31.6, 34.5] },
    { name: 'Ramallah', code: 'RAM', bbox: [31.9, 35.2, 32.0, 35.3] },
  ]},
  { name: 'Georgia', code: 'GE', iso: 'GE', regions: [
    { name: 'Tbilisi', code: 'TBS', bbox: [41.6, 44.7, 41.8, 44.9] },
  ]},
  { name: 'Armenia', code: 'AM', iso: 'AM', regions: [
    { name: 'Yerevan', code: 'EVN', bbox: [40.1, 44.4, 40.2, 44.6] },
  ]},
  { name: 'Azerbaijan', code: 'AZ', iso: 'AZ', regions: [
    { name: 'Baku', code: 'BAK', bbox: [40.3, 49.8, 40.5, 50.0] },
  ]},
]

// Asia-Pacific (with bboxes - south, west, north, east)
const ASIA_PACIFIC = [
  { name: 'Australia', code: 'AU', iso: 'AU', regions: [
    { name: 'Sydney', code: 'SYD', bbox: [-34.0, 150.8, -33.7, 151.3] },
    { name: 'Melbourne', code: 'MEL', bbox: [-38.0, 144.8, -37.6, 145.2] },
    { name: 'Brisbane', code: 'BNE', bbox: [-27.6, 152.9, -27.3, 153.2] },
    { name: 'Perth', code: 'PER', bbox: [-32.1, 115.7, -31.8, 116.0] },
    { name: 'Adelaide', code: 'ADL', bbox: [-35.0, 138.5, -34.8, 138.7] },
    { name: 'Gold Coast', code: 'GLD', bbox: [-28.2, 153.3, -27.9, 153.5] },
    { name: 'Canberra', code: 'CBR', bbox: [-35.4, 149.0, -35.2, 149.2] },
    { name: 'Hobart', code: 'HBA', bbox: [-43.0, 147.2, -42.8, 147.4] },
    { name: 'Darwin', code: 'DRW', bbox: [-12.5, 130.8, -12.3, 131.0] },
  ]},
  { name: 'New Zealand', code: 'NZ', iso: 'NZ', regions: [
    { name: 'Auckland', code: 'AUK', bbox: [-37.0, 174.6, -36.7, 175.0] },
    { name: 'Wellington', code: 'WLG', bbox: [-41.4, 174.7, -41.2, 174.9] },
    { name: 'Christchurch', code: 'CHC', bbox: [-43.6, 172.5, -43.4, 172.8] },
  ]},
  { name: 'Japan', code: 'JP', iso: 'JP', regions: [
    { name: 'Tokyo', code: 'TKY', bbox: [35.5, 139.5, 35.8, 139.9] },
    { name: 'Osaka', code: 'OSA', bbox: [34.6, 135.4, 34.8, 135.6] },
    { name: 'Yokohama', code: 'YKH', bbox: [35.3, 139.5, 35.5, 139.7] },
    { name: 'Nagoya', code: 'NGY', bbox: [35.0, 136.8, 35.3, 137.0] },
    { name: 'Fukuoka', code: 'FKO', bbox: [33.5, 130.3, 33.7, 130.5] },
    { name: 'Sapporo', code: 'SPK', bbox: [43.0, 141.2, 43.2, 141.5] },
    { name: 'Kyoto', code: 'KYT', bbox: [34.9, 135.7, 35.1, 135.8] },
    { name: 'Kobe', code: 'KOB', bbox: [34.6, 135.1, 34.8, 135.3] },
  ]},
  { name: 'South Korea', code: 'KR', iso: 'KR', regions: [
    { name: 'Seoul', code: 'SEO', bbox: [37.4, 126.8, 37.7, 127.2] },
    { name: 'Busan', code: 'BUS', bbox: [35.0, 128.9, 35.2, 129.2] },
    { name: 'Incheon', code: 'INC', bbox: [37.4, 126.5, 37.6, 126.8] },
    { name: 'Daegu', code: 'DAE', bbox: [35.8, 128.5, 36.0, 128.7] },
    { name: 'Daejeon', code: 'DJN', bbox: [36.2, 127.3, 36.4, 127.5] },
  ]},
  { name: 'China', code: 'CN', iso: 'CN', regions: [
    { name: 'Beijing', code: 'BJS', bbox: [39.7, 116.2, 40.0, 116.6] },
    { name: 'Shanghai', code: 'SHA', bbox: [31.0, 121.3, 31.4, 121.6] },
    { name: 'Guangzhou', code: 'CAN', bbox: [22.9, 113.2, 23.2, 113.5] },
    { name: 'Shenzhen', code: 'SZX', bbox: [22.4, 113.9, 22.7, 114.2] },
    { name: 'Chengdu', code: 'CTU', bbox: [30.5, 103.9, 30.8, 104.2] },
    { name: 'Hangzhou', code: 'HGH', bbox: [30.1, 120.0, 30.4, 120.3] },
    { name: 'Wuhan', code: 'WUH', bbox: [30.4, 114.2, 30.7, 114.5] },
    { name: 'Xian', code: 'XIY', bbox: [34.1, 108.8, 34.4, 109.1] },
    { name: 'Nanjing', code: 'NKG', bbox: [31.9, 118.6, 32.2, 119.0] },
    { name: 'Chongqing', code: 'CKG', bbox: [29.4, 106.4, 29.7, 106.7] },
  ]},
  { name: 'Philippines', code: 'PH', iso: 'PH', regions: [
    { name: 'Manila', code: 'MNL', bbox: [14.5, 120.9, 14.7, 121.1] },
    { name: 'Cebu', code: 'CEB', bbox: [10.2, 123.8, 10.4, 124.0] },
    { name: 'Davao', code: 'DAV', bbox: [7.0, 125.5, 7.2, 125.7] },
  ]},
  { name: 'Singapore', code: 'SG', iso: 'SG', small: true },
  { name: 'Thailand', code: 'TH', iso: 'TH', regions: [
    { name: 'Bangkok', code: 'BKK', bbox: [13.6, 100.4, 13.9, 100.7] },
    { name: 'Chiang Mai', code: 'CNX', bbox: [18.7, 98.9, 18.9, 99.1] },
    { name: 'Phuket', code: 'HKT', bbox: [7.8, 98.3, 8.0, 98.5] },
    { name: 'Pattaya', code: 'PTY', bbox: [12.9, 100.8, 13.0, 101.0] },
  ]},
  { name: 'Malaysia', code: 'MY', iso: 'MY', regions: [
    { name: 'Kuala Lumpur', code: 'KUL', bbox: [3.0, 101.6, 3.2, 101.8] },
    { name: 'Penang', code: 'PEN', bbox: [5.3, 100.2, 5.5, 100.4] },
    { name: 'Johor Bahru', code: 'JHB', bbox: [1.4, 103.6, 1.6, 103.9] },
  ]},
  { name: 'Indonesia', code: 'ID', iso: 'ID', regions: [
    { name: 'Jakarta', code: 'JKT', bbox: [-6.3, 106.7, -6.1, 107.0] },
    { name: 'Bali', code: 'BAL', bbox: [-8.8, 115.0, -8.4, 115.4] },
    { name: 'Surabaya', code: 'SUB', bbox: [-7.4, 112.6, -7.2, 112.9] },
    { name: 'Bandung', code: 'BDO', bbox: [-7.0, 107.5, -6.8, 107.7] },
    { name: 'Yogyakarta', code: 'JOG', bbox: [-7.9, 110.3, -7.7, 110.5] },
  ]},
  { name: 'Vietnam', code: 'VN', iso: 'VN', regions: [
    { name: 'Ho Chi Minh City', code: 'SGN', bbox: [10.7, 106.6, 10.9, 106.8] },
    { name: 'Hanoi', code: 'HAN', bbox: [20.9, 105.7, 21.1, 106.0] },
    { name: 'Da Nang', code: 'DAD', bbox: [16.0, 108.1, 16.1, 108.3] },
  ]},
  { name: 'India', code: 'IN', iso: 'IN', regions: [
    { name: 'Mumbai', code: 'BOM', bbox: [18.9, 72.7, 19.2, 73.0] },
    { name: 'Delhi', code: 'DEL', bbox: [28.5, 77.0, 28.8, 77.4] },
    { name: 'Bangalore', code: 'BLR', bbox: [12.9, 77.5, 13.1, 77.7] },
    { name: 'Chennai', code: 'MAA', bbox: [12.9, 80.1, 13.2, 80.4] },
    { name: 'Hyderabad', code: 'HYD', bbox: [17.3, 78.3, 17.5, 78.6] },
    { name: 'Kolkata', code: 'CCU', bbox: [22.4, 88.2, 22.7, 88.5] },
    { name: 'Pune', code: 'PNQ', bbox: [18.4, 73.7, 18.6, 74.0] },
    { name: 'Ahmedabad', code: 'AMD', bbox: [22.9, 72.5, 23.1, 72.7] },
    { name: 'Goa', code: 'GOI', bbox: [15.4, 73.7, 15.6, 74.0] },
  ]},
  { name: 'Hong Kong', code: 'HK', iso: 'HK', small: true },
  { name: 'Taiwan', code: 'TW', iso: 'TW', regions: [
    { name: 'Taipei', code: 'TPE', bbox: [25.0, 121.4, 25.1, 121.6] },
    { name: 'Kaohsiung', code: 'KHH', bbox: [22.5, 120.2, 22.7, 120.4] },
    { name: 'Taichung', code: 'TXG', bbox: [24.1, 120.6, 24.2, 120.7] },
  ]},
  { name: 'Macao', code: 'MO', iso: 'MO', small: true },
  // Additional Asia-Pacific countries
  { name: 'Pakistan', code: 'PK', iso: 'PK', regions: [
    { name: 'Karachi', code: 'KHI', bbox: [24.8, 66.9, 25.0, 67.2] },
    { name: 'Lahore', code: 'LHE', bbox: [31.4, 74.2, 31.6, 74.5] },
    { name: 'Islamabad', code: 'ISB', bbox: [33.6, 73.0, 33.8, 73.2] },
  ]},
  { name: 'Bangladesh', code: 'BD', iso: 'BD', regions: [
    { name: 'Dhaka', code: 'DAC', bbox: [23.7, 90.3, 23.9, 90.5] },
    { name: 'Chittagong', code: 'CGP', bbox: [22.3, 91.7, 22.4, 91.9] },
  ]},
  { name: 'Sri Lanka', code: 'LK', iso: 'LK', regions: [
    { name: 'Colombo', code: 'CMB', bbox: [6.8, 79.8, 7.0, 80.0] },
  ]},
  { name: 'Nepal', code: 'NP', iso: 'NP', regions: [
    { name: 'Kathmandu', code: 'KTM', bbox: [27.6, 85.2, 27.8, 85.4] },
  ]},
  { name: 'Myanmar', code: 'MM', iso: 'MM', regions: [
    { name: 'Yangon', code: 'RGN', bbox: [16.7, 96.0, 16.9, 96.3] },
  ]},
  { name: 'Cambodia', code: 'KH', iso: 'KH', regions: [
    { name: 'Phnom Penh', code: 'PNH', bbox: [11.5, 104.8, 11.6, 105.0] },
    { name: 'Siem Reap', code: 'REP', bbox: [13.3, 103.8, 13.4, 103.9] },
  ]},
  { name: 'Laos', code: 'LA', iso: 'LA', regions: [
    { name: 'Vientiane', code: 'VTE', bbox: [17.9, 102.5, 18.0, 102.7] },
  ]},
  { name: 'Mongolia', code: 'MN', iso: 'MN', regions: [
    { name: 'Ulaanbaatar', code: 'ULN', bbox: [47.8, 106.8, 48.0, 107.1] },
  ]},
  { name: 'North Korea', code: 'KP', iso: 'KP', regions: [
    { name: 'Pyongyang', code: 'FNJ', bbox: [38.9, 125.6, 39.1, 125.9] },
  ]},
  { name: 'Brunei', code: 'BN', iso: 'BN', small: true },
  { name: 'East Timor', code: 'TL', iso: 'TL', small: true },
  { name: 'Papua New Guinea', code: 'PG', iso: 'PG', regions: [
    { name: 'Port Moresby', code: 'POM', bbox: [-9.5, 147.1, -9.4, 147.3] },
  ]},
  { name: 'Fiji', code: 'FJ', iso: 'FJ', regions: [
    { name: 'Suva', code: 'SUV', bbox: [-18.2, 178.3, -18.1, 178.5] },
  ]},
  { name: 'Samoa', code: 'WS', iso: 'WS', small: true },
  { name: 'Tonga', code: 'TO', iso: 'TO', small: true },
  { name: 'Vanuatu', code: 'VU', iso: 'VU', small: true },
  { name: 'Solomon Islands', code: 'SB', iso: 'SB', small: true },
  { name: 'New Caledonia', code: 'NC', iso: 'NC', small: true },
  { name: 'French Polynesia', code: 'PF', iso: 'PF', small: true },
  { name: 'Guam', code: 'GU', iso: 'GU', small: true },
  { name: 'Palau', code: 'PW', iso: 'PW', small: true },
  { name: 'Marshall Islands', code: 'MH', iso: 'MH', small: true },
  { name: 'Micronesia', code: 'FM', iso: 'FM', small: true },
  { name: 'Maldives', code: 'MV', iso: 'MV', small: true },
  { name: 'Bhutan', code: 'BT', iso: 'BT', small: true },
  { name: 'Kazakhstan', code: 'KZ', iso: 'KZ', regions: [
    { name: 'Almaty', code: 'ALA', bbox: [43.2, 76.8, 43.4, 77.1] },
    { name: 'Astana', code: 'NQZ', bbox: [51.1, 71.3, 51.2, 71.6] },
  ]},
  { name: 'Uzbekistan', code: 'UZ', iso: 'UZ', regions: [
    { name: 'Tashkent', code: 'TAS', bbox: [41.2, 69.1, 41.4, 69.4] },
  ]},
  { name: 'Turkmenistan', code: 'TM', iso: 'TM', regions: [
    { name: 'Ashgabat', code: 'ASB', bbox: [37.9, 58.3, 38.0, 58.5] },
  ]},
  { name: 'Tajikistan', code: 'TJ', iso: 'TJ', regions: [
    { name: 'Dushanbe', code: 'DYU', bbox: [38.5, 68.7, 38.6, 68.9] },
  ]},
  { name: 'Kyrgyzstan', code: 'KG', iso: 'KG', regions: [
    { name: 'Bishkek', code: 'FRU', bbox: [42.8, 74.5, 42.9, 74.7] },
  ]},
  { name: 'Afghanistan', code: 'AF', iso: 'AF', regions: [
    { name: 'Kabul', code: 'KBL', bbox: [34.5, 69.1, 34.6, 69.3] },
  ]},
]

const REGIONS = {
  'europe': EUROPE_REMAINING,
  'africa': AFRICA,
  'middle-east': MIDDLE_EAST,
  'asia-pacific': ASIA_PACIFIC,
}

/**
 * Build Overpass query for a bounding box
 */
function buildBboxQuery(bbox, type) {
  // Include "italian" for pizza since many places use that instead of "pizza"
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'
  const [south, west, north, east] = bbox

  return `
[out:json][timeout:60];
(
  node["amenity"~"restaurant|fast_food"][${cuisine}](${south},${west},${north},${east});
  way["amenity"~"restaurant|fast_food"][${cuisine}](${south},${west},${north},${east});
);
out center tags;
`.trim()
}

/**
 * Build Overpass query for entire small country
 */
function buildSmallCountryQuery(countryCode, type) {
  const cuisine = type === 'pizza' ? 'cuisine~"pizza|italian|pizzeria"' : 'cuisine~"mexican|taco|tex-mex"'

  return `
[out:json][timeout:90];
area["ISO3166-1"="${countryCode}"]->.country;
(
  node["amenity"~"restaurant|fast_food"][${cuisine}](area.country);
  way["amenity"~"restaurant|fast_food"][${cuisine}](area.country);
);
out center tags;
`.trim()
}

// Small countries are now marked with `small: true` in the country definition

/**
 * Query Overpass API
 */
async function queryOverpass(query) {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  })

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Transform OSM element to place record
 */
function transformToPlace(element, stateCode, countryCode, type) {
  const tags = element.tags || {}
  const lat = element.lat || element.center?.lat
  const lon = element.lon || element.center?.lon

  if (!lat || !lon || !tags.name) return null

  return {
    google_place_id: `osm:${element.type}/${element.id}`,
    name: tags.name,
    lat,
    lng: lon,
    state: stateCode,
    address: formatAddress(tags),
    status: 'unvisited',
  }
}

/**
 * Format address from OSM tags
 */
function formatAddress(tags) {
  const parts = []
  if (tags['addr:housenumber']) parts.push(tags['addr:housenumber'])
  if (tags['addr:street']) parts.push(tags['addr:street'])
  if (tags['addr:city']) parts.push(tags['addr:city'])
  if (tags['addr:postcode']) parts.push(tags['addr:postcode'])
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Load progress file
 */
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  }
  return { completed: {}, failed: {} }
}

/**
 * Save progress file
 */
function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

/**
 * Load OSM ID cache
 */
function loadOsmCache() {
  if (existsSync(OSM_CACHE_FILE)) {
    return JSON.parse(readFileSync(OSM_CACHE_FILE, 'utf-8'))
  }
  return { pizza: [], tacos: [] }
}

/**
 * Save OSM ID cache
 */
function saveOsmCache(cache) {
  writeFileSync(OSM_CACHE_FILE, JSON.stringify(cache, null, 2))
}

/**
 * Import a single country (by regions/cities)
 */
async function importCountry(country, progress, osmCache) {
  console.log(`\n=== ${country.name} (${country.code}) ===`)

  for (const type of ['pizza', 'tacos']) {
    let totalPlaces = 0
    let allPlaces = []

    // Check if small country - query entire country at once
    if (country.small) {
      const key = `${country.code}-${type}`

      if (progress.completed[key]) {
        console.log(`  ${type}: Already completed (${progress.completed[key].count} places)`)
        continue
      }

      try {
        console.log(`  ${type}: Querying entire country...`)
        const query = buildSmallCountryQuery(country.iso, type === 'pizza' ? 'pizza' : 'taco')
        const data = await queryOverpass(query)

        allPlaces = data.elements
          .map(el => transformToPlace(el, country.code, country.iso, type))
          .filter(Boolean)

        totalPlaces = allPlaces.length
        await sleep(DELAY_BETWEEN_REQUESTS)
      } catch (error) {
        console.error(`  ${type}: Country query failed - ${error.message}`)
        progress.failed[key] = {
          country: country.name,
          code: country.code,
          type,
          error: error.message,
          timestamp: new Date().toISOString()
        }
        saveProgress(progress)
        continue
      }
    } else {
      // Query by region/city using bounding boxes
      for (const region of country.regions || []) {
        if (!region.bbox) {
          console.log(`  Skipping ${region.name} - no bbox defined`)
          continue
        }

        const key = `${country.code}-${region.code}-${type}`

        if (progress.completed[key]) {
          totalPlaces += progress.completed[key].count || 0
          continue
        }

        try {
          console.log(`  ${type}: Querying ${region.name}...`)
          const query = buildBboxQuery(region.bbox, type === 'pizza' ? 'pizza' : 'taco')
          const data = await queryOverpass(query)

          const places = data.elements
            .map(el => transformToPlace(el, region.code, country.iso, type))
            .filter(Boolean)

          console.log(`    Found ${places.length} places`)
          allPlaces.push(...places)
          totalPlaces += places.length

          progress.completed[key] = {
            country: country.name,
            region: region.name,
            code: region.code,
            type,
            count: places.length,
            timestamp: new Date().toISOString()
          }
          saveProgress(progress)

          await sleep(DELAY_BETWEEN_REQUESTS)
        } catch (error) {
          console.error(`    ${region.name}: Error - ${error.message}`)
          progress.failed[key] = {
            country: country.name,
            region: region.name,
            code: region.code,
            type,
            error: error.message,
            timestamp: new Date().toISOString()
          }
          saveProgress(progress)
        }
      }
    }

    // Save all places to Supabase
    if (allPlaces.length > 0) {
      try {
        // Deduplicate by google_place_id
        const seen = new Set()
        const uniquePlaces = allPlaces.filter(p => {
          if (seen.has(p.google_place_id)) return false
          seen.add(p.google_place_id)
          return true
        })

        const table = type === 'pizza' ? 'pizza_places' : 'taco_places'
        const { error } = await supabase
          .from(table)
          .upsert(uniquePlaces, { onConflict: 'google_place_id' })

        if (error) throw error

        // Update OSM cache
        const cacheKey = type === 'pizza' ? 'pizza' : 'tacos'
        const newIds = uniquePlaces.map(p => p.google_place_id)
        if (!osmCache[cacheKey]) osmCache[cacheKey] = []
        osmCache[cacheKey] = [...new Set([...osmCache[cacheKey], ...newIds])]
        saveOsmCache(osmCache)

        console.log(`  ${type}: Saved ${uniquePlaces.length} unique places to Supabase`)

        // Mark country as complete for small countries
        if (country.small) {
          const key = `${country.code}-${type}`
          progress.completed[key] = {
            country: country.name,
            code: country.code,
            type,
            count: uniquePlaces.length,
            timestamp: new Date().toISOString()
          }
          saveProgress(progress)
        }
      } catch (error) {
        console.error(`  ${type}: Failed to save to Supabase - ${error.message}`)
      }
    } else {
      console.log(`  ${type}: No places found`)
    }
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const regionArg = args.includes('--region') ? args[args.indexOf('--region') + 1] : null
  const all = args.includes('--all')

  if (!regionArg && !all) {
    console.log(`
Usage:
  node scripts/import-rest-of-world.mjs --region europe
  node scripts/import-rest-of-world.mjs --region africa
  node scripts/import-rest-of-world.mjs --region middle-east
  node scripts/import-rest-of-world.mjs --region asia-pacific
  node scripts/import-rest-of-world.mjs --all

Available regions: ${Object.keys(REGIONS).join(', ')}
`)
    return
  }

  const regionsToProcess = all ? Object.keys(REGIONS) : [regionArg]

  console.log('=== Rest of World Import ===')
  console.log(`Regions: ${regionsToProcess.join(', ')}`)
  console.log()

  const progress = loadProgress()
  const osmCache = loadOsmCache()

  for (const regionName of regionsToProcess) {
    const countries = REGIONS[regionName]
    if (!countries) {
      console.error(`Unknown region: ${regionName}`)
      continue
    }

    console.log(`\n>>> Processing ${regionName.toUpperCase()} (${countries.length} countries) <<<`)

    for (const country of countries) {
      await importCountry(country, progress, osmCache)
    }
  }

  // Summary
  const completed = Object.keys(progress.completed).length
  const failed = Object.keys(progress.failed).length
  let totalPlaces = 0
  for (const key of Object.keys(progress.completed)) {
    totalPlaces += progress.completed[key].count || 0
  }

  console.log('\n=== Import Complete ===')
  console.log(`Completed: ${completed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total places: ${totalPlaces.toLocaleString()}`)
}

main().catch(console.error)
