#!/usr/bin/env node
/**
 * Import Latin American Regions - 19 Countries
 *
 * Imports pizza AND taco places from Central and South American countries using OpenStreetMap.
 * Uses progress tracking for resume capability and rate limiting to respect API limits.
 *
 * Wave 1: Brazil, Argentina, Colombia, Chile (largest markets)
 * Wave 2: Peru, Venezuela, Ecuador, Mexico*, Central America
 * Wave 3: Bolivia, Paraguay, Uruguay, Guyana, Suriname
 *
 * * Note: Mexico is handled by import-international.mjs
 *
 * Usage:
 *   node scripts/import-latin-america.mjs --dry-run             # Preview all imports
 *   node scripts/import-latin-america.mjs --report              # Show progress report only
 *   node scripts/import-latin-america.mjs --limit=5             # Only process 5 regions
 *
 * Food type filters:
 *   node scripts/import-latin-america.mjs --pizza-only          # Import only pizza places
 *   node scripts/import-latin-america.mjs --tacos-only          # Import only taco places
 *
 * Wave filters:
 *   node scripts/import-latin-america.mjs --wave1-only          # Import only Wave 1 countries
 *   node scripts/import-latin-america.mjs --wave2-only          # Import only Wave 2 countries
 *   node scripts/import-latin-america.mjs --wave3-only          # Import only Wave 3 countries
 *
 * Region filters:
 *   node scripts/import-latin-america.mjs --central-america-only  # Central America only
 *   node scripts/import-latin-america.mjs --south-america-only    # South America only
 *
 * Country filters (South America):
 *   --brazil-only, --argentina-only, --colombia-only, --chile-only
 *   --peru-only, --venezuela-only, --ecuador-only
 *   --bolivia-only, --paraguay-only, --uruguay-only
 *   --guyana-only, --suriname-only
 *
 * Country filters (Central America):
 *   --guatemala-only, --honduras-only, --el-salvador-only, --nicaragua-only
 *   --costa-rica-only, --panama-only, --belize-only
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Progress file for tracking
const PROGRESS_FILE = join(__dirname, '.latin-america-import-progress.json')

// ============== WAVE 1: MAJOR MARKETS ==============

// Brazil States (admin_level=4) - 26 states + Federal District - Portuguese names
const BRAZIL_STATES = [
  { name: 'São Paulo', code: 'SP', country: 'BR', adminLevel: 4 },
  { name: 'Minas Gerais', code: 'MG', country: 'BR', adminLevel: 4 },
  { name: 'Rio de Janeiro', code: 'RJ', country: 'BR', adminLevel: 4 },
  { name: 'Bahia', code: 'BA', country: 'BR', adminLevel: 4 },
  { name: 'Rio Grande do Sul', code: 'RS', country: 'BR', adminLevel: 4 },
  { name: 'Paraná', code: 'PR', country: 'BR', adminLevel: 4 },
  { name: 'Pernambuco', code: 'PE', country: 'BR', adminLevel: 4 },
  { name: 'Ceará', code: 'CE', country: 'BR', adminLevel: 4 },
  { name: 'Pará', code: 'PA', country: 'BR', adminLevel: 4 },
  { name: 'Santa Catarina', code: 'SC', country: 'BR', adminLevel: 4 },
  { name: 'Maranhão', code: 'MA', country: 'BR', adminLevel: 4 },
  { name: 'Goiás', code: 'GO', country: 'BR', adminLevel: 4 },
  { name: 'Amazonas', code: 'AM', country: 'BR', adminLevel: 4 },
  { name: 'Espírito Santo', code: 'ES', country: 'BR', adminLevel: 4 },
  { name: 'Paraíba', code: 'PB', country: 'BR', adminLevel: 4 },
  { name: 'Rio Grande do Norte', code: 'RN', country: 'BR', adminLevel: 4 },
  { name: 'Mato Grosso', code: 'MT', country: 'BR', adminLevel: 4 },
  { name: 'Alagoas', code: 'AL', country: 'BR', adminLevel: 4 },
  { name: 'Piauí', code: 'PI', country: 'BR', adminLevel: 4 },
  { name: 'Distrito Federal', code: 'DF', country: 'BR', adminLevel: 4 },
  { name: 'Mato Grosso do Sul', code: 'MS', country: 'BR', adminLevel: 4 },
  { name: 'Sergipe', code: 'SE', country: 'BR', adminLevel: 4 },
  { name: 'Rondônia', code: 'RO', country: 'BR', adminLevel: 4 },
  { name: 'Tocantins', code: 'TO', country: 'BR', adminLevel: 4 },
  { name: 'Acre', code: 'AC', country: 'BR', adminLevel: 4 },
  { name: 'Amapá', code: 'AP', country: 'BR', adminLevel: 4 },
  { name: 'Roraima', code: 'RR', country: 'BR', adminLevel: 4 },
]

// Argentina Provinces (admin_level=4) - 23 provinces + Buenos Aires City - Spanish names
const ARGENTINA_PROVINCES = [
  { name: 'Buenos Aires', code: 'B', country: 'AR', adminLevel: 4 },
  { name: 'Ciudad Autónoma de Buenos Aires', code: 'C', country: 'AR', adminLevel: 4 },
  { name: 'Córdoba', code: 'X', country: 'AR', adminLevel: 4 },
  { name: 'Santa Fe', code: 'S', country: 'AR', adminLevel: 4 },
  { name: 'Mendoza', code: 'M', country: 'AR', adminLevel: 4 },
  { name: 'Tucumán', code: 'T', country: 'AR', adminLevel: 4 },
  { name: 'Entre Ríos', code: 'E', country: 'AR', adminLevel: 4 },
  { name: 'Salta', code: 'A', country: 'AR', adminLevel: 4 },
  { name: 'Misiones', code: 'N', country: 'AR', adminLevel: 4 },
  { name: 'Chaco', code: 'H', country: 'AR', adminLevel: 4 },
  { name: 'Corrientes', code: 'W', country: 'AR', adminLevel: 4 },
  { name: 'Santiago del Estero', code: 'G', country: 'AR', adminLevel: 4 },
  { name: 'San Juan', code: 'J', country: 'AR', adminLevel: 4 },
  { name: 'Jujuy', code: 'Y', country: 'AR', adminLevel: 4 },
  { name: 'Río Negro', code: 'R', country: 'AR', adminLevel: 4 },
  { name: 'Neuquén', code: 'Q', country: 'AR', adminLevel: 4 },
  { name: 'Formosa', code: 'P', country: 'AR', adminLevel: 4 },
  { name: 'Chubut', code: 'U', country: 'AR', adminLevel: 4 },
  { name: 'San Luis', code: 'D', country: 'AR', adminLevel: 4 },
  { name: 'Catamarca', code: 'K', country: 'AR', adminLevel: 4 },
  { name: 'La Rioja', code: 'F', country: 'AR', adminLevel: 4 },
  { name: 'La Pampa', code: 'L', country: 'AR', adminLevel: 4 },
  { name: 'Santa Cruz', code: 'Z', country: 'AR', adminLevel: 4 },
  { name: 'Tierra del Fuego', code: 'V', country: 'AR', adminLevel: 4 },
]

// Colombia Departments (admin_level=4) - 32 departments + Capital District - Spanish names
const COLOMBIA_DEPARTMENTS = [
  { name: 'Bogotá', code: 'DC', country: 'CO', adminLevel: 4 },
  { name: 'Antioquia', code: 'ANT', country: 'CO', adminLevel: 4 },
  { name: 'Valle del Cauca', code: 'VAC', country: 'CO', adminLevel: 4 },
  { name: 'Cundinamarca', code: 'CUN', country: 'CO', adminLevel: 4 },
  { name: 'Atlántico', code: 'ATL', country: 'CO', adminLevel: 4 },
  { name: 'Santander', code: 'SAN', country: 'CO', adminLevel: 4 },
  { name: 'Bolívar', code: 'BOL', country: 'CO', adminLevel: 4 },
  { name: 'Nariño', code: 'NAR', country: 'CO', adminLevel: 4 },
  { name: 'Córdoba', code: 'COR', country: 'CO', adminLevel: 4 },
  { name: 'Tolima', code: 'TOL', country: 'CO', adminLevel: 4 },
  { name: 'Cauca', code: 'CAU', country: 'CO', adminLevel: 4 },
  { name: 'Norte de Santander', code: 'NSA', country: 'CO', adminLevel: 4 },
  { name: 'Boyacá', code: 'BOY', country: 'CO', adminLevel: 4 },
  { name: 'Magdalena', code: 'MAG', country: 'CO', adminLevel: 4 },
  { name: 'Huila', code: 'HUI', country: 'CO', adminLevel: 4 },
  { name: 'Cesar', code: 'CES', country: 'CO', adminLevel: 4 },
  { name: 'Risaralda', code: 'RIS', country: 'CO', adminLevel: 4 },
  { name: 'Meta', code: 'MET', country: 'CO', adminLevel: 4 },
  { name: 'Caldas', code: 'CAL', country: 'CO', adminLevel: 4 },
  { name: 'La Guajira', code: 'LAG', country: 'CO', adminLevel: 4 },
  { name: 'Sucre', code: 'SUC', country: 'CO', adminLevel: 4 },
  { name: 'Quindío', code: 'QUI', country: 'CO', adminLevel: 4 },
  { name: 'Chocó', code: 'CHO', country: 'CO', adminLevel: 4 },
  { name: 'Caquetá', code: 'CAQ', country: 'CO', adminLevel: 4 },
  { name: 'Casanare', code: 'CAS', country: 'CO', adminLevel: 4 },
  { name: 'Putumayo', code: 'PUT', country: 'CO', adminLevel: 4 },
  { name: 'Arauca', code: 'ARA', country: 'CO', adminLevel: 4 },
  { name: 'Amazonas', code: 'AMA', country: 'CO', adminLevel: 4 },
  { name: 'Guaviare', code: 'GUV', country: 'CO', adminLevel: 4 },
  { name: 'Vichada', code: 'VID', country: 'CO', adminLevel: 4 },
  { name: 'Guainía', code: 'GUA', country: 'CO', adminLevel: 4 },
  { name: 'Vaupés', code: 'VAU', country: 'CO', adminLevel: 4 },
  { name: 'San Andrés y Providencia', code: 'SAP', country: 'CO', adminLevel: 4 },
]

// Chile Regions (admin_level=4) - 16 regions - Spanish names
const CHILE_REGIONS = [
  { name: 'Región Metropolitana de Santiago', code: 'RM', country: 'CL', adminLevel: 4 },
  { name: 'Valparaíso', code: 'VS', country: 'CL', adminLevel: 4 },
  { name: 'Biobío', code: 'BI', country: 'CL', adminLevel: 4 },
  { name: 'Maule', code: 'ML', country: 'CL', adminLevel: 4 },
  { name: "Libertador General Bernardo O'Higgins", code: 'LI', country: 'CL', adminLevel: 4 },
  { name: 'Araucanía', code: 'AR', country: 'CL', adminLevel: 4 },
  { name: 'Los Lagos', code: 'LG', country: 'CL', adminLevel: 4 },
  { name: 'Coquimbo', code: 'CO', country: 'CL', adminLevel: 4 },
  { name: 'Antofagasta', code: 'AN', country: 'CL', adminLevel: 4 },
  { name: 'Los Ríos', code: 'LR', country: 'CL', adminLevel: 4 },
  { name: 'Tarapacá', code: 'TA', country: 'CL', adminLevel: 4 },
  { name: 'Atacama', code: 'AT', country: 'CL', adminLevel: 4 },
  { name: 'Ñuble', code: 'NB', country: 'CL', adminLevel: 4 },
  { name: 'Arica y Parinacota', code: 'AP', country: 'CL', adminLevel: 4 },
  { name: 'Aysén del General Carlos Ibáñez del Campo', code: 'AI', country: 'CL', adminLevel: 4 },
  { name: 'Magallanes y Antártica Chilena', code: 'MA', country: 'CL', adminLevel: 4 },
]

// ============== WAVE 2: SECONDARY MARKETS ==============

// Peru Departments (admin_level=4) - 25 departments - Spanish names
const PERU_DEPARTMENTS = [
  { name: 'Lima', code: 'LIM', country: 'PE', adminLevel: 4 },
  { name: 'La Libertad', code: 'LAL', country: 'PE', adminLevel: 4 },
  { name: 'Piura', code: 'PIU', country: 'PE', adminLevel: 4 },
  { name: 'Cajamarca', code: 'CAJ', country: 'PE', adminLevel: 4 },
  { name: 'Puno', code: 'PUN', country: 'PE', adminLevel: 4 },
  { name: 'Junín', code: 'JUN', country: 'PE', adminLevel: 4 },
  { name: 'Cusco', code: 'CUS', country: 'PE', adminLevel: 4 },
  { name: 'Arequipa', code: 'ARE', country: 'PE', adminLevel: 4 },
  { name: 'Lambayeque', code: 'LAM', country: 'PE', adminLevel: 4 },
  { name: 'Áncash', code: 'ANC', country: 'PE', adminLevel: 4 },
  { name: 'Loreto', code: 'LOR', country: 'PE', adminLevel: 4 },
  { name: 'Huánuco', code: 'HUC', country: 'PE', adminLevel: 4 },
  { name: 'San Martín', code: 'SAM', country: 'PE', adminLevel: 4 },
  { name: 'Ica', code: 'ICA', country: 'PE', adminLevel: 4 },
  { name: 'Ayacucho', code: 'AYA', country: 'PE', adminLevel: 4 },
  { name: 'Huancavelica', code: 'HUV', country: 'PE', adminLevel: 4 },
  { name: 'Ucayali', code: 'UCA', country: 'PE', adminLevel: 4 },
  { name: 'Apurímac', code: 'APU', country: 'PE', adminLevel: 4 },
  { name: 'Amazonas', code: 'AMA', country: 'PE', adminLevel: 4 },
  { name: 'Tacna', code: 'TAC', country: 'PE', adminLevel: 4 },
  { name: 'Pasco', code: 'PAS', country: 'PE', adminLevel: 4 },
  { name: 'Tumbes', code: 'TUM', country: 'PE', adminLevel: 4 },
  { name: 'Moquegua', code: 'MOQ', country: 'PE', adminLevel: 4 },
  { name: 'Madre de Dios', code: 'MDD', country: 'PE', adminLevel: 4 },
  { name: 'Callao', code: 'CAL', country: 'PE', adminLevel: 4 },
]

// Venezuela States (admin_level=4) - 23 states + Capital District - Spanish names
const VENEZUELA_STATES = [
  { name: 'Distrito Capital', code: 'DF', country: 'VE', adminLevel: 4 },
  { name: 'Zulia', code: 'ZU', country: 'VE', adminLevel: 4 },
  { name: 'Miranda', code: 'MI', country: 'VE', adminLevel: 4 },
  { name: 'Carabobo', code: 'CA', country: 'VE', adminLevel: 4 },
  { name: 'Lara', code: 'LA', country: 'VE', adminLevel: 4 },
  { name: 'Aragua', code: 'AR', country: 'VE', adminLevel: 4 },
  { name: 'Bolívar', code: 'BO', country: 'VE', adminLevel: 4 },
  { name: 'Anzoátegui', code: 'AN', country: 'VE', adminLevel: 4 },
  { name: 'Táchira', code: 'TA', country: 'VE', adminLevel: 4 },
  { name: 'Mérida', code: 'ME', country: 'VE', adminLevel: 4 },
  { name: 'Falcón', code: 'FA', country: 'VE', adminLevel: 4 },
  { name: 'Barinas', code: 'BA', country: 'VE', adminLevel: 4 },
  { name: 'Monagas', code: 'MO', country: 'VE', adminLevel: 4 },
  { name: 'Trujillo', code: 'TR', country: 'VE', adminLevel: 4 },
  { name: 'Portuguesa', code: 'PO', country: 'VE', adminLevel: 4 },
  { name: 'Guárico', code: 'GU', country: 'VE', adminLevel: 4 },
  { name: 'Sucre', code: 'SU', country: 'VE', adminLevel: 4 },
  { name: 'Yaracuy', code: 'YA', country: 'VE', adminLevel: 4 },
  { name: 'Nueva Esparta', code: 'NE', country: 'VE', adminLevel: 4 },
  { name: 'Cojedes', code: 'CO', country: 'VE', adminLevel: 4 },
  { name: 'Apure', code: 'AP', country: 'VE', adminLevel: 4 },
  { name: 'Delta Amacuro', code: 'DA', country: 'VE', adminLevel: 4 },
  { name: 'Vargas', code: 'VA', country: 'VE', adminLevel: 4 },
  { name: 'Amazonas', code: 'AM', country: 'VE', adminLevel: 4 },
  { name: 'Dependencias Federales', code: 'DP', country: 'VE', adminLevel: 4 },
]

// Ecuador Provinces (admin_level=4) - 24 provinces - Spanish names
const ECUADOR_PROVINCES = [
  { name: 'Guayas', code: 'GY', country: 'EC', adminLevel: 4 },
  { name: 'Pichincha', code: 'PC', country: 'EC', adminLevel: 4 },
  { name: 'Manabí', code: 'MN', country: 'EC', adminLevel: 4 },
  { name: 'Los Ríos', code: 'LR', country: 'EC', adminLevel: 4 },
  { name: 'Azuay', code: 'AZ', country: 'EC', adminLevel: 4 },
  { name: 'El Oro', code: 'EO', country: 'EC', adminLevel: 4 },
  { name: 'Esmeraldas', code: 'ES', country: 'EC', adminLevel: 4 },
  { name: 'Tungurahua', code: 'TU', country: 'EC', adminLevel: 4 },
  { name: 'Chimborazo', code: 'CB', country: 'EC', adminLevel: 4 },
  { name: 'Imbabura', code: 'IM', country: 'EC', adminLevel: 4 },
  { name: 'Cotopaxi', code: 'CT', country: 'EC', adminLevel: 4 },
  { name: 'Loja', code: 'LJ', country: 'EC', adminLevel: 4 },
  { name: 'Santo Domingo de los Tsáchilas', code: 'SD', country: 'EC', adminLevel: 4 },
  { name: 'Santa Elena', code: 'SE', country: 'EC', adminLevel: 4 },
  { name: 'Bolívar', code: 'BO', country: 'EC', adminLevel: 4 },
  { name: 'Carchi', code: 'CR', country: 'EC', adminLevel: 4 },
  { name: 'Cañar', code: 'CN', country: 'EC', adminLevel: 4 },
  { name: 'Sucumbíos', code: 'SU', country: 'EC', adminLevel: 4 },
  { name: 'Orellana', code: 'OR', country: 'EC', adminLevel: 4 },
  { name: 'Napo', code: 'NA', country: 'EC', adminLevel: 4 },
  { name: 'Pastaza', code: 'PA', country: 'EC', adminLevel: 4 },
  { name: 'Morona-Santiago', code: 'MS', country: 'EC', adminLevel: 4 },
  { name: 'Zamora-Chinchipe', code: 'ZC', country: 'EC', adminLevel: 4 },
  { name: 'Galápagos', code: 'GA', country: 'EC', adminLevel: 4 },
]

// ============== WAVE 2: CENTRAL AMERICA ==============

// Guatemala Departments (admin_level=4) - 22 departments - Spanish names
const GUATEMALA_DEPARTMENTS = [
  { name: 'Guatemala', code: 'GU', country: 'GT', adminLevel: 4 },
  { name: 'Alta Verapaz', code: 'AV', country: 'GT', adminLevel: 4 },
  { name: 'Huehuetenango', code: 'HU', country: 'GT', adminLevel: 4 },
  { name: 'Quiché', code: 'QC', country: 'GT', adminLevel: 4 },
  { name: 'San Marcos', code: 'SM', country: 'GT', adminLevel: 4 },
  { name: 'Quetzaltenango', code: 'QZ', country: 'GT', adminLevel: 4 },
  { name: 'Escuintla', code: 'ES', country: 'GT', adminLevel: 4 },
  { name: 'Petén', code: 'PE', country: 'GT', adminLevel: 4 },
  { name: 'Chimaltenango', code: 'CM', country: 'GT', adminLevel: 4 },
  { name: 'Suchitepéquez', code: 'SU', country: 'GT', adminLevel: 4 },
  { name: 'Jutiapa', code: 'JU', country: 'GT', adminLevel: 4 },
  { name: 'Totonicapán', code: 'TO', country: 'GT', adminLevel: 4 },
  { name: 'Izabal', code: 'IZ', country: 'GT', adminLevel: 4 },
  { name: 'Sololá', code: 'SO', country: 'GT', adminLevel: 4 },
  { name: 'Santa Rosa', code: 'SR', country: 'GT', adminLevel: 4 },
  { name: 'Retalhuleu', code: 'RE', country: 'GT', adminLevel: 4 },
  { name: 'Jalapa', code: 'JA', country: 'GT', adminLevel: 4 },
  { name: 'Chiquimula', code: 'CQ', country: 'GT', adminLevel: 4 },
  { name: 'Baja Verapaz', code: 'BV', country: 'GT', adminLevel: 4 },
  { name: 'Zacapa', code: 'ZA', country: 'GT', adminLevel: 4 },
  { name: 'Sacatepéquez', code: 'SA', country: 'GT', adminLevel: 4 },
  { name: 'El Progreso', code: 'PR', country: 'GT', adminLevel: 4 },
]

// Honduras Departments (admin_level=4) - 18 departments - Spanish names
const HONDURAS_DEPARTMENTS = [
  { name: 'Francisco Morazán', code: 'FM', country: 'HN', adminLevel: 4 },
  { name: 'Cortés', code: 'CR', country: 'HN', adminLevel: 4 },
  { name: 'Yoro', code: 'YO', country: 'HN', adminLevel: 4 },
  { name: 'Olancho', code: 'OL', country: 'HN', adminLevel: 4 },
  { name: 'Comayagua', code: 'CM', country: 'HN', adminLevel: 4 },
  { name: 'Choluteca', code: 'CH', country: 'HN', adminLevel: 4 },
  { name: 'Atlántida', code: 'AT', country: 'HN', adminLevel: 4 },
  { name: 'Copán', code: 'CP', country: 'HN', adminLevel: 4 },
  { name: 'Santa Bárbara', code: 'SB', country: 'HN', adminLevel: 4 },
  { name: 'Lempira', code: 'LE', country: 'HN', adminLevel: 4 },
  { name: 'El Paraíso', code: 'EP', country: 'HN', adminLevel: 4 },
  { name: 'La Paz', code: 'LP', country: 'HN', adminLevel: 4 },
  { name: 'Intibucá', code: 'IN', country: 'HN', adminLevel: 4 },
  { name: 'Colón', code: 'CL', country: 'HN', adminLevel: 4 },
  { name: 'Valle', code: 'VA', country: 'HN', adminLevel: 4 },
  { name: 'Ocotepeque', code: 'OC', country: 'HN', adminLevel: 4 },
  { name: 'Gracias a Dios', code: 'GD', country: 'HN', adminLevel: 4 },
  { name: 'Islas de la Bahía', code: 'IB', country: 'HN', adminLevel: 4 },
]

// El Salvador Departments (admin_level=4) - 14 departments - Spanish names
const EL_SALVADOR_DEPARTMENTS = [
  { name: 'San Salvador', code: 'SS', country: 'SV', adminLevel: 4 },
  { name: 'La Libertad', code: 'LI', country: 'SV', adminLevel: 4 },
  { name: 'Santa Ana', code: 'SA', country: 'SV', adminLevel: 4 },
  { name: 'San Miguel', code: 'SM', country: 'SV', adminLevel: 4 },
  { name: 'Sonsonate', code: 'SO', country: 'SV', adminLevel: 4 },
  { name: 'Usulután', code: 'US', country: 'SV', adminLevel: 4 },
  { name: 'Ahuachapán', code: 'AH', country: 'SV', adminLevel: 4 },
  { name: 'La Unión', code: 'UN', country: 'SV', adminLevel: 4 },
  { name: 'La Paz', code: 'PA', country: 'SV', adminLevel: 4 },
  { name: 'Chalatenango', code: 'CH', country: 'SV', adminLevel: 4 },
  { name: 'Cuscatlán', code: 'CU', country: 'SV', adminLevel: 4 },
  { name: 'San Vicente', code: 'SV', country: 'SV', adminLevel: 4 },
  { name: 'Cabañas', code: 'CA', country: 'SV', adminLevel: 4 },
  { name: 'Morazán', code: 'MO', country: 'SV', adminLevel: 4 },
]

// Nicaragua Departments (admin_level=4) - 15 departments + 2 autonomous regions - Spanish names
const NICARAGUA_DEPARTMENTS = [
  { name: 'Managua', code: 'MN', country: 'NI', adminLevel: 4 },
  { name: 'Matagalpa', code: 'MT', country: 'NI', adminLevel: 4 },
  { name: 'León', code: 'LE', country: 'NI', adminLevel: 4 },
  { name: 'Chinandega', code: 'CI', country: 'NI', adminLevel: 4 },
  { name: 'Masaya', code: 'MS', country: 'NI', adminLevel: 4 },
  { name: 'Granada', code: 'GR', country: 'NI', adminLevel: 4 },
  { name: 'Estelí', code: 'ES', country: 'NI', adminLevel: 4 },
  { name: 'Jinotega', code: 'JI', country: 'NI', adminLevel: 4 },
  { name: 'Chontales', code: 'CO', country: 'NI', adminLevel: 4 },
  { name: 'Rivas', code: 'RI', country: 'NI', adminLevel: 4 },
  { name: 'Carazo', code: 'CA', country: 'NI', adminLevel: 4 },
  { name: 'Nueva Segovia', code: 'NS', country: 'NI', adminLevel: 4 },
  { name: 'Boaco', code: 'BO', country: 'NI', adminLevel: 4 },
  { name: 'Madriz', code: 'MD', country: 'NI', adminLevel: 4 },
  { name: 'Río San Juan', code: 'SJ', country: 'NI', adminLevel: 4 },
  { name: 'Región Autónoma del Caribe Norte', code: 'AN', country: 'NI', adminLevel: 4 },
  { name: 'Región Autónoma del Caribe Sur', code: 'AS', country: 'NI', adminLevel: 4 },
]

// Costa Rica Provinces (admin_level=4) - 7 provinces - Spanish names
const COSTA_RICA_PROVINCES = [
  { name: 'San José', code: 'SJ', country: 'CR', adminLevel: 4 },
  { name: 'Alajuela', code: 'AL', country: 'CR', adminLevel: 4 },
  { name: 'Cartago', code: 'CA', country: 'CR', adminLevel: 4 },
  { name: 'Heredia', code: 'HE', country: 'CR', adminLevel: 4 },
  { name: 'Guanacaste', code: 'GU', country: 'CR', adminLevel: 4 },
  { name: 'Puntarenas', code: 'PU', country: 'CR', adminLevel: 4 },
  { name: 'Limón', code: 'LI', country: 'CR', adminLevel: 4 },
]

// Panama Provinces (admin_level=4) - 10 provinces + 3 comarcas - Spanish names
const PANAMA_PROVINCES = [
  { name: 'Panamá', code: 'PM', country: 'PA', adminLevel: 4 },
  { name: 'Panamá Oeste', code: 'PO', country: 'PA', adminLevel: 4 },
  { name: 'Chiriquí', code: 'CH', country: 'PA', adminLevel: 4 },
  { name: 'Colón', code: 'CL', country: 'PA', adminLevel: 4 },
  { name: 'Coclé', code: 'CC', country: 'PA', adminLevel: 4 },
  { name: 'Veraguas', code: 'VE', country: 'PA', adminLevel: 4 },
  { name: 'Herrera', code: 'HE', country: 'PA', adminLevel: 4 },
  { name: 'Los Santos', code: 'LS', country: 'PA', adminLevel: 4 },
  { name: 'Bocas del Toro', code: 'BT', country: 'PA', adminLevel: 4 },
  { name: 'Darién', code: 'DA', country: 'PA', adminLevel: 4 },
  { name: 'Emberá', code: 'EM', country: 'PA', adminLevel: 4 },
  { name: 'Guna Yala', code: 'KY', country: 'PA', adminLevel: 4 },
  { name: 'Ngäbe-Buglé', code: 'NB', country: 'PA', adminLevel: 4 },
]

// Belize Districts (admin_level=4) - 6 districts - English names
const BELIZE_DISTRICTS = [
  { name: 'Belize', code: 'BZ', country: 'BZ', adminLevel: 4 },
  { name: 'Cayo', code: 'CY', country: 'BZ', adminLevel: 4 },
  { name: 'Orange Walk', code: 'OW', country: 'BZ', adminLevel: 4 },
  { name: 'Corozal', code: 'CZ', country: 'BZ', adminLevel: 4 },
  { name: 'Stann Creek', code: 'SC', country: 'BZ', adminLevel: 4 },
  { name: 'Toledo', code: 'TO', country: 'BZ', adminLevel: 4 },
]

// ============== WAVE 3: SMALLER MARKETS ==============

// Bolivia Departments (admin_level=4) - 9 departments - Spanish names
const BOLIVIA_DEPARTMENTS = [
  { name: 'Santa Cruz', code: 'SC', country: 'BO', adminLevel: 4 },
  { name: 'La Paz', code: 'LP', country: 'BO', adminLevel: 4 },
  { name: 'Cochabamba', code: 'CB', country: 'BO', adminLevel: 4 },
  { name: 'Potosí', code: 'PO', country: 'BO', adminLevel: 4 },
  { name: 'Chuquisaca', code: 'CQ', country: 'BO', adminLevel: 4 },
  { name: 'Oruro', code: 'OR', country: 'BO', adminLevel: 4 },
  { name: 'Tarija', code: 'TR', country: 'BO', adminLevel: 4 },
  { name: 'El Beni', code: 'EB', country: 'BO', adminLevel: 4 },
  { name: 'Pando', code: 'PA', country: 'BO', adminLevel: 4 },
]

// Paraguay Departments (admin_level=4) - 17 departments + Capital - Spanish names
const PARAGUAY_DEPARTMENTS = [
  { name: 'Asunción', code: 'ASU', country: 'PY', adminLevel: 4 },
  { name: 'Central', code: 'CE', country: 'PY', adminLevel: 4 },
  { name: 'Alto Paraná', code: 'AA', country: 'PY', adminLevel: 4 },
  { name: 'Itapúa', code: 'IT', country: 'PY', adminLevel: 4 },
  { name: 'Caaguazú', code: 'CG', country: 'PY', adminLevel: 4 },
  { name: 'San Pedro', code: 'SP', country: 'PY', adminLevel: 4 },
  { name: 'Cordillera', code: 'CR', country: 'PY', adminLevel: 4 },
  { name: 'Paraguarí', code: 'PG', country: 'PY', adminLevel: 4 },
  { name: 'Guairá', code: 'GU', country: 'PY', adminLevel: 4 },
  { name: 'Concepción', code: 'CN', country: 'PY', adminLevel: 4 },
  { name: 'Canindeyú', code: 'CY', country: 'PY', adminLevel: 4 },
  { name: 'Caazapá', code: 'CZ', country: 'PY', adminLevel: 4 },
  { name: 'Amambay', code: 'AM', country: 'PY', adminLevel: 4 },
  { name: 'Misiones', code: 'MI', country: 'PY', adminLevel: 4 },
  { name: 'Ñeembucú', code: 'NE', country: 'PY', adminLevel: 4 },
  { name: 'Presidente Hayes', code: 'PH', country: 'PY', adminLevel: 4 },
  { name: 'Alto Paraguay', code: 'AG', country: 'PY', adminLevel: 4 },
  { name: 'Boquerón', code: 'BQ', country: 'PY', adminLevel: 4 },
]

// Uruguay Departments (admin_level=4) - 19 departments - Spanish names
const URUGUAY_DEPARTMENTS = [
  { name: 'Montevideo', code: 'MO', country: 'UY', adminLevel: 4 },
  { name: 'Canelones', code: 'CA', country: 'UY', adminLevel: 4 },
  { name: 'Maldonado', code: 'MA', country: 'UY', adminLevel: 4 },
  { name: 'Salto', code: 'SA', country: 'UY', adminLevel: 4 },
  { name: 'Colonia', code: 'CO', country: 'UY', adminLevel: 4 },
  { name: 'Paysandú', code: 'PA', country: 'UY', adminLevel: 4 },
  { name: 'San José', code: 'SJ', country: 'UY', adminLevel: 4 },
  { name: 'Rivera', code: 'RV', country: 'UY', adminLevel: 4 },
  { name: 'Soriano', code: 'SO', country: 'UY', adminLevel: 4 },
  { name: 'Tacuarembó', code: 'TA', country: 'UY', adminLevel: 4 },
  { name: 'Cerro Largo', code: 'CL', country: 'UY', adminLevel: 4 },
  { name: 'Rocha', code: 'RO', country: 'UY', adminLevel: 4 },
  { name: 'Artigas', code: 'AR', country: 'UY', adminLevel: 4 },
  { name: 'Florida', code: 'FD', country: 'UY', adminLevel: 4 },
  { name: 'Lavalleja', code: 'LA', country: 'UY', adminLevel: 4 },
  { name: 'Durazno', code: 'DU', country: 'UY', adminLevel: 4 },
  { name: 'Río Negro', code: 'RN', country: 'UY', adminLevel: 4 },
  { name: 'Treinta y Tres', code: 'TT', country: 'UY', adminLevel: 4 },
  { name: 'Flores', code: 'FS', country: 'UY', adminLevel: 4 },
]

// Guyana Regions (admin_level=4) - 10 regions - English names
const GUYANA_REGIONS = [
  { name: 'Demerara-Mahaica', code: 'DE', country: 'GY', adminLevel: 4 },
  { name: 'East Berbice-Corentyne', code: 'EB', country: 'GY', adminLevel: 4 },
  { name: 'Essequibo Islands-West Demerara', code: 'ES', country: 'GY', adminLevel: 4 },
  { name: 'Mahaica-Berbice', code: 'MA', country: 'GY', adminLevel: 4 },
  { name: 'Pomeroon-Supenaam', code: 'PM', country: 'GY', adminLevel: 4 },
  { name: 'Upper Demerara-Berbice', code: 'UD', country: 'GY', adminLevel: 4 },
  { name: 'Cuyuni-Mazaruni', code: 'CU', country: 'GY', adminLevel: 4 },
  { name: 'Potaro-Siparuni', code: 'PT', country: 'GY', adminLevel: 4 },
  { name: 'Upper Takutu-Upper Essequibo', code: 'UT', country: 'GY', adminLevel: 4 },
  { name: 'Barima-Waini', code: 'BA', country: 'GY', adminLevel: 4 },
]

// Suriname Districts (admin_level=4) - 10 districts - Dutch names
const SURINAME_DISTRICTS = [
  { name: 'Paramaribo', code: 'PM', country: 'SR', adminLevel: 4 },
  { name: 'Wanica', code: 'WA', country: 'SR', adminLevel: 4 },
  { name: 'Nickerie', code: 'NI', country: 'SR', adminLevel: 4 },
  { name: 'Para', code: 'PR', country: 'SR', adminLevel: 4 },
  { name: 'Commewijne', code: 'CM', country: 'SR', adminLevel: 4 },
  { name: 'Marowijne', code: 'MA', country: 'SR', adminLevel: 4 },
  { name: 'Saramacca', code: 'SA', country: 'SR', adminLevel: 4 },
  { name: 'Brokopondo', code: 'BR', country: 'SR', adminLevel: 4 },
  { name: 'Coronie', code: 'CR', country: 'SR', adminLevel: 4 },
  { name: 'Sipaliwini', code: 'SI', country: 'SR', adminLevel: 4 },
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
    // Region filters
    centralAmericaOnly: args.includes('--central-america-only'),
    southAmericaOnly: args.includes('--south-america-only'),
    // Wave 1 countries (major markets)
    brazilOnly: args.includes('--brazil-only'),
    argentinaOnly: args.includes('--argentina-only'),
    colombiaOnly: args.includes('--colombia-only'),
    chileOnly: args.includes('--chile-only'),
    // Wave 2 countries (secondary)
    peruOnly: args.includes('--peru-only'),
    venezuelaOnly: args.includes('--venezuela-only'),
    ecuadorOnly: args.includes('--ecuador-only'),
    // Wave 2 Central America
    guatemalaOnly: args.includes('--guatemala-only'),
    hondurasOnly: args.includes('--honduras-only'),
    elSalvadorOnly: args.includes('--el-salvador-only'),
    nicaraguaOnly: args.includes('--nicaragua-only'),
    costaRicaOnly: args.includes('--costa-rica-only'),
    panamaOnly: args.includes('--panama-only'),
    belizeOnly: args.includes('--belize-only'),
    // Wave 3 countries (smaller)
    boliviaOnly: args.includes('--bolivia-only'),
    paraguayOnly: args.includes('--paraguay-only'),
    uruguayOnly: args.includes('--uruguay-only'),
    guyanaOnly: args.includes('--guyana-only'),
    surinameOnly: args.includes('--suriname-only'),
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
  console.log('LATIN AMERICA IMPORT PROGRESS REPORT')
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
  console.log('LATIN AMERICA PIZZA & TACO IMPORT')
  console.log('19 Countries | Central & South America')
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
  const wave1Filters = options.brazilOnly || options.argentinaOnly ||
                       options.colombiaOnly || options.chileOnly
  const wave2Filters = options.peruOnly || options.venezuelaOnly || options.ecuadorOnly ||
                       options.guatemalaOnly || options.hondurasOnly || options.elSalvadorOnly ||
                       options.nicaraguaOnly || options.costaRicaOnly || options.panamaOnly ||
                       options.belizeOnly
  const wave3Filters = options.boliviaOnly || options.paraguayOnly || options.uruguayOnly ||
                       options.guyanaOnly || options.surinameOnly
  const centralAmericaCountries = options.guatemalaOnly || options.hondurasOnly ||
                                   options.elSalvadorOnly || options.nicaraguaOnly ||
                                   options.costaRicaOnly || options.panamaOnly || options.belizeOnly
  const hasCountryFilter = wave1Filters || wave2Filters || wave3Filters ||
                           options.wave1Only || options.wave2Only || options.wave3Only ||
                           options.centralAmericaOnly || options.southAmericaOnly

  // Helper to check if country should be included
  const shouldInclude = (countryFlag, wave, isCentralAmerica = false) => {
    if (!hasCountryFilter) return true
    if (countryFlag) return true
    if (wave === 1 && options.wave1Only) return true
    if (wave === 2 && options.wave2Only) return true
    if (wave === 3 && options.wave3Only) return true
    if (isCentralAmerica && options.centralAmericaOnly) return true
    if (!isCentralAmerica && options.southAmericaOnly) return true
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

  // ============== WAVE 1: MAJOR MARKETS ==============

  if (shouldInclude(options.brazilOnly, 1)) {
    addRegions(BRAZIL_STATES)
  }

  if (shouldInclude(options.argentinaOnly, 1)) {
    addRegions(ARGENTINA_PROVINCES)
  }

  if (shouldInclude(options.colombiaOnly, 1)) {
    addRegions(COLOMBIA_DEPARTMENTS)
  }

  if (shouldInclude(options.chileOnly, 1)) {
    addRegions(CHILE_REGIONS)
  }

  // ============== WAVE 2: SECONDARY MARKETS ==============

  if (shouldInclude(options.peruOnly, 2)) {
    addRegions(PERU_DEPARTMENTS)
  }

  if (shouldInclude(options.venezuelaOnly, 2)) {
    addRegions(VENEZUELA_STATES)
  }

  if (shouldInclude(options.ecuadorOnly, 2)) {
    addRegions(ECUADOR_PROVINCES)
  }

  // ============== WAVE 2: CENTRAL AMERICA ==============

  if (shouldInclude(options.guatemalaOnly, 2, true)) {
    addRegions(GUATEMALA_DEPARTMENTS)
  }

  if (shouldInclude(options.hondurasOnly, 2, true)) {
    addRegions(HONDURAS_DEPARTMENTS)
  }

  if (shouldInclude(options.elSalvadorOnly, 2, true)) {
    addRegions(EL_SALVADOR_DEPARTMENTS)
  }

  if (shouldInclude(options.nicaraguaOnly, 2, true)) {
    addRegions(NICARAGUA_DEPARTMENTS)
  }

  if (shouldInclude(options.costaRicaOnly, 2, true)) {
    addRegions(COSTA_RICA_PROVINCES)
  }

  if (shouldInclude(options.panamaOnly, 2, true)) {
    addRegions(PANAMA_PROVINCES)
  }

  if (shouldInclude(options.belizeOnly, 2, true)) {
    addRegions(BELIZE_DISTRICTS)
  }

  // ============== WAVE 3: SMALLER MARKETS ==============

  if (shouldInclude(options.boliviaOnly, 3)) {
    addRegions(BOLIVIA_DEPARTMENTS)
  }

  if (shouldInclude(options.paraguayOnly, 3)) {
    addRegions(PARAGUAY_DEPARTMENTS)
  }

  if (shouldInclude(options.uruguayOnly, 3)) {
    addRegions(URUGUAY_DEPARTMENTS)
  }

  if (shouldInclude(options.guyanaOnly, 3)) {
    addRegions(GUYANA_REGIONS)
  }

  if (shouldInclude(options.surinameOnly, 3)) {
    addRegions(SURINAME_DISTRICTS)
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
  let currentDelay = 30000 // Start with 30 seconds (reduced from 60s)

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
