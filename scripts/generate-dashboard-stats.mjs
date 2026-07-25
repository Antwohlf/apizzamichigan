#!/usr/bin/env node
/**
 * Generate Static Dashboard Stats
 *
 * Fetches all place data and pre-computes stats for the /data page.
 * Output is saved to public/data/dashboard-stats.json for zero-egress serving.
 *
 * Usage:
 *   node scripts/generate-dashboard-stats.mjs           # Use Supabase (production)
 *   node scripts/generate-dashboard-stats.mjs --local   # Use local PostgreSQL
 *   node scripts/generate-dashboard-stats.mjs --strict  # Fail if the source is unavailable
 *
 * The generated file is served statically - no Supabase queries on page load.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'
import { normalizePizzaStyle } from './lib/pizza-style-taxonomy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = join(__dirname, '../public/data')
const OUTPUT_FILE = join(OUTPUT_DIR, 'dashboard-stats.json')

// Parse args
const useLocal = process.argv.includes('--local')
const strict = process.argv.includes('--strict') || process.env.STRICT_STATS_GENERATION === '1'

// Initialize database client
let supabase = null
let pgClient = null

if (useLocal) {
  // Dynamically import pg only when needed (avoids requiring it for Supabase mode)
  const pg = await import('pg')
  pgClient = new pg.default.Client({
    host: 'localhost',
    database: 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })
} else {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htahyiuvqmalfpbgiizx.supabase.co'
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY must be set')
    console.error('Or use --local to generate from local PostgreSQL')
    process.exit(1)
  }

  supabase = createClient(supabaseUrl, supabaseKey)
}

// Country detection from state codes (same as DataDashboard.js)
const CANADIAN_CODES = new Set(['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'])
const MEXICAN_CODES = new Set([
  'CDMX', 'JAL', 'NLE', 'MEX', 'BCN', 'BCS', 'SON', 'CHH', 'COA', 'TAM',
  'SIN', 'DUR', 'ZAC', 'SLP', 'AGS', 'NAY', 'COL', 'MIC', 'GUA', 'QUE',
  'HID', 'MOR', 'TLA', 'PUE', 'VER', 'GRO', 'OAX', 'CHP', 'TAB', 'CAM', 'YUC', 'ROO'
])
const ITALIAN_CODES = new Set(['LOM', 'LAZ', 'CAM', 'SIC', 'VEN', 'EMR', 'PIE', 'TUS', 'APU', 'CAL', 'SAR', 'LIG', 'MAR', 'ABR', 'FVG', 'TAA', 'UMB', 'BAS', 'MOL', 'VDA'])
const GERMAN_CODES = new Set(['BY', 'NW', 'BW', 'NI', 'HE', 'SN', 'BE', 'RP', 'SH', 'BB', 'ST', 'TH', 'HH', 'MV', 'SL', 'HB'])
const FRENCH_CODES = new Set(['IDF', 'ARA', 'NAQ', 'OCC', 'HDF', 'PAC', 'GES', 'PDL', 'BRE', 'NOR', 'BFC', 'CVL', 'COR'])
const SPANISH_CODES = new Set(['AN', 'CT', 'MD', 'VC', 'GA', 'CL', 'PV', 'CN', 'CM', 'MC', 'AR', 'IB', 'EX', 'AS', 'NC', 'CB', 'RI'])
const UK_CODES = new Set(['ENG', 'SCT', 'WLS', 'NIR'])
const NETHERLANDS_CODES = new Set(['NH', 'ZH', 'NB', 'GE', 'UT', 'OV', 'LI', 'FR', 'GR', 'DR', 'FL', 'ZE'])
const BELGIUM_CODES = new Set(['BRU', 'WAL', 'VLG'])
const AUSTRIA_CODES = new Set(['WIE', 'NOE', 'OOE', 'STM', 'TIR', 'KTN', 'SBG', 'VBG', 'BGL'])
const SWITZERLAND_CODES = new Set(['ZH', 'BER', 'VD', 'AG', 'SG', 'GEN', 'LU', 'TI', 'VS', 'BL', 'FRI', 'TG', 'SO', 'BS', 'GRB', 'SZ', 'ZG', 'SHA', 'NE', 'JU', 'AR', 'AI', 'GL', 'NW', 'OW', 'URI'])
const POLAND_CODES = new Set(['MAZ', 'SLA', 'WLK', 'MLP', 'DOL', 'LOD', 'POM', 'KUJ', 'LBL', 'PDK', 'ZPM', 'WAM', 'SWK', 'PDL', 'LBS', 'OPO'])
const PORTUGAL_CODES = new Set(['LIS', 'PRT', 'BRG', 'SET', 'AVE', 'FAR', 'LEI', 'COI', 'SAN', 'VIS', 'VDC', 'VLR', 'CTB', 'GUA', 'EVO', 'BEJ', 'BGC', 'PTG', 'AZO', 'MAD'])
const CZECH_CODES = new Set(['PHA', 'STC', 'JHM', 'MSK', 'UST', 'JHC', 'PLZ', 'OLM', 'KHK', 'ZLN', 'PAR', 'LBR', 'VYS', 'KVY'])
const SWEDEN_CODES = new Set(['STK', 'VGL', 'SKA', 'OST', 'UPP', 'JON', 'HAL', 'ORE', 'GAV', 'SOD', 'DAL', 'VAS', 'VBT', 'NRB', 'VRM', 'KAL', 'KRO', 'BLE', 'VNR', 'JAM', 'GOT'])
const NORWAY_CODES = new Set(['VIK', 'OSL', 'ROG', 'VES', 'TRO', 'INN', 'VFT', 'AGD', 'MOR', 'NOR', 'TRF'])
const DENMARK_CODES = new Set(['HOV', 'MID', 'SYD', 'NJY', 'SJA'])
const FINLAND_CODES = new Set(['UUS', 'PIR', 'VAR', 'PPO', 'KES', 'SAT', 'PSA', 'PAH', 'POH', 'LAP', 'EPO', 'KYM', 'KAH', 'ESA', 'PKA', 'EKA', 'KAI', 'KPO', 'AHV'])
const IRELAND_CODES = new Set(['LEI', 'MUN', 'CON', 'ULS'])
const GREECE_CODES = new Set(['ATT', 'KMK', 'THE', 'DEL', 'KRI', 'STE', 'PEL', 'AMT', 'EPI', 'DMK', 'NAI', 'BAI', 'ION'])
const HUNGARY_CODES = new Set(['BUD', 'PES', 'BAZ', 'HAB', 'SSB', 'BAK', 'GMS', 'CSC', 'FEJ', 'JNS', 'BAR', 'SOM', 'VES', 'VAS', 'BEK', 'HEV', 'ZAL', 'TOL', 'NOG', 'KOE'])
const CROATIA_CODES = new Set(['ZAG', 'SPL', 'ZGZ', 'PGZ', 'OBZ', 'IST', 'VSZ', 'ZAD', 'SMZ', 'VAR', 'DNZ', 'BPZ', 'KAR', 'KKZ', 'BBZ', 'KZZ', 'SKZ', 'MEZ', 'PSZ', 'VPZ', 'LSZ'])
const ROMANIA_CODES = new Set(['BUC', 'CLJ', 'TIM', 'IAS', 'CST', 'BRS', 'PRH', 'DOL', 'ARG', 'BAC', 'BIH', 'SUC', 'GAL', 'MUR', 'SIB', 'HUN', 'ARA', 'MAR', 'NEA', 'ALB', 'BUZ', 'BOT', 'VLC', 'DAM', 'OLT', 'SAT', 'TEL', 'GOR', 'VAS', 'VRA', 'BRA', 'CRS', 'MEH', 'TUL', 'CAL', 'GIU', 'IAL', 'SAL', 'BIS', 'HAR', 'COV', 'ILF'])
// Latin America
const BRAZIL_CODES = new Set(['SP', 'MGS', 'RJ', 'BAS', 'RSS', 'PRS', 'PEB', 'CEB', 'PAB', 'SCB', 'MAB', 'GOB', 'AMB', 'ESB', 'PBB', 'RNB', 'MTB', 'ALB', 'PIB', 'DFB', 'MSB', 'SEB', 'ROB', 'TOB', 'ACB', 'APB', 'RRB'])
const ARGENTINA_CODES = new Set(['BAA', 'CAB', 'CDA', 'SFA', 'MZA', 'TUA', 'ERA', 'SAA', 'MNA', 'CHA', 'CWA', 'SEA', 'SJA', 'JYA', 'RNA', 'NQA', 'FOA', 'CHU', 'SLA', 'CTA', 'LRA', 'LPA', 'SZA', 'TFA', 'B', 'C', 'X', 'S', 'M', 'T', 'E', 'A', 'N', 'H', 'W', 'G', 'J', 'Y', 'R', 'Q', 'P', 'U', 'D', 'K', 'F', 'L', 'Z', 'V'])
const COLOMBIA_CODES = new Set(['DCC', 'ANTC', 'VACC', 'CUNC', 'ATLC', 'SANC', 'BOLC', 'NARC', 'CORC', 'TOLC', 'CAUC', 'NSAC', 'BOYC', 'MAGC', 'HUIC', 'CESC', 'RISC', 'METC', 'CALC', 'LAGC', 'SUCC', 'QUIC', 'CHOC', 'CAQC', 'CASC', 'PUTC', 'ARAC', 'AMAC', 'GUVC', 'VIDC', 'GUAC', 'VAUC', 'SAPC', 'DC', 'ANT', 'VAC', 'CUN', 'ATL', 'SAN', 'BOL', 'NAR', 'COR', 'TOL', 'CAU', 'NSA', 'BOY', 'MAG', 'HUI', 'CES', 'RIS', 'MET', 'CAL', 'LAG', 'SUC', 'QUI', 'CHO', 'CAQ', 'CAS', 'PUT', 'ARA', 'AMA', 'GUV', 'VID', 'GUA', 'VAU', 'SAP'])
const CHILE_CODES = new Set(['RMC', 'VSC', 'BIC', 'MLC', 'LIC', 'ARC', 'LGC', 'COC', 'ANC', 'LRC', 'TAC', 'ATC', 'NBC', 'APC', 'AIC', 'MAC', 'RM', 'VS', 'BI', 'ML', 'LI', 'AR', 'LG', 'CO', 'AN', 'LR', 'TA', 'AT', 'NB', 'AP', 'AI', 'MA'])
const PERU_CODES = new Set(['LIMP', 'LALP', 'PIUP', 'CAJP', 'PUNP', 'JUNP', 'CUSP', 'AREP', 'LAMP', 'ANCP', 'LORP', 'HUCP', 'SAMP', 'ICAP', 'AYAP', 'HUVP', 'UCAP', 'APUP', 'AMAP', 'TACP', 'PASP', 'TUMP', 'MOQP', 'MDDP', 'CALP', 'LIM', 'LAL', 'PIU', 'CAJ', 'PUN', 'JUN', 'CUS', 'ARE', 'LAM', 'ANC', 'LOR', 'HUC', 'SAM', 'ICA', 'AYA', 'HUV', 'UCA', 'APU', 'AMA', 'TAC', 'PAS', 'TUM', 'MOQ', 'MDD', 'CAL'])
const VENEZUELA_CODES = new Set(['DFV', 'ZUV', 'MIV', 'CAV', 'LAV', 'ARV', 'BOV', 'ANV', 'TAV', 'MEV', 'FAV', 'BAV', 'MOV', 'TRV', 'POV', 'GUV', 'SUV', 'YAV', 'NEV', 'COV', 'APV', 'DAV', 'VAV', 'AMV', 'DF', 'ZU', 'MI', 'CA', 'LA', 'AR', 'BO', 'AN', 'TA', 'ME', 'FA', 'BA', 'MO', 'TR', 'PO', 'GU', 'SU', 'YA', 'NE', 'CO', 'AP', 'DA', 'VA', 'AM'])
const ECUADOR_CODES = new Set(['GYE', 'PCE', 'MNE', 'LRE', 'AZE', 'EOE', 'ESE', 'TUE', 'CBE', 'IME', 'CTE', 'LJE', 'SDE', 'SEE', 'BOE', 'CRE', 'CNE', 'SUE', 'ORE', 'NAE', 'PAE', 'MSE', 'ZCE', 'GAE', 'GY', 'PC', 'MN', 'LR', 'AZ', 'EO', 'ES', 'TU', 'CB', 'IM', 'CT', 'LJ', 'SD', 'SE', 'BO', 'CR', 'CN', 'SU', 'OR', 'NA', 'PA', 'MS', 'ZC', 'GA'])
const BOLIVIA_CODES = new Set(['SCO', 'LPO', 'CBO', 'POO', 'CQO', 'ORO', 'TRO', 'EBO', 'PAO', 'SC', 'LP', 'CB', 'PO', 'CQ', 'OR', 'TR', 'EB', 'PA'])
const PARAGUAY_CODES = new Set(['ASP', 'CEP', 'AAP', 'ITP', 'CGP', 'SPP', 'CRP', 'PGP', 'GUP', 'CNP', 'CYP', 'CZP', 'AMP', 'MIP', 'NEP', 'PHP', 'AGP', 'BQP', 'ASU', 'CE', 'AA', 'IT', 'CG', 'SP', 'CR', 'PG', 'GU', 'CN', 'CY', 'CZ', 'AM', 'MI', 'NE', 'PH', 'AG', 'BQ'])
const URUGUAY_CODES = new Set(['MOU', 'CAU', 'MAU', 'SAU', 'COU', 'PAU', 'SJU', 'RVU', 'SOU', 'TAU', 'CLU', 'ROU', 'ARU', 'FDU', 'LAU', 'DUU', 'RNU', 'TTU', 'FSU', 'MO', 'CA', 'MA', 'SA', 'CO', 'PA', 'SJ', 'RV', 'SO', 'TA', 'CL', 'RO', 'AR', 'FD', 'LA', 'DU', 'RN', 'TT', 'FS'])
const GUYANA_CODES = new Set(['DEG', 'EBG', 'ESG', 'MAG', 'PMG', 'UDG', 'CUG', 'PTG', 'UTG', 'BAG', 'DE', 'EB', 'ES', 'MA', 'PM', 'UD', 'CU', 'PT', 'UT', 'BA'])
const SURINAME_CODES = new Set(['PMS', 'WAS', 'NIS', 'PRS', 'CMS', 'MAS', 'SAS', 'BRS', 'CRS', 'SIS', 'PM', 'WA', 'NI', 'PR', 'CM', 'MA', 'SA', 'BR', 'CR', 'SI'])
const GUATEMALA_CODES = new Set(['GUG', 'AVG', 'HUG', 'QCG', 'SMG', 'QZG', 'ESG', 'PEG', 'CMG', 'SUG', 'JUG', 'TOG', 'IZG', 'SOG', 'SRG', 'REG', 'JAG', 'CQG', 'BVG', 'ZAG', 'SAG', 'PRG', 'GU', 'AV', 'HU', 'QC', 'SM', 'QZ', 'ES', 'PE', 'CM', 'SU', 'JU', 'TO', 'IZ', 'SO', 'SR', 'RE', 'JA', 'CQ', 'BV', 'ZA', 'SA', 'PR'])
const HONDURAS_CODES = new Set(['FMH', 'CRH', 'YOH', 'OLH', 'CMH', 'CHH', 'ATH', 'CPH', 'SBH', 'LEH', 'EPH', 'LPH', 'INH', 'CLH', 'VAH', 'OCH', 'GDH', 'IBH', 'FM', 'CR', 'YO', 'OL', 'CM', 'CH', 'AT', 'CP', 'SB', 'LE', 'EP', 'LP', 'IN', 'CL', 'VA', 'OC', 'GD', 'IB'])
const EL_SALVADOR_CODES = new Set(['SSS', 'LIS', 'SAS', 'SMS', 'SOS', 'USS', 'AHS', 'UNS', 'PAS', 'CHS', 'CUS', 'SVS', 'CAS', 'MOS', 'SS', 'LI', 'SA', 'SM', 'SO', 'US', 'AH', 'UN', 'PA', 'CH', 'CU', 'SV', 'CA', 'MO'])
const NICARAGUA_CODES = new Set(['MNN', 'MTN', 'LEN', 'CIN', 'MSN', 'GRN', 'ESN', 'JIN', 'CON', 'RIN', 'CAN', 'NSN', 'BON', 'MDN', 'SJN', 'ANN', 'ASN', 'MN', 'MT', 'LE', 'CI', 'MS', 'GR', 'ES', 'JI', 'CO', 'RI', 'CA', 'NS', 'BO', 'MD', 'SJ', 'AN', 'AS'])
const COSTA_RICA_CODES = new Set(['SJC', 'ALC', 'CAC', 'HEC', 'GUC', 'PUC', 'LIC', 'SJ', 'AL', 'CA', 'HE', 'GU', 'PU', 'LI'])
const PANAMA_CODES = new Set(['PMP', 'POP', 'CHP', 'CLP', 'CCP', 'VEP', 'HEP', 'LSP', 'BTP', 'DAP', 'EMP', 'KYP', 'NBP', 'PM', 'PO', 'CH', 'CL', 'CC', 'VE', 'HE', 'LS', 'BT', 'DA', 'EM', 'KY', 'NB'])
const BELIZE_CODES = new Set(['BZB', 'CYB', 'OWB', 'CZB', 'SCB', 'TOB', 'BZ', 'CY', 'OW', 'CZ', 'SC', 'TO'])

// Global script countries (where state = ISO country code)
// ONLY codes that DON'T conflict with regional codes are included.
// Excluded due to conflicts:
//   US states: IN (Indiana/India), ID (Idaho/Indonesia), IL (Illinois/Israel), MA (Massachusetts/Morocco)
//   German states: TH (Thuringia/Thailand)
//   Spanish regions: CN (Canary Islands/China)
//   Swiss cantons: SG (St. Gallen/Singapore)
//   Venezuela states: TR (Trujillo/Turkey)
//   Paraguay: PH (Philippines)
//   Uruguay/Suriname/Guatemala/El Salvador: SA (Saudi Arabia)
//   Guatemala: ZA (South Africa)
//   Bavaria: BY (Belarus)
const GLOBAL_COUNTRY_CODES = new Map([
  // Asia-Pacific (non-conflicting only)
  ['JP', 'JP'],  // Japan
  ['KR', 'KR'],  // South Korea
  ['VN', 'VN'],  // Vietnam
  ['MY', 'MY'],  // Malaysia
  ['AU', 'AU'],  // Australia
  ['NZ', 'NZ'],  // New Zealand
  // Middle East (non-conflicting only)
  ['AE', 'AE'],  // UAE
  ['EG', 'EG'],  // Egypt
  ['QA', 'QA'],  // Qatar
  ['KW', 'KW'],  // Kuwait
  ['BH', 'BH'],  // Bahrain
  ['OM', 'OM'],  // Oman
  ['JO', 'JO'],  // Jordan
  ['LB', 'LB'],  // Lebanon
  // Africa (non-conflicting only)
  ['NG', 'NG'],  // Nigeria
  ['KE', 'KE'],  // Kenya
  ['GH', 'GH'],  // Ghana
  ['TZ', 'TZ'],  // Tanzania
  // Eastern Europe
  ['RU', 'RU'],  // Russia
  ['UA', 'UA'],  // Ukraine
  // 3-letter codes for conflicting countries (migrated from 2-letter)
  ['THA', 'TH'],  // Thailand (was TH, conflicts with Thuringia)
  ['CHN', 'CN'],  // China (was CN, conflicts with Canary Islands)
  ['SGP', 'SG'],  // Singapore (was SG, conflicts with St. Gallen)
  ['TUR', 'TR'],  // Turkey (was TR, conflicts with Trujillo)
  ['PHL', 'PH'],  // Philippines (was PH, conflicts with Paraguay)
  ['SAU', 'SA'],  // Saudi Arabia (was SA, conflicts with LatAm regions)
  ['ZAF', 'ZA'],  // South Africa (was ZA, conflicts with Guatemala)
  ['IND', 'IN'],  // India (was IN, conflicts with Indiana)
  ['IDN', 'ID'],  // Indonesia (was ID, conflicts with Idaho)
])

function getCountry(stateCode) {
  if (!stateCode) return 'Unknown'
  if (CANADIAN_CODES.has(stateCode)) return 'CA'
  if (MEXICAN_CODES.has(stateCode)) return 'MX'
  if (ITALIAN_CODES.has(stateCode)) return 'IT'
  if (GERMAN_CODES.has(stateCode)) return 'DE'
  if (FRENCH_CODES.has(stateCode)) return 'FR'
  if (SPANISH_CODES.has(stateCode)) return 'ES'
  if (UK_CODES.has(stateCode)) return 'GB'
  if (NETHERLANDS_CODES.has(stateCode)) return 'NL'
  if (BELGIUM_CODES.has(stateCode)) return 'BE'
  if (AUSTRIA_CODES.has(stateCode)) return 'AT'
  if (SWITZERLAND_CODES.has(stateCode)) return 'CH'
  if (POLAND_CODES.has(stateCode)) return 'PL'
  if (PORTUGAL_CODES.has(stateCode)) return 'PT'
  if (CZECH_CODES.has(stateCode)) return 'CZ'
  if (SWEDEN_CODES.has(stateCode)) return 'SE'
  if (NORWAY_CODES.has(stateCode)) return 'NO'
  if (DENMARK_CODES.has(stateCode)) return 'DK'
  if (FINLAND_CODES.has(stateCode)) return 'FI'
  if (IRELAND_CODES.has(stateCode)) return 'IE'
  if (GREECE_CODES.has(stateCode)) return 'GR'
  if (HUNGARY_CODES.has(stateCode)) return 'HU'
  if (CROATIA_CODES.has(stateCode)) return 'HR'
  if (ROMANIA_CODES.has(stateCode)) return 'RO'
  if (BRAZIL_CODES.has(stateCode)) return 'BR'
  if (ARGENTINA_CODES.has(stateCode)) return 'AR'
  if (COLOMBIA_CODES.has(stateCode)) return 'CO'
  if (CHILE_CODES.has(stateCode)) return 'CL'
  if (PERU_CODES.has(stateCode)) return 'PE'
  if (VENEZUELA_CODES.has(stateCode)) return 'VE'
  if (ECUADOR_CODES.has(stateCode)) return 'EC'
  if (BOLIVIA_CODES.has(stateCode)) return 'BO'
  if (PARAGUAY_CODES.has(stateCode)) return 'PY'
  if (URUGUAY_CODES.has(stateCode)) return 'UY'
  if (GUYANA_CODES.has(stateCode)) return 'GY'
  if (SURINAME_CODES.has(stateCode)) return 'SR'
  if (GUATEMALA_CODES.has(stateCode)) return 'GT'
  if (HONDURAS_CODES.has(stateCode)) return 'HN'
  if (EL_SALVADOR_CODES.has(stateCode)) return 'SV'
  if (NICARAGUA_CODES.has(stateCode)) return 'NI'
  if (COSTA_RICA_CODES.has(stateCode)) return 'CR'
  if (PANAMA_CODES.has(stateCode)) return 'PA'
  if (BELIZE_CODES.has(stateCode)) return 'BZ'
  // Global script countries (state = ISO country code)
  if (GLOBAL_COUNTRY_CODES.has(stateCode)) return GLOBAL_COUNTRY_CODES.get(stateCode)
  return 'US'
}

/**
 * Fetch all records from a table (Supabase with pagination)
 */
async function fetchAllSupabase(table, selectFields) {
  const pageSize = 1000
  let allData = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectFields)
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allData = allData.concat(data)
    console.log(`  Fetched ${allData.length} from ${table}...`)

    if (data.length < pageSize) break
    offset += pageSize
  }

  return allData
}

/**
 * Fetch all records from a table (local PostgreSQL)
 */
async function fetchAllLocal(table, selectFields) {
  const columns = selectFields.split(',').map(f => f.trim()).join(', ')
  const result = await pgClient.query(`SELECT ${columns} FROM ${table}`)
  console.log(`  Fetched ${result.rows.length} from ${table}`)
  return result.rows
}

/**
 * Fetch all records from a table (auto-selects backend)
 */
async function fetchAll(table, selectFields) {
  if (useLocal) {
    return fetchAllLocal(table, selectFields)
  }
  return fetchAllSupabase(table, selectFields)
}

/**
 * Compute stats from place data (same logic as DataDashboard.js)
 */
function computeStats(places, groupByField, normalizeStyle = value => value) {
  const distribution = {}
  const byState = {}
  const byCity = {}
  const byPrice = {}
  const byCountry = {}
  const ratingByStyle = {}
  const ratingByState = {}
  let visited = 0, unvisited = 0, golden = 0
  let withAddress = 0
  let ratedPlaces = []

  places.forEach(p => {
    // Group by field (style)
    const key = normalizeStyle(p[groupByField]) || 'Unknown'
    const styles = key.includes(',') ? key.split(',').map(t => t.trim()) : [key]
    styles.forEach(style => {
      distribution[style] = (distribution[style] || 0) + 1
      if (typeof p.rating === 'number' && !Number.isNaN(p.rating) && style !== 'Unknown') {
        if (!ratingByStyle[style]) ratingByStyle[style] = { count: 0, sum: 0 }
        ratingByStyle[style].count++
        ratingByStyle[style].sum += p.rating
      }
    })

    // State counts
    const state = p.state || 'Unknown'
    byState[state] = (byState[state] || 0) + 1

    if (typeof p.rating === 'number' && !Number.isNaN(p.rating) && state !== 'Unknown') {
      if (!ratingByState[state]) ratingByState[state] = { count: 0, sum: 0 }
      ratingByState[state].count++
      ratingByState[state].sum += p.rating
    }

    // City counts
    if (p.address) {
      const parts = p.address.split(',')
      if (parts.length >= 3) {
        let city = parts[parts.length - 2]?.trim()
        if (city && (city.length === 2 || /^\d{5}/.test(city) || /^[A-Z]{2}\s*\d/.test(city))) {
          city = parts[parts.length - 3]?.trim()
        }
        if (city && city.length > 2 && city.length < 40 && !/^\d/.test(city)) {
          byCity[city] = (byCity[city] || 0) + 1
        }
      }
    }

    // Country counts
    const country = getCountry(p.state)
    if (country !== 'Unknown') {
      byCountry[country] = (byCountry[country] || 0) + 1
    }

    // Price counts
    const price = p.price_range || p.price || 'Unknown'
    byPrice[price] = (byPrice[price] || 0) + 1

    // Status counts
    if (p.status === 'visited') visited++
    else if (p.status === 'golden') golden++
    else unvisited++

    // Data quality
    if (p.address && p.address.trim()) withAddress++

    // Rating tracking
    if (typeof p.rating === 'number' && !Number.isNaN(p.rating)) {
      ratedPlaces.push(p.rating)
    }
  })

  // Additional data quality
  const withRating = ratedPlaces.length
  const withPrice = places.filter(p => (p.price_range || p.price) && String(p.price_range || p.price).trim()).length
  const withStyle = places.filter(p => normalizeStyle(p.style) && normalizeStyle(p.style) !== 'Unknown').length
  const visitedOrGolden = visited + golden
  const withAllFields = places.filter(p =>
    p.address?.trim() &&
    typeof p.rating === 'number' &&
    String(p.price_range || p.price || '').trim() &&
    normalizeStyle(p.style) && normalizeStyle(p.style) !== 'Unknown'
  ).length

  // Rating analytics
  const avgRating = ratedPlaces.length
    ? ratedPlaces.reduce((s, r) => s + r, 0) / ratedPlaces.length
    : null
  const topRatedCount = ratedPlaces.filter(r => r >= 9.0).length

  const ratingDistribution = [
    ratedPlaces.filter(r => r >= 0 && r < 3).length,
    ratedPlaces.filter(r => r >= 3 && r < 5).length,
    ratedPlaces.filter(r => r >= 5 && r < 7).length,
    ratedPlaces.filter(r => r >= 7 && r < 9).length,
    ratedPlaces.filter(r => r >= 9).length,
  ]

  const bestRatedStyles = Object.entries(ratingByStyle)
    .filter(([_, data]) => data.count >= 5)
    .map(([style, data]) => [style, data.sum / data.count, data.count])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const bestRatedRegions = Object.entries(ratingByState)
    .filter(([_, data]) => data.count >= 10)
    .map(([state, data]) => [state, data.sum / data.count, data.count])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const topCities = Object.entries(byCity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  return {
    total: places.length,
    distribution: Object.entries(distribution)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => b[1] - a[1]),
    byState: Object.entries(byState)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
    byCity: topCities,
    byPrice: Object.entries(byPrice)
      .filter(([k]) => k !== 'Unknown')
      .sort((a, b) => {
        const order = { '$': 0, '$$': 1, '$$$': 2, '$$$$': 3 }
        return (order[a[0]] ?? 99) - (order[b[0]] ?? 99)
      }),
    byCountry,
    visited,
    unvisited,
    golden,
    avgRating,
    ratedCount: ratedPlaces.length,
    topRatedCount,
    ratingDistribution,
    bestRatedStyles,
    bestRatedRegions,
    withAddress,
    addressPct: places.length ? (withAddress / places.length) * 100 : 0,
    withRating,
    withPrice,
    withStyle,
    visitedOrGolden,
    withAllFields,
  }
}

async function main() {
  console.log('=== Generating Dashboard Stats ===\n')
  console.log(`Source: ${useLocal ? 'Local PostgreSQL' : 'Supabase'}`)
  console.log('This generates a static JSON file for the /data page (zero egress).\n')

  try {
    // Connect to local PostgreSQL if needed
    if (useLocal) {
      await pgClient.connect()
      console.log('Connected to local PostgreSQL\n')
    }

    // Fetch all data
    console.log('Fetching pizza places...')
    const pizzaData = await fetchAll('pizza_places', 'style, price, price_range, status, state, rating, address')
    console.log(`  Total: ${pizzaData.length} pizza places\n`)

    console.log('Fetching taco places...')
    const tacoData = await fetchAll('taco_places', 'style, price, status, state, rating, address')
    console.log(`  Total: ${tacoData.length} taco places\n`)

    // Compute stats
    console.log('Computing stats...')
    const pizzaStats = computeStats(pizzaData, 'style', normalizePizzaStyle)
    const tacoStats = computeStats(tacoData, 'style')

    // Build output
    const output = {
      generatedAt: new Date().toISOString(),
      source: useLocal ? 'local' : 'supabase',
      pizza: pizzaStats,
      taco: tacoStats,
    }

    // Ensure output directory exists
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true })
    }

    // Write JSON
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
    console.log(`\nStats written to: ${OUTPUT_FILE}`)

    // Summary
    const fileSize = (JSON.stringify(output).length / 1024).toFixed(1)
    console.log(`\n=== Summary ===`)
    console.log(`Pizza places: ${pizzaStats.total.toLocaleString()}`)
    console.log(`Taco places: ${tacoStats.total.toLocaleString()}`)
    console.log(`File size: ${fileSize} KB`)
    console.log(`\nThe /data page will now load this static file (zero egress).`)

  } catch (error) {
    if (existsSync(OUTPUT_FILE) && !strict) {
      console.warn(`Warning: stats generation failed: ${error.message}`)
      console.warn(`Keeping the existing static stats file: ${OUTPUT_FILE}`)
      console.warn('Use --strict when a fresh stats file is required.')
      return
    }

    console.error('Error:', error.message)
    process.exitCode = 1
  } finally {
    // Clean up local connection
    if (pgClient) {
      await pgClient.end()
    }
  }
}

main()
