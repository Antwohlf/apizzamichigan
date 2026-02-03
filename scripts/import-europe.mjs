#!/usr/bin/env node
/**
 * Import European Regions - 21 Countries
 *
 * Imports pizza AND taco places from European countries using OpenStreetMap.
 * Uses progress tracking for resume capability and rate limiting to respect API limits.
 *
 * Wave 1: Italy, Germany, France, Spain, UK (~55k places)
 * Wave 2: Netherlands, Belgium, Austria, Switzerland, Poland, Portugal, Czech Republic,
 *         Sweden, Norway, Denmark, Finland, Ireland, Greece, Hungary, Croatia, Romania
 *
 * Usage:
 *   node scripts/import-europe.mjs --dry-run             # Preview all imports
 *   node scripts/import-europe.mjs --report              # Show progress report only
 *   node scripts/import-europe.mjs --limit=5             # Only process 5 regions
 *
 * Food type filters:
 *   node scripts/import-europe.mjs --pizza-only          # Import only pizza places
 *   node scripts/import-europe.mjs --tacos-only          # Import only taco places
 *
 * Wave filters:
 *   node scripts/import-europe.mjs --wave1-only          # Import only Wave 1 countries
 *   node scripts/import-europe.mjs --wave2-only          # Import only Wave 2 countries
 *
 * Country filters (Wave 1):
 *   --italy-only, --germany-only, --france-only, --spain-only, --uk-only
 *
 * Country filters (Wave 2):
 *   --netherlands-only, --belgium-only, --austria-only, --switzerland-only
 *   --poland-only, --portugal-only, --czech-only
 *   --sweden-only, --norway-only, --denmark-only, --finland-only
 *   --ireland-only, --greece-only, --hungary-only, --croatia-only, --romania-only
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Progress file for tracking
const PROGRESS_FILE = join(__dirname, '.europe-import-progress.json')

// Italian Regions (admin_level=4) - 20 regions - use Italian names for OSM matching
const ITALIAN_REGIONS = [
  { name: 'Lombardia', code: 'LOM', country: 'IT', adminLevel: 4 },
  { name: 'Lazio', code: 'LAZ', country: 'IT', adminLevel: 4 },
  { name: 'Campania', code: 'CAM', country: 'IT', adminLevel: 4 },
  { name: 'Sicilia', code: 'SIC', country: 'IT', adminLevel: 4 },
  { name: 'Veneto', code: 'VEN', country: 'IT', adminLevel: 4 },
  { name: 'Emilia-Romagna', code: 'EMR', country: 'IT', adminLevel: 4 },
  { name: 'Piemonte', code: 'PIE', country: 'IT', adminLevel: 4 },
  { name: 'Toscana', code: 'TUS', country: 'IT', adminLevel: 4 },
  { name: 'Puglia', code: 'APU', country: 'IT', adminLevel: 4 },
  { name: 'Calabria', code: 'CAL', country: 'IT', adminLevel: 4 },
  { name: 'Sardegna', code: 'SAR', country: 'IT', adminLevel: 4 },
  { name: 'Liguria', code: 'LIG', country: 'IT', adminLevel: 4 },
  { name: 'Marche', code: 'MAR', country: 'IT', adminLevel: 4 },
  { name: 'Abruzzo', code: 'ABR', country: 'IT', adminLevel: 4 },
  { name: 'Friuli-Venezia Giulia', code: 'FVG', country: 'IT', adminLevel: 4 },
  { name: 'Trentino-Alto Adige/Südtirol', code: 'TAA', country: 'IT', adminLevel: 4 },
  { name: 'Umbria', code: 'UMB', country: 'IT', adminLevel: 4 },
  { name: 'Basilicata', code: 'BAS', country: 'IT', adminLevel: 4 },
  { name: 'Molise', code: 'MOL', country: 'IT', adminLevel: 4 },
  { name: "Valle d'Aosta/Vallée d'Aoste", code: 'VDA', country: 'IT', adminLevel: 4 },
]

// German States (admin_level=4) - 16 Bundesländer - use German names for OSM matching
const GERMAN_STATES = [
  { name: 'Bayern', code: 'BY', country: 'DE', adminLevel: 4 },
  { name: 'Nordrhein-Westfalen', code: 'NW', country: 'DE', adminLevel: 4 },
  { name: 'Baden-Württemberg', code: 'BW', country: 'DE', adminLevel: 4 },
  { name: 'Niedersachsen', code: 'NI', country: 'DE', adminLevel: 4 },
  { name: 'Hessen', code: 'HE', country: 'DE', adminLevel: 4 },
  { name: 'Sachsen', code: 'SN', country: 'DE', adminLevel: 4 },
  { name: 'Berlin', code: 'BE', country: 'DE', adminLevel: 4 },
  { name: 'Rheinland-Pfalz', code: 'RP', country: 'DE', adminLevel: 4 },
  { name: 'Schleswig-Holstein', code: 'SH', country: 'DE', adminLevel: 4 },
  { name: 'Brandenburg', code: 'BB', country: 'DE', adminLevel: 4 },
  { name: 'Sachsen-Anhalt', code: 'ST', country: 'DE', adminLevel: 4 },
  { name: 'Thüringen', code: 'TH', country: 'DE', adminLevel: 4 },
  { name: 'Hamburg', code: 'HH', country: 'DE', adminLevel: 4 },
  { name: 'Mecklenburg-Vorpommern', code: 'MV', country: 'DE', adminLevel: 4 },
  { name: 'Saarland', code: 'SL', country: 'DE', adminLevel: 4 },
  { name: 'Bremen', code: 'HB', country: 'DE', adminLevel: 4 },
]

// French Regions (admin_level=4) - 13 mainland regions (post-2016 reform) - use French names
const FRENCH_REGIONS = [
  { name: 'Île-de-France', code: 'IDF', country: 'FR', adminLevel: 4 },
  { name: 'Auvergne-Rhône-Alpes', code: 'ARA', country: 'FR', adminLevel: 4 },
  { name: 'Nouvelle-Aquitaine', code: 'NAQ', country: 'FR', adminLevel: 4 },
  { name: 'Occitanie', code: 'OCC', country: 'FR', adminLevel: 4 },
  { name: 'Hauts-de-France', code: 'HDF', country: 'FR', adminLevel: 4 },
  { name: "Provence-Alpes-Côte d'Azur", code: 'PAC', country: 'FR', adminLevel: 4 },
  { name: 'Grand Est', code: 'GES', country: 'FR', adminLevel: 4 },
  { name: 'Pays de la Loire', code: 'PDL', country: 'FR', adminLevel: 4 },
  { name: 'Bretagne', code: 'BRE', country: 'FR', adminLevel: 4 },
  { name: 'Normandie', code: 'NOR', country: 'FR', adminLevel: 4 },
  { name: 'Bourgogne-Franche-Comté', code: 'BFC', country: 'FR', adminLevel: 4 },
  { name: 'Centre-Val de Loire', code: 'CVL', country: 'FR', adminLevel: 4 },
  { name: 'Corse', code: 'COR', country: 'FR', adminLevel: 4 },
]

// Spanish Autonomous Communities (admin_level=4) - 17 communities - use Spanish names
const SPANISH_COMMUNITIES = [
  { name: 'Andalucía', code: 'AN', country: 'ES', adminLevel: 4 },
  { name: 'Catalunya', code: 'CT', country: 'ES', adminLevel: 4 },
  { name: 'Comunidad de Madrid', code: 'MD', country: 'ES', adminLevel: 4 },
  { name: 'Comunitat Valenciana', code: 'VC', country: 'ES', adminLevel: 4 },
  { name: 'Galicia', code: 'GA', country: 'ES', adminLevel: 4 },
  { name: 'Castilla y León', code: 'CL', country: 'ES', adminLevel: 4 },
  { name: 'Euskadi', code: 'PV', country: 'ES', adminLevel: 4 },
  { name: 'Canarias', code: 'CN', country: 'ES', adminLevel: 4 },
  { name: 'Castilla-La Mancha', code: 'CM', country: 'ES', adminLevel: 4 },
  { name: 'Región de Murcia', code: 'MC', country: 'ES', adminLevel: 4 },
  { name: 'Aragón', code: 'AR', country: 'ES', adminLevel: 4 },
  { name: 'Illes Balears', code: 'IB', country: 'ES', adminLevel: 4 },
  { name: 'Extremadura', code: 'EX', country: 'ES', adminLevel: 4 },
  { name: 'Principado de Asturias', code: 'AS', country: 'ES', adminLevel: 4 },
  { name: 'Comunidad Foral de Navarra', code: 'NC', country: 'ES', adminLevel: 4 },
  { name: 'Cantabria', code: 'CB', country: 'ES', adminLevel: 4 },
  { name: 'La Rioja', code: 'RI', country: 'ES', adminLevel: 4 },
]

// UK Countries (admin_level=4 for UK constituent countries)
const UK_COUNTRIES = [
  { name: 'England', code: 'ENG', country: 'GB', adminLevel: 4 },
  { name: 'Scotland', code: 'SCT', country: 'GB', adminLevel: 4 },
  { name: 'Wales', code: 'WLS', country: 'GB', adminLevel: 4 },
  { name: 'Northern Ireland', code: 'NIR', country: 'GB', adminLevel: 5 },
]

// ============== WAVE 2 EUROPEAN COUNTRIES ==============

// Netherlands Provinces (admin_level=4) - 12 provinces
const NETHERLANDS_PROVINCES = [
  { name: 'Noord-Holland', code: 'NH', country: 'NL', adminLevel: 4 },
  { name: 'Zuid-Holland', code: 'ZH', country: 'NL', adminLevel: 4 },
  { name: 'Noord-Brabant', code: 'NB', country: 'NL', adminLevel: 4 },
  { name: 'Gelderland', code: 'GE', country: 'NL', adminLevel: 4 },
  { name: 'Utrecht', code: 'UT', country: 'NL', adminLevel: 4 },
  { name: 'Overijssel', code: 'OV', country: 'NL', adminLevel: 4 },
  { name: 'Limburg', code: 'LI', country: 'NL', adminLevel: 4 },
  { name: 'Friesland', code: 'FR', country: 'NL', adminLevel: 4 },
  { name: 'Groningen', code: 'GR', country: 'NL', adminLevel: 4 },
  { name: 'Drenthe', code: 'DR', country: 'NL', adminLevel: 4 },
  { name: 'Flevoland', code: 'FL', country: 'NL', adminLevel: 4 },
  { name: 'Zeeland', code: 'ZE', country: 'NL', adminLevel: 4 },
]

// Belgium Regions (admin_level=4) - 3 regions
const BELGIUM_REGIONS = [
  { name: 'Région de Bruxelles-Capitale - Brussels Hoofdstedelijk Gewest', code: 'BRU', country: 'BE', adminLevel: 4 },
  { name: 'Région wallonne', code: 'WAL', country: 'BE', adminLevel: 4 },
  { name: 'Vlaanderen', code: 'VLG', country: 'BE', adminLevel: 4 },
]

// Austria States (admin_level=4) - 9 Bundesländer
const AUSTRIA_STATES = [
  { name: 'Wien', code: 'WIE', country: 'AT', adminLevel: 4 },
  { name: 'Niederösterreich', code: 'NOE', country: 'AT', adminLevel: 4 },
  { name: 'Oberösterreich', code: 'OOE', country: 'AT', adminLevel: 4 },
  { name: 'Steiermark', code: 'STM', country: 'AT', adminLevel: 4 },
  { name: 'Tirol', code: 'TIR', country: 'AT', adminLevel: 4 },
  { name: 'Kärnten', code: 'KTN', country: 'AT', adminLevel: 4 },
  { name: 'Salzburg', code: 'SBG', country: 'AT', adminLevel: 4 },
  { name: 'Vorarlberg', code: 'VBG', country: 'AT', adminLevel: 4 },
  { name: 'Burgenland', code: 'BGL', country: 'AT', adminLevel: 4 },
]

// Switzerland Cantons (admin_level=4) - 26 cantons
const SWITZERLAND_CANTONS = [
  { name: 'Zürich', code: 'ZH', country: 'CH', adminLevel: 4 },
  { name: 'Bern', code: 'BER', country: 'CH', adminLevel: 4 },
  { name: 'Vaud', code: 'VD', country: 'CH', adminLevel: 4 },
  { name: 'Aargau', code: 'AG', country: 'CH', adminLevel: 4 },
  { name: 'St. Gallen', code: 'SG', country: 'CH', adminLevel: 4 },
  { name: 'Genève', code: 'GEN', country: 'CH', adminLevel: 4 },
  { name: 'Luzern', code: 'LU', country: 'CH', adminLevel: 4 },
  { name: 'Ticino', code: 'TI', country: 'CH', adminLevel: 4 },
  { name: 'Valais', code: 'VS', country: 'CH', adminLevel: 4 },
  { name: 'Basel-Landschaft', code: 'BL', country: 'CH', adminLevel: 4 },
  { name: 'Fribourg', code: 'FRI', country: 'CH', adminLevel: 4 },
  { name: 'Thurgau', code: 'TG', country: 'CH', adminLevel: 4 },
  { name: 'Solothurn', code: 'SO', country: 'CH', adminLevel: 4 },
  { name: 'Basel-Stadt', code: 'BS', country: 'CH', adminLevel: 4 },
  { name: 'Graubünden', code: 'GRB', country: 'CH', adminLevel: 4 },
  { name: 'Schwyz', code: 'SZ', country: 'CH', adminLevel: 4 },
  { name: 'Zug', code: 'ZG', country: 'CH', adminLevel: 4 },
  { name: 'Schaffhausen', code: 'SHA', country: 'CH', adminLevel: 4 },
  { name: 'Neuchâtel', code: 'NE', country: 'CH', adminLevel: 4 },
  { name: 'Jura', code: 'JU', country: 'CH', adminLevel: 4 },
  { name: 'Appenzell Ausserrhoden', code: 'AR', country: 'CH', adminLevel: 4 },
  { name: 'Appenzell Innerrhoden', code: 'AI', country: 'CH', adminLevel: 4 },
  { name: 'Glarus', code: 'GL', country: 'CH', adminLevel: 4 },
  { name: 'Nidwalden', code: 'NW', country: 'CH', adminLevel: 4 },
  { name: 'Obwalden', code: 'OW', country: 'CH', adminLevel: 4 },
  { name: 'Uri', code: 'URI', country: 'CH', adminLevel: 4 },
]

// Poland Voivodeships (admin_level=4) - 16 voivodeships - use lowercase "województwo" prefix
const POLAND_VOIVODESHIPS = [
  { name: 'województwo mazowieckie', code: 'MAZ', country: 'PL', adminLevel: 4 },
  { name: 'województwo śląskie', code: 'SLA', country: 'PL', adminLevel: 4 },
  { name: 'województwo wielkopolskie', code: 'WLK', country: 'PL', adminLevel: 4 },
  { name: 'województwo małopolskie', code: 'MLP', country: 'PL', adminLevel: 4 },
  { name: 'województwo dolnośląskie', code: 'DOL', country: 'PL', adminLevel: 4 },
  { name: 'województwo łódzkie', code: 'LOD', country: 'PL', adminLevel: 4 },
  { name: 'województwo pomorskie', code: 'POM', country: 'PL', adminLevel: 4 },
  { name: 'województwo kujawsko-pomorskie', code: 'KUJ', country: 'PL', adminLevel: 4 },
  { name: 'województwo lubelskie', code: 'LBL', country: 'PL', adminLevel: 4 },
  { name: 'województwo podkarpackie', code: 'PDK', country: 'PL', adminLevel: 4 },
  { name: 'województwo zachodniopomorskie', code: 'ZPM', country: 'PL', adminLevel: 4 },
  { name: 'województwo warmińsko-mazurskie', code: 'WAM', country: 'PL', adminLevel: 4 },
  { name: 'województwo świętokrzyskie', code: 'SWK', country: 'PL', adminLevel: 4 },
  { name: 'województwo podlaskie', code: 'PDL', country: 'PL', adminLevel: 4 },
  { name: 'województwo lubuskie', code: 'LBS', country: 'PL', adminLevel: 4 },
  { name: 'województwo opolskie', code: 'OPO', country: 'PL', adminLevel: 4 },
]

// Portugal Districts (admin_level=6) - 18 districts + 2 autonomous regions
const PORTUGAL_DISTRICTS = [
  { name: 'Lisboa', code: 'LIS', country: 'PT', adminLevel: 6 },
  { name: 'Porto', code: 'PRT', country: 'PT', adminLevel: 6 },
  { name: 'Braga', code: 'BRG', country: 'PT', adminLevel: 6 },
  { name: 'Setúbal', code: 'SET', country: 'PT', adminLevel: 6 },
  { name: 'Aveiro', code: 'AVE', country: 'PT', adminLevel: 6 },
  { name: 'Faro', code: 'FAR', country: 'PT', adminLevel: 6 },
  { name: 'Leiria', code: 'LEI', country: 'PT', adminLevel: 6 },
  { name: 'Coimbra', code: 'COI', country: 'PT', adminLevel: 6 },
  { name: 'Santarém', code: 'SAN', country: 'PT', adminLevel: 6 },
  { name: 'Viseu', code: 'VIS', country: 'PT', adminLevel: 6 },
  { name: 'Viana do Castelo', code: 'VDC', country: 'PT', adminLevel: 6 },
  { name: 'Vila Real', code: 'VLR', country: 'PT', adminLevel: 6 },
  { name: 'Castelo Branco', code: 'CTB', country: 'PT', adminLevel: 6 },
  { name: 'Guarda', code: 'GUA', country: 'PT', adminLevel: 6 },
  { name: 'Évora', code: 'EVO', country: 'PT', adminLevel: 6 },
  { name: 'Beja', code: 'BEJ', country: 'PT', adminLevel: 6 },
  { name: 'Bragança', code: 'BGC', country: 'PT', adminLevel: 6 },
  { name: 'Portalegre', code: 'PTG', country: 'PT', adminLevel: 6 },
  { name: 'Região Autónoma dos Açores', code: 'AZO', country: 'PT', adminLevel: 4 },
  { name: 'Região Autónoma da Madeira', code: 'MAD', country: 'PT', adminLevel: 4 },
]

// Czech Republic Regions (admin_level=4) - 13 regions + Prague
const CZECH_REGIONS = [
  { name: 'Praha', code: 'PHA', country: 'CZ', adminLevel: 4 },
  { name: 'Středočeský kraj', code: 'STC', country: 'CZ', adminLevel: 4 },
  { name: 'Jihomoravský kraj', code: 'JHM', country: 'CZ', adminLevel: 4 },
  { name: 'Moravskoslezský kraj', code: 'MSK', country: 'CZ', adminLevel: 4 },
  { name: 'Ústecký kraj', code: 'UST', country: 'CZ', adminLevel: 4 },
  { name: 'Jihočeský kraj', code: 'JHC', country: 'CZ', adminLevel: 4 },
  { name: 'Plzeňský kraj', code: 'PLZ', country: 'CZ', adminLevel: 4 },
  { name: 'Olomoucký kraj', code: 'OLM', country: 'CZ', adminLevel: 4 },
  { name: 'Královéhradecký kraj', code: 'KHK', country: 'CZ', adminLevel: 4 },
  { name: 'Zlínský kraj', code: 'ZLN', country: 'CZ', adminLevel: 4 },
  { name: 'Pardubický kraj', code: 'PAR', country: 'CZ', adminLevel: 4 },
  { name: 'Liberecký kraj', code: 'LBR', country: 'CZ', adminLevel: 4 },
  { name: 'Kraj Vysočina', code: 'VYS', country: 'CZ', adminLevel: 4 },
  { name: 'Karlovarský kraj', code: 'KVY', country: 'CZ', adminLevel: 4 },
]

// Sweden Counties (admin_level=4) - 21 counties
const SWEDEN_COUNTIES = [
  { name: 'Stockholms län', code: 'STK', country: 'SE', adminLevel: 4 },
  { name: 'Västra Götalands län', code: 'VGL', country: 'SE', adminLevel: 4 },
  { name: 'Skåne län', code: 'SKA', country: 'SE', adminLevel: 4 },
  { name: 'Östergötlands län', code: 'OST', country: 'SE', adminLevel: 4 },
  { name: 'Uppsala län', code: 'UPP', country: 'SE', adminLevel: 4 },
  { name: 'Jönköpings län', code: 'JON', country: 'SE', adminLevel: 4 },
  { name: 'Hallands län', code: 'HAL', country: 'SE', adminLevel: 4 },
  { name: 'Örebro län', code: 'ORE', country: 'SE', adminLevel: 4 },
  { name: 'Gävleborgs län', code: 'GAV', country: 'SE', adminLevel: 4 },
  { name: 'Södermanlands län', code: 'SOD', country: 'SE', adminLevel: 4 },
  { name: 'Dalarnas län', code: 'DAL', country: 'SE', adminLevel: 4 },
  { name: 'Västmanlands län', code: 'VAS', country: 'SE', adminLevel: 4 },
  { name: 'Västerbottens län', code: 'VBT', country: 'SE', adminLevel: 4 },
  { name: 'Norrbottens län', code: 'NRB', country: 'SE', adminLevel: 4 },
  { name: 'Värmlands län', code: 'VRM', country: 'SE', adminLevel: 4 },
  { name: 'Kalmar län', code: 'KAL', country: 'SE', adminLevel: 4 },
  { name: 'Kronobergs län', code: 'KRO', country: 'SE', adminLevel: 4 },
  { name: 'Blekinge län', code: 'BLE', country: 'SE', adminLevel: 4 },
  { name: 'Västernorrlands län', code: 'VNR', country: 'SE', adminLevel: 4 },
  { name: 'Jämtlands län', code: 'JAM', country: 'SE', adminLevel: 4 },
  { name: 'Gotlands län', code: 'GOT', country: 'SE', adminLevel: 4 },
]

// Norway Counties (admin_level=4) - 11 counties (post-2020 reform)
const NORWAY_COUNTIES = [
  { name: 'Viken', code: 'VIK', country: 'NO', adminLevel: 4 },
  { name: 'Oslo', code: 'OSL', country: 'NO', adminLevel: 4 },
  { name: 'Rogaland', code: 'ROG', country: 'NO', adminLevel: 4 },
  { name: 'Vestland', code: 'VES', country: 'NO', adminLevel: 4 },
  { name: 'Trøndelag', code: 'TRO', country: 'NO', adminLevel: 4 },
  { name: 'Innlandet', code: 'INN', country: 'NO', adminLevel: 4 },
  { name: 'Vestfold og Telemark', code: 'VFT', country: 'NO', adminLevel: 4 },
  { name: 'Agder', code: 'AGD', country: 'NO', adminLevel: 4 },
  { name: 'Møre og Romsdal', code: 'MOR', country: 'NO', adminLevel: 4 },
  { name: 'Nordland', code: 'NOR', country: 'NO', adminLevel: 4 },
  { name: 'Troms og Finnmark', code: 'TRF', country: 'NO', adminLevel: 4 },
]

// Denmark Regions (admin_level=4) - 5 regions - use "Region " prefix
const DENMARK_REGIONS = [
  { name: 'Region Hovedstaden', code: 'HOV', country: 'DK', adminLevel: 4 },
  { name: 'Region Midtjylland', code: 'MID', country: 'DK', adminLevel: 4 },
  { name: 'Region Syddanmark', code: 'SYD', country: 'DK', adminLevel: 4 },
  { name: 'Region Nordjylland', code: 'NJY', country: 'DK', adminLevel: 4 },
  { name: 'Region Sjælland', code: 'SJA', country: 'DK', adminLevel: 4 },
]

// Finland Regions (admin_level=4) - 19 regions
const FINLAND_REGIONS = [
  { name: 'Uusimaa', code: 'UUS', country: 'FI', adminLevel: 4 },
  { name: 'Pirkanmaa', code: 'PIR', country: 'FI', adminLevel: 4 },
  { name: 'Varsinais-Suomi', code: 'VAR', country: 'FI', adminLevel: 4 },
  { name: 'Pohjois-Pohjanmaa', code: 'PPO', country: 'FI', adminLevel: 4 },
  { name: 'Keski-Suomi', code: 'KES', country: 'FI', adminLevel: 4 },
  { name: 'Satakunta', code: 'SAT', country: 'FI', adminLevel: 4 },
  { name: 'Pohjois-Savo', code: 'PSA', country: 'FI', adminLevel: 4 },
  { name: 'Päijät-Häme', code: 'PAH', country: 'FI', adminLevel: 4 },
  { name: 'Pohjanmaa', code: 'POH', country: 'FI', adminLevel: 4 },
  { name: 'Lappi', code: 'LAP', country: 'FI', adminLevel: 4 },
  { name: 'Etelä-Pohjanmaa', code: 'EPO', country: 'FI', adminLevel: 4 },
  { name: 'Kymenlaakso', code: 'KYM', country: 'FI', adminLevel: 4 },
  { name: 'Kanta-Häme', code: 'KAH', country: 'FI', adminLevel: 4 },
  { name: 'Etelä-Savo', code: 'ESA', country: 'FI', adminLevel: 4 },
  { name: 'Pohjois-Karjala', code: 'PKA', country: 'FI', adminLevel: 4 },
  { name: 'Etelä-Karjala', code: 'EKA', country: 'FI', adminLevel: 4 },
  { name: 'Kainuu', code: 'KAI', country: 'FI', adminLevel: 4 },
  { name: 'Keski-Pohjanmaa', code: 'KPO', country: 'FI', adminLevel: 4 },
  { name: 'Ahvenanmaa', code: 'AHV', country: 'FI', adminLevel: 4 },
]

// Ireland Provinces (admin_level=5) - 4 provinces
const IRELAND_PROVINCES = [
  { name: 'Leinster', code: 'LEI', country: 'IE', adminLevel: 5 },
  { name: 'Munster', code: 'MUN', country: 'IE', adminLevel: 5 },
  { name: 'Connacht', code: 'CON', country: 'IE', adminLevel: 5 },
  { name: 'Ulster', code: 'ULS', country: 'IE', adminLevel: 5 },
]

// Greece Regions (admin_level=5) - 13 regions - use "Περιφέρεια " prefix with genitive case
const GREECE_REGIONS = [
  { name: 'Περιφέρεια Αττικής', code: 'ATT', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Κεντρικής Μακεδονίας', code: 'KMK', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Θεσσαλίας', code: 'THE', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Δυτικής Ελλάδας', code: 'DEL', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Κρήτης', code: 'KRI', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Στερεάς Ελλάδας', code: 'STE', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Πελοποννήσου', code: 'PEL', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Ανατολικής Μακεδονίας και Θράκης', code: 'AMT', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Ηπείρου', code: 'EPI', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Δυτικής Μακεδονίας', code: 'DMK', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Νοτίου Αιγαίου', code: 'NAI', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Βόρειου Αιγαίου', code: 'BAI', country: 'GR', adminLevel: 5 },
  { name: 'Περιφέρεια Ιονίων Νήσων', code: 'ION', country: 'GR', adminLevel: 5 },
]

// Hungary Counties (admin_level=6) - 19 counties + Budapest - use " vármegye" suffix (except Budapest)
const HUNGARY_COUNTIES = [
  { name: 'Budapest', code: 'BUD', country: 'HU', adminLevel: 6 },
  { name: 'Pest vármegye', code: 'PES', country: 'HU', adminLevel: 6 },
  { name: 'Borsod-Abaúj-Zemplén vármegye', code: 'BAZ', country: 'HU', adminLevel: 6 },
  { name: 'Hajdú-Bihar vármegye', code: 'HAB', country: 'HU', adminLevel: 6 },
  { name: 'Szabolcs-Szatmár-Bereg vármegye', code: 'SSB', country: 'HU', adminLevel: 6 },
  { name: 'Bács-Kiskun vármegye', code: 'BAK', country: 'HU', adminLevel: 6 },
  { name: 'Győr-Moson-Sopron vármegye', code: 'GMS', country: 'HU', adminLevel: 6 },
  { name: 'Csongrád-Csanád vármegye', code: 'CSC', country: 'HU', adminLevel: 6 },
  { name: 'Fejér vármegye', code: 'FEJ', country: 'HU', adminLevel: 6 },
  { name: 'Jász-Nagykun-Szolnok vármegye', code: 'JNS', country: 'HU', adminLevel: 6 },
  { name: 'Baranya vármegye', code: 'BAR', country: 'HU', adminLevel: 6 },
  { name: 'Somogy vármegye', code: 'SOM', country: 'HU', adminLevel: 6 },
  { name: 'Veszprém vármegye', code: 'VES', country: 'HU', adminLevel: 6 },
  { name: 'Vas vármegye', code: 'VAS', country: 'HU', adminLevel: 6 },
  { name: 'Békés vármegye', code: 'BEK', country: 'HU', adminLevel: 6 },
  { name: 'Heves vármegye', code: 'HEV', country: 'HU', adminLevel: 6 },
  { name: 'Zala vármegye', code: 'ZAL', country: 'HU', adminLevel: 6 },
  { name: 'Tolna vármegye', code: 'TOL', country: 'HU', adminLevel: 6 },
  { name: 'Nógrád vármegye', code: 'NOG', country: 'HU', adminLevel: 6 },
  { name: 'Komárom-Esztergom vármegye', code: 'KOE', country: 'HU', adminLevel: 6 },
]

// Croatia Counties (admin_level=4) - 20 counties + Zagreb
const CROATIA_COUNTIES = [
  { name: 'Grad Zagreb', code: 'ZAG', country: 'HR', adminLevel: 4 },
  { name: 'Splitsko-dalmatinska županija', code: 'SPL', country: 'HR', adminLevel: 4 },
  { name: 'Zagrebačka županija', code: 'ZGZ', country: 'HR', adminLevel: 4 },
  { name: 'Primorsko-goranska županija', code: 'PGZ', country: 'HR', adminLevel: 4 },
  { name: 'Osječko-baranjska županija', code: 'OBZ', country: 'HR', adminLevel: 4 },
  { name: 'Istarska županija', code: 'IST', country: 'HR', adminLevel: 4 },
  { name: 'Vukovarsko-srijemska županija', code: 'VSZ', country: 'HR', adminLevel: 4 },
  { name: 'Zadarska županija', code: 'ZAD', country: 'HR', adminLevel: 4 },
  { name: 'Sisačko-moslavačka županija', code: 'SMZ', country: 'HR', adminLevel: 4 },
  { name: 'Varaždinska županija', code: 'VAR', country: 'HR', adminLevel: 4 },
  { name: 'Dubrovačko-neretvanska županija', code: 'DNZ', country: 'HR', adminLevel: 4 },
  { name: 'Brodsko-posavska županija', code: 'BPZ', country: 'HR', adminLevel: 4 },
  { name: 'Karlovačka županija', code: 'KAR', country: 'HR', adminLevel: 4 },
  { name: 'Koprivničko-križevačka županija', code: 'KKZ', country: 'HR', adminLevel: 4 },
  { name: 'Bjelovarsko-bilogorska županija', code: 'BBZ', country: 'HR', adminLevel: 4 },
  { name: 'Krapinsko-zagorska županija', code: 'KZZ', country: 'HR', adminLevel: 4 },
  { name: 'Šibensko-kninska županija', code: 'SKZ', country: 'HR', adminLevel: 4 },
  { name: 'Međimurska županija', code: 'MEZ', country: 'HR', adminLevel: 4 },
  { name: 'Požeško-slavonska županija', code: 'PSZ', country: 'HR', adminLevel: 4 },
  { name: 'Virovitičko-podravska županija', code: 'VPZ', country: 'HR', adminLevel: 4 },
  { name: 'Ličko-senjska županija', code: 'LSZ', country: 'HR', adminLevel: 4 },
]

// Romania Counties (admin_level=4) - 41 counties + Bucharest
const ROMANIA_COUNTIES = [
  { name: 'București', code: 'BUC', country: 'RO', adminLevel: 4 },
  { name: 'Cluj', code: 'CLJ', country: 'RO', adminLevel: 4 },
  { name: 'Timiș', code: 'TIM', country: 'RO', adminLevel: 4 },
  { name: 'Iași', code: 'IAS', country: 'RO', adminLevel: 4 },
  { name: 'Constanța', code: 'CST', country: 'RO', adminLevel: 4 },
  { name: 'Brașov', code: 'BRS', country: 'RO', adminLevel: 4 },
  { name: 'Prahova', code: 'PRH', country: 'RO', adminLevel: 4 },
  { name: 'Dolj', code: 'DOL', country: 'RO', adminLevel: 4 },
  { name: 'Argeș', code: 'ARG', country: 'RO', adminLevel: 4 },
  { name: 'Bacău', code: 'BAC', country: 'RO', adminLevel: 4 },
  { name: 'Bihor', code: 'BIH', country: 'RO', adminLevel: 4 },
  { name: 'Suceava', code: 'SUC', country: 'RO', adminLevel: 4 },
  { name: 'Galați', code: 'GAL', country: 'RO', adminLevel: 4 },
  { name: 'Mureș', code: 'MUR', country: 'RO', adminLevel: 4 },
  { name: 'Sibiu', code: 'SIB', country: 'RO', adminLevel: 4 },
  { name: 'Hunedoara', code: 'HUN', country: 'RO', adminLevel: 4 },
  { name: 'Arad', code: 'ARA', country: 'RO', adminLevel: 4 },
  { name: 'Maramureș', code: 'MAR', country: 'RO', adminLevel: 4 },
  { name: 'Neamț', code: 'NEA', country: 'RO', adminLevel: 4 },
  { name: 'Alba', code: 'ALB', country: 'RO', adminLevel: 4 },
  { name: 'Buzău', code: 'BUZ', country: 'RO', adminLevel: 4 },
  { name: 'Botoșani', code: 'BOT', country: 'RO', adminLevel: 4 },
  { name: 'Vâlcea', code: 'VLC', country: 'RO', adminLevel: 4 },
  { name: 'Dâmbovița', code: 'DAM', country: 'RO', adminLevel: 4 },
  { name: 'Olt', code: 'OLT', country: 'RO', adminLevel: 4 },
  { name: 'Satu Mare', code: 'SAT', country: 'RO', adminLevel: 4 },
  { name: 'Teleorman', code: 'TEL', country: 'RO', adminLevel: 4 },
  { name: 'Gorj', code: 'GOR', country: 'RO', adminLevel: 4 },
  { name: 'Vaslui', code: 'VAS', country: 'RO', adminLevel: 4 },
  { name: 'Vrancea', code: 'VRA', country: 'RO', adminLevel: 4 },
  { name: 'Brăila', code: 'BRA', country: 'RO', adminLevel: 4 },
  { name: 'Caraș-Severin', code: 'CRS', country: 'RO', adminLevel: 4 },
  { name: 'Mehedinți', code: 'MEH', country: 'RO', adminLevel: 4 },
  { name: 'Tulcea', code: 'TUL', country: 'RO', adminLevel: 4 },
  { name: 'Călărași', code: 'CAL', country: 'RO', adminLevel: 4 },
  { name: 'Giurgiu', code: 'GIU', country: 'RO', adminLevel: 4 },
  { name: 'Ialomița', code: 'IAL', country: 'RO', adminLevel: 4 },
  { name: 'Sălaj', code: 'SAL', country: 'RO', adminLevel: 4 },
  { name: 'Bistrița-Năsăud', code: 'BIS', country: 'RO', adminLevel: 4 },
  { name: 'Harghita', code: 'HAR', country: 'RO', adminLevel: 4 },
  { name: 'Covasna', code: 'COV', country: 'RO', adminLevel: 4 },
  { name: 'Ilfov', code: 'ILF', country: 'RO', adminLevel: 4 },
]

// Slovakia Regions (admin_level=4) - 8 kraje
const SLOVAKIA_REGIONS = [
  { name: 'Bratislavský kraj', code: 'BRA', country: 'SK', adminLevel: 4 },
  { name: 'Trnavský kraj', code: 'TRN', country: 'SK', adminLevel: 4 },
  { name: 'Trenčiansky kraj', code: 'TRE', country: 'SK', adminLevel: 4 },
  { name: 'Nitriansky kraj', code: 'NIT', country: 'SK', adminLevel: 4 },
  { name: 'Žilinský kraj', code: 'ZIL', country: 'SK', adminLevel: 4 },
  { name: 'Banskobystrický kraj', code: 'BAN', country: 'SK', adminLevel: 4 },
  { name: 'Prešovský kraj', code: 'PRE', country: 'SK', adminLevel: 4 },
  { name: 'Košický kraj', code: 'KOS', country: 'SK', adminLevel: 4 },
]

// Estonia Counties (admin_level=6) - 15 maakond
const ESTONIA_COUNTIES = [
  { name: 'Harju maakond', code: 'HAR', country: 'EE', adminLevel: 6 },
  { name: 'Tartu maakond', code: 'TAR', country: 'EE', adminLevel: 6 },
  { name: 'Ida-Viru maakond', code: 'IDA', country: 'EE', adminLevel: 6 },
  { name: 'Pärnu maakond', code: 'PAR', country: 'EE', adminLevel: 6 },
  { name: 'Lääne-Viru maakond', code: 'LVR', country: 'EE', adminLevel: 6 },
  { name: 'Viljandi maakond', code: 'VIL', country: 'EE', adminLevel: 6 },
  { name: 'Rapla maakond', code: 'RAP', country: 'EE', adminLevel: 6 },
  { name: 'Võru maakond', code: 'VOR', country: 'EE', adminLevel: 6 },
  { name: 'Saare maakond', code: 'SAA', country: 'EE', adminLevel: 6 },
  { name: 'Jõgeva maakond', code: 'JOG', country: 'EE', adminLevel: 6 },
  { name: 'Järva maakond', code: 'JAR', country: 'EE', adminLevel: 6 },
  { name: 'Valga maakond', code: 'VAL', country: 'EE', adminLevel: 6 },
  { name: 'Põlva maakond', code: 'POL', country: 'EE', adminLevel: 6 },
  { name: 'Lääne maakond', code: 'LAA', country: 'EE', adminLevel: 6 },
  { name: 'Hiiu maakond', code: 'HIU', country: 'EE', adminLevel: 6 },
]

// Latvia Regions (admin_level=5) - Major cities and regions
const LATVIA_REGIONS = [
  { name: 'Rīga', code: 'RIG', country: 'LV', adminLevel: 5 },
  { name: 'Daugavpils', code: 'DAU', country: 'LV', adminLevel: 5 },
  { name: 'Liepāja', code: 'LIE', country: 'LV', adminLevel: 5 },
  { name: 'Jelgava', code: 'JEL', country: 'LV', adminLevel: 5 },
  { name: 'Jūrmala', code: 'JUR', country: 'LV', adminLevel: 5 },
  { name: 'Ventspils', code: 'VEN', country: 'LV', adminLevel: 5 },
  { name: 'Rēzekne', code: 'REZ', country: 'LV', adminLevel: 5 },
  { name: 'Ogres novads', code: 'OGR', country: 'LV', adminLevel: 5 },
  { name: 'Valmieras novads', code: 'VAL', country: 'LV', adminLevel: 5 },
  { name: 'Jelgavas novads', code: 'JEV', country: 'LV', adminLevel: 5 },
  { name: 'Tukuma novads', code: 'TUK', country: 'LV', adminLevel: 5 },
  { name: 'Cēsu novads', code: 'CES', country: 'LV', adminLevel: 5 },
  { name: 'Saldus novads', code: 'SAL', country: 'LV', adminLevel: 5 },
  { name: 'Talsu novads', code: 'TAL', country: 'LV', adminLevel: 5 },
  { name: 'Bauskas novads', code: 'BAU', country: 'LV', adminLevel: 5 },
  { name: 'Siguldas novads', code: 'SIG', country: 'LV', adminLevel: 5 },
  { name: 'Dobeles novads', code: 'DOB', country: 'LV', adminLevel: 5 },
  { name: 'Kuldīgas novads', code: 'KUL', country: 'LV', adminLevel: 5 },
  { name: 'Limbažu novads', code: 'LIM', country: 'LV', adminLevel: 5 },
  { name: 'Madonas novads', code: 'MAD', country: 'LV', adminLevel: 5 },
]

// Lithuania Counties (admin_level=4) - 10 apskritys
const LITHUANIA_COUNTIES = [
  { name: 'Vilniaus apskritis', code: 'VIL', country: 'LT', adminLevel: 4 },
  { name: 'Kauno apskritis', code: 'KAU', country: 'LT', adminLevel: 4 },
  { name: 'Klaipėdos apskritis', code: 'KLA', country: 'LT', adminLevel: 4 },
  { name: 'Šiaulių apskritis', code: 'SIA', country: 'LT', adminLevel: 4 },
  { name: 'Panevėžio apskritis', code: 'PAN', country: 'LT', adminLevel: 4 },
  { name: 'Alytaus apskritis', code: 'ALY', country: 'LT', adminLevel: 4 },
  { name: 'Marijampolės apskritis', code: 'MAR', country: 'LT', adminLevel: 4 },
  { name: 'Tauragės apskritis', code: 'TAU', country: 'LT', adminLevel: 4 },
  { name: 'Telšių apskritis', code: 'TEL', country: 'LT', adminLevel: 4 },
  { name: 'Utenos apskritis', code: 'UTE', country: 'LT', adminLevel: 4 },
]

// Bulgaria Provinces (admin_level=4) - 28 oblasti (using Cyrillic names)
const BULGARIA_PROVINCES = [
  { name: 'София-град', code: 'SOF', country: 'BG', adminLevel: 4 },
  { name: 'Пловдив', code: 'PLO', country: 'BG', adminLevel: 4 },
  { name: 'Варна', code: 'VAR', country: 'BG', adminLevel: 4 },
  { name: 'Бургас', code: 'BUR', country: 'BG', adminLevel: 4 },
  { name: 'Стара Загора', code: 'STZ', country: 'BG', adminLevel: 4 },
  { name: 'Русе', code: 'RUS', country: 'BG', adminLevel: 4 },
  { name: 'Плевен', code: 'PLE', country: 'BG', adminLevel: 4 },
  { name: 'Благоевград', code: 'BLA', country: 'BG', adminLevel: 4 },
  { name: 'Велико Търново', code: 'VEL', country: 'BG', adminLevel: 4 },
  { name: 'Пазарджик', code: 'PAZ', country: 'BG', adminLevel: 4 },
  { name: 'Хасково', code: 'HAS', country: 'BG', adminLevel: 4 },
  { name: 'Шумен', code: 'SHU', country: 'BG', adminLevel: 4 },
  { name: 'Добрич', code: 'DOB', country: 'BG', adminLevel: 4 },
  { name: 'Сливен', code: 'SLI', country: 'BG', adminLevel: 4 },
  { name: 'Перник', code: 'PER', country: 'BG', adminLevel: 4 },
  { name: 'Ямбол', code: 'YAM', country: 'BG', adminLevel: 4 },
  { name: 'Враца', code: 'VRA', country: 'BG', adminLevel: 4 },
  { name: 'Кюстендил', code: 'KYU', country: 'BG', adminLevel: 4 },
  { name: 'Ловеч', code: 'LOV', country: 'BG', adminLevel: 4 },
  { name: 'Монтана', code: 'MON', country: 'BG', adminLevel: 4 },
  { name: 'Габрово', code: 'GAB', country: 'BG', adminLevel: 4 },
  { name: 'Кърджали', code: 'KAR', country: 'BG', adminLevel: 4 },
  { name: 'Разград', code: 'RAZ', country: 'BG', adminLevel: 4 },
  { name: 'Силистра', code: 'SIL', country: 'BG', adminLevel: 4 },
  { name: 'Смолян', code: 'SMO', country: 'BG', adminLevel: 4 },
  { name: 'Търговище', code: 'TAR', country: 'BG', adminLevel: 4 },
  { name: 'Видин', code: 'VID', country: 'BG', adminLevel: 4 },
  { name: 'Софийска', code: 'SOP', country: 'BG', adminLevel: 4 },
]

/**
 * Load progress from file
 */
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
    } catch {
      return { completed: {}, failed: {} }
    }
  }
  return { completed: {}, failed: {} }
}

/**
 * Save progress to file
 */
function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

/**
 * Run the import script for a single region
 */
function importRegion(regionName, regionCode, adminLevel, type = 'pizza', dryRun = false) {
  return new Promise((resolve, reject) => {
    const scriptName = type === 'pizza' ? 'import-osm-pizza.mjs' : 'import-osm-tacos.mjs'
    const args = [
      join(__dirname, scriptName),
      '--state', regionName,
      '--state-code', regionCode,
      '--admin-level', String(adminLevel)
    ]

    if (dryRun) {
      args.push('--dry-run')
    }

    const child = spawn(process.execPath, args, {
      stdio: ['inherit', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      // Extract the number of places from output
      const match = stdout.match(/New places to insert: (\d+)/)
      const count = match ? parseInt(match[1], 10) : 0

      // Consider success even with exit code 1 if we got results (dry run exits with 1)
      if (code === 0 || count > 0) {
        resolve(count)
      } else {
        reject(new Error(`Import failed with exit code ${code}: ${stderr}`))
      }
    })
  })
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  return {
    dryRun: args.includes('--dry-run'),
    reportOnly: args.includes('--report'),
    // Food type filters
    pizzaOnly: args.includes('--pizza-only'),
    tacosOnly: args.includes('--tacos-only'),
    // Wave 1 countries
    italyOnly: args.includes('--italy-only'),
    germanyOnly: args.includes('--germany-only'),
    franceOnly: args.includes('--france-only'),
    spainOnly: args.includes('--spain-only'),
    ukOnly: args.includes('--uk-only'),
    // Wave 2 countries
    netherlandsOnly: args.includes('--netherlands-only'),
    belgiumOnly: args.includes('--belgium-only'),
    austriaOnly: args.includes('--austria-only'),
    switzerlandOnly: args.includes('--switzerland-only'),
    polandOnly: args.includes('--poland-only'),
    portugalOnly: args.includes('--portugal-only'),
    czechOnly: args.includes('--czech-only'),
    swedenOnly: args.includes('--sweden-only'),
    norwayOnly: args.includes('--norway-only'),
    denmarkOnly: args.includes('--denmark-only'),
    finlandOnly: args.includes('--finland-only'),
    irelandOnly: args.includes('--ireland-only'),
    greeceOnly: args.includes('--greece-only'),
    hungaryOnly: args.includes('--hungary-only'),
    croatiaOnly: args.includes('--croatia-only'),
    romaniaOnly: args.includes('--romania-only'),
    // Wave 3 countries (Baltic + Central)
    slovakiaOnly: args.includes('--slovakia-only'),
    estoniaOnly: args.includes('--estonia-only'),
    latviaOnly: args.includes('--latvia-only'),
    lithuaniaOnly: args.includes('--lithuania-only'),
    bulgariaOnly: args.includes('--bulgaria-only'),
    // Wave filters
    wave1Only: args.includes('--wave1-only'),
    wave2Only: args.includes('--wave2-only'),
    wave3Only: args.includes('--wave3-only'),
    limit: (() => {
      const limitArg = args.find(a => a.startsWith('--limit='))
      return limitArg ? parseInt(limitArg.split('=')[1], 10) : null
    })()
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate progress report
 */
function generateReport(progress) {
  console.log('\n' + '='.repeat(60))
  console.log('EUROPEAN IMPORT PROGRESS REPORT')
  console.log('='.repeat(60))

  const completedKeys = Object.keys(progress.completed)
  const failedKeys = Object.keys(progress.failed)

  // Group by country
  const byCountry = {}
  for (const key of completedKeys) {
    const { country, count } = progress.completed[key]
    if (!byCountry[country]) byCountry[country] = { count: 0, places: 0 }
    byCountry[country].count++
    byCountry[country].places += count
  }

  console.log(`\nCompleted: ${completedKeys.length} regions`)
  if (Object.keys(byCountry).length > 0) {
    for (const [country, stats] of Object.entries(byCountry)) {
      console.log(`  ${country}: ${stats.count} regions, ${stats.places} places`)
    }
    const totalPlaces = Object.values(byCountry).reduce((sum, s) => sum + s.places, 0)
    console.log(`  Total places imported: ${totalPlaces}`)
  }

  console.log(`\nFailed: ${failedKeys.length}`)
  if (failedKeys.length > 0) {
    for (const key of failedKeys) {
      const { error, region } = progress.failed[key]
      console.log(`  ${key}: ${region} - ${error}`)
    }
  }

  console.log('')
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  console.log('='.repeat(60))
  console.log('EUROPEAN PIZZA & TACO IMPORT')
  console.log('='.repeat(60))
  console.log('')

  // Load progress
  const progress = loadProgress()

  // Report-only mode
  if (options.reportOnly) {
    generateReport(progress)
    return
  }

  // Determine which country filters are active
  const wave1Filters = options.italyOnly || options.germanyOnly ||
                       options.franceOnly || options.spainOnly || options.ukOnly
  const wave2Filters = options.netherlandsOnly || options.belgiumOnly ||
                       options.austriaOnly || options.switzerlandOnly ||
                       options.polandOnly || options.portugalOnly ||
                       options.czechOnly || options.swedenOnly ||
                       options.norwayOnly || options.denmarkOnly ||
                       options.finlandOnly || options.irelandOnly ||
                       options.greeceOnly || options.hungaryOnly ||
                       options.croatiaOnly || options.romaniaOnly
  const wave3Filters = options.slovakiaOnly || options.estoniaOnly ||
                       options.latviaOnly || options.lithuaniaOnly ||
                       options.bulgariaOnly
  const hasCountryFilter = wave1Filters || wave2Filters || wave3Filters ||
                           options.wave1Only || options.wave2Only || options.wave3Only

  // Helper to check if country should be included (wave: 1, 2, or 3)
  const shouldInclude = (countryFlag, wave) => {
    if (!hasCountryFilter) return true
    if (countryFlag) return true
    if (wave === 1 && options.wave1Only) return true
    if (wave === 2 && options.wave2Only) return true
    if (wave === 3 && options.wave3Only) return true
    return false
  }

  // Build list of imports to run
  const imports = []

  // Helper to add regions for both food types
  const addRegions = (regions) => {
    for (const region of regions) {
      if (!options.tacosOnly) {
        const key = `${region.country}-${region.code}-pizza`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'pizza', key })
        }
      }
      if (!options.pizzaOnly) {
        const key = `${region.country}-${region.code}-tacos`
        if (!progress.completed[key]) {
          imports.push({ ...region, type: 'tacos', key })
        }
      }
    }
  }

  // ============== WAVE 1 COUNTRIES ==============

  // Add Italian regions
  if (shouldInclude(options.italyOnly, 1)) {
    addRegions(ITALIAN_REGIONS)
  }

  // Add German states
  if (shouldInclude(options.germanyOnly, 1)) {
    addRegions(GERMAN_STATES)
  }

  // Add French regions
  if (shouldInclude(options.franceOnly, 1)) {
    addRegions(FRENCH_REGIONS)
  }

  // Add Spanish communities
  if (shouldInclude(options.spainOnly, 1)) {
    addRegions(SPANISH_COMMUNITIES)
  }

  // Add UK countries
  if (shouldInclude(options.ukOnly, 1)) {
    addRegions(UK_COUNTRIES)
  }

  // ============== WAVE 2 COUNTRIES ==============

  // Add Netherlands provinces
  if (shouldInclude(options.netherlandsOnly, 2)) {
    addRegions(NETHERLANDS_PROVINCES)
  }

  // Add Belgium regions
  if (shouldInclude(options.belgiumOnly, 2)) {
    addRegions(BELGIUM_REGIONS)
  }

  // Add Austria states
  if (shouldInclude(options.austriaOnly, 2)) {
    addRegions(AUSTRIA_STATES)
  }

  // Add Switzerland cantons
  if (shouldInclude(options.switzerlandOnly, 2)) {
    addRegions(SWITZERLAND_CANTONS)
  }

  // Add Poland voivodeships
  if (shouldInclude(options.polandOnly, 2)) {
    addRegions(POLAND_VOIVODESHIPS)
  }

  // Add Portugal districts
  if (shouldInclude(options.portugalOnly, 2)) {
    addRegions(PORTUGAL_DISTRICTS)
  }

  // Add Czech regions
  if (shouldInclude(options.czechOnly, 2)) {
    addRegions(CZECH_REGIONS)
  }

  // Add Sweden counties
  if (shouldInclude(options.swedenOnly, 2)) {
    addRegions(SWEDEN_COUNTIES)
  }

  // Add Norway counties
  if (shouldInclude(options.norwayOnly, 2)) {
    addRegions(NORWAY_COUNTIES)
  }

  // Add Denmark regions
  if (shouldInclude(options.denmarkOnly, 2)) {
    addRegions(DENMARK_REGIONS)
  }

  // Add Finland regions
  if (shouldInclude(options.finlandOnly, 2)) {
    addRegions(FINLAND_REGIONS)
  }

  // Add Ireland provinces
  if (shouldInclude(options.irelandOnly, 2)) {
    addRegions(IRELAND_PROVINCES)
  }

  // Add Greece regions
  if (shouldInclude(options.greeceOnly, 2)) {
    addRegions(GREECE_REGIONS)
  }

  // Add Hungary counties
  if (shouldInclude(options.hungaryOnly, 2)) {
    addRegions(HUNGARY_COUNTIES)
  }

  // Add Croatia counties
  if (shouldInclude(options.croatiaOnly, 2)) {
    addRegions(CROATIA_COUNTIES)
  }

  // Add Romania counties
  if (shouldInclude(options.romaniaOnly, 2)) {
    addRegions(ROMANIA_COUNTIES)
  }

  // ============== WAVE 3 COUNTRIES (Baltic + Central) ==============

  // Add Slovakia regions
  if (shouldInclude(options.slovakiaOnly, 3)) {
    addRegions(SLOVAKIA_REGIONS)
  }

  // Add Estonia counties
  if (shouldInclude(options.estoniaOnly, 3)) {
    addRegions(ESTONIA_COUNTIES)
  }

  // Add Latvia regions
  if (shouldInclude(options.latviaOnly, 3)) {
    addRegions(LATVIA_REGIONS)
  }

  // Add Lithuania counties
  if (shouldInclude(options.lithuaniaOnly, 3)) {
    addRegions(LITHUANIA_COUNTIES)
  }

  // Add Bulgaria provinces
  if (shouldInclude(options.bulgariaOnly, 3)) {
    addRegions(BULGARIA_PROVINCES)
  }

  if (imports.length === 0) {
    console.log('All regions have been processed!')
    generateReport(progress)
    return
  }

  // Apply limit if specified
  let toProcess = imports
  if (options.limit && options.limit > 0) {
    toProcess = imports.slice(0, options.limit)
    console.log(`Limiting to ${options.limit} imports`)
  }

  console.log(`Imports to process: ${toProcess.length}`)
  console.log(`Already completed: ${Object.keys(progress.completed).length}`)
  console.log('')

  if (options.dryRun) {
    console.log('=== DRY RUN MODE (no changes will be made) ===\n')
  }

  const startTime = Date.now()
  let processedCount = 0
  let currentDelay = 60000 // Start with 60 seconds

  for (const item of toProcess) {
    processedCount++
    const progressStr = `[${processedCount}/${toProcess.length}]`

    console.log('')
    console.log('='.repeat(60))
    console.log(`${progressStr} Importing ${item.type.toUpperCase()} from ${item.name} (${item.code}, ${item.country})`)
    console.log('='.repeat(60))

    try {
      // Wait for rate limit (skip first one)
      if (processedCount > 1) {
        const waitTime = Math.round(currentDelay / 1000)
        console.log(`Waiting ${waitTime} seconds before next request...`)
        await sleep(currentDelay)
      }

      // Import the region
      const count = await importRegion(item.name, item.code, item.adminLevel, item.type, options.dryRun)

      // Mark as complete
      progress.completed[item.key] = {
        region: item.name,
        code: item.code,
        country: item.country,
        type: item.type,
        adminLevel: item.adminLevel,
        count,
        timestamp: new Date().toISOString()
      }
      delete progress.failed[item.key]

      // Success - can reduce delay slightly
      currentDelay = Math.max(60000, currentDelay * 0.9)

      console.log(`\n[OK] ${item.name} (${item.country}, ${item.type}): ${count} places`)

    } catch (error) {
      console.error(`\n[ERROR] ${item.name} (${item.country}, ${item.type}): ${error.message}`)

      // Mark as failed
      progress.failed[item.key] = {
        region: item.name,
        code: item.code,
        country: item.country,
        type: item.type,
        error: error.message,
        timestamp: new Date().toISOString()
      }

      // Check for rate limiting
      if (error.message.includes('429') || error.message.includes('rate limit')) {
        currentDelay = Math.min(300000, currentDelay * 2)
        console.log('Rate limited - increasing delay...')
      } else if (error.message.includes('503') || error.message.includes('unavailable')) {
        currentDelay = Math.min(300000, currentDelay * 1.5)
        console.log('Service unavailable - increasing delay...')
      }
    }

    // Save progress after each import
    saveProgress(progress)

    // Show elapsed time
    const elapsed = Date.now() - startTime
    console.log(`\nElapsed time: ${formatDuration(elapsed)}`)
  }

  // Final report
  const totalTime = Date.now() - startTime
  console.log('')
  console.log('='.repeat(60))
  console.log(`IMPORT COMPLETE - Total time: ${formatDuration(totalTime)}`)
  console.log('='.repeat(60))

  generateReport(progress)
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
