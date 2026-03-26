// California sales tax rates by county for SCWS service area
// Source: CDTFA / Avalara (as of 2026)
// Note: These are COUNTY-LEVEL minimum rates. Some cities within counties
// may have additional district taxes. For SCWS billing purposes, we use
// the county rate since most work is in unincorporated areas.

export const COUNTY_TAX_RATES: Record<string, number> = {
  'San Diego': 7.75,
  'Riverside': 7.75,
  'San Bernardino': 7.75,
  'Orange': 7.75,
  'Los Angeles': 9.50,
  'Imperial': 8.75,
};

// Map cities to counties for SCWS service area
export const CITY_TO_COUNTY: Record<string, string> = {
  // San Diego County
  'Ramona': 'San Diego',
  'Valley Center': 'San Diego',
  'Escondido': 'San Diego',
  'Julian': 'San Diego',
  'Alpine': 'San Diego',
  'Poway': 'San Diego',
  'San Diego': 'San Diego',
  'Fallbrook': 'San Diego',
  'Lakeside': 'San Diego',
  'Santee': 'San Diego',
  'El Cajon': 'San Diego',
  'La Mesa': 'San Diego',
  'Encinitas': 'San Diego',
  'Carlsbad': 'San Diego',
  'Oceanside': 'San Diego',
  'Vista': 'San Diego',
  'San Marcos': 'San Diego',
  'Bonsall': 'San Diego',
  'Borrego Springs': 'San Diego',
  'Boulevard': 'San Diego',
  'Campo': 'San Diego',
  'Descanso': 'San Diego',
  'Dulzura': 'San Diego',
  'Guatay': 'San Diego',
  'Jacumba': 'San Diego',
  'Jamul': 'San Diego',
  'Mount Laguna': 'San Diego',
  'Pauma Valley': 'San Diego',
  'Pine Valley': 'San Diego',
  'Potrero': 'San Diego',
  'Ranchita': 'San Diego',
  'Rancho Santa Fe': 'San Diego',
  'Santa Ysabel': 'San Diego',
  'Tecate': 'San Diego',
  'Warner Springs': 'San Diego',
  'Wynola': 'San Diego',
  'Palomar Mountain': 'San Diego',
  'Coronado': 'San Diego',
  'National City': 'San Diego',
  'Chula Vista': 'San Diego',
  'Spring Valley': 'San Diego',
  'Lemon Grove': 'San Diego',
  'Del Mar': 'San Diego',
  'Solana Beach': 'San Diego',
  'Rancho Bernardo': 'San Diego',
  'Pala': 'San Diego',
  
  // Riverside County
  'Temecula': 'Riverside',
  'Murrieta': 'Riverside',
  'Winchester': 'Riverside',
  'Hemet': 'Riverside',
  'San Jacinto': 'Riverside',
  'Anza': 'Riverside',
  'Aguanga': 'Riverside',
  'Idyllwild': 'Riverside',
  'Palm Desert': 'Riverside',
  'Palm Springs': 'Riverside',
  'Riverside': 'Riverside',
  'Corona': 'Riverside',
  'Perris': 'Riverside',
  'Menifee': 'Riverside',
  'Lake Elsinore': 'Riverside',
  'Wildomar': 'Riverside',
  'Fallbrook': 'San Diego', // Fallbrook is SD County
  'Garner Valley': 'Riverside',
  'Mountain Center': 'Riverside',
  'Sage': 'Riverside',
  'Banning': 'Riverside',
  'Beaumont': 'Riverside',
  'Indio': 'Riverside',
  'La Quinta': 'Riverside',
  'Coachella': 'Riverside',
  'Desert Hot Springs': 'Riverside',
  'Cathedral City': 'Riverside',
  'Rancho Mirage': 'Riverside',
  'Indian Wells': 'Riverside',
  'Thermal': 'Riverside',
  'Mecca': 'Riverside',
  'Nuevo': 'Riverside',
  'French Valley': 'Riverside',
  'Sun City': 'Riverside',
  'Valle Vista': 'Riverside',
  'East Hemet': 'Riverside',
  'De Luz': 'Riverside',
  
  // San Bernardino County
  'Victorville': 'San Bernardino',
  'Apple Valley': 'San Bernardino',
  'Hesperia': 'San Bernardino',
  'Lake Arrowhead': 'San Bernardino',
  'Big Bear': 'San Bernardino',
  'Big Bear Lake': 'San Bernardino',
  'Yucaipa': 'San Bernardino',
  'Yucca Valley': 'San Bernardino',
  'Joshua Tree': 'San Bernardino',
  'Twentynine Palms': 'San Bernardino',
  'Lucerne Valley': 'San Bernardino',
  'Phelan': 'San Bernardino',
  'Wrightwood': 'San Bernardino',
  'Running Springs': 'San Bernardino',
  'Crestline': 'San Bernardino',
  'Cedar Glen': 'San Bernardino',
  'Rimforest': 'San Bernardino',
  'San Bernardino': 'San Bernardino',
  'Redlands': 'San Bernardino',
  'Highland': 'San Bernardino',
  'Loma Linda': 'San Bernardino',
  'Fontana': 'San Bernardino',
  'Rialto': 'San Bernardino',
  'Ontario': 'San Bernardino',
  'Rancho Cucamonga': 'San Bernardino',
  'Upland': 'San Bernardino',
  'Oak Hills': 'San Bernardino',
  'Pinon Hills': 'San Bernardino',
  'Pioneertown': 'San Bernardino',
  'Morongo Valley': 'San Bernardino',
};

// Default rate for unknown locations (San Diego County rate)
export const DEFAULT_TAX_RATE = 7.75;

/**
 * Get tax rate based on city name
 * Returns county-level tax rate for the city
 */
export function getTaxRateByCity(city: string | null | undefined): number {
  if (!city) return DEFAULT_TAX_RATE;
  
  // Normalize city name
  const normalized = city.trim();
  
  // Direct match
  const county = CITY_TO_COUNTY[normalized];
  if (county) {
    return COUNTY_TAX_RATES[county] || DEFAULT_TAX_RATE;
  }
  
  // Case-insensitive match
  const lowerCity = normalized.toLowerCase();
  for (const [mappedCity, mappedCounty] of Object.entries(CITY_TO_COUNTY)) {
    if (mappedCity.toLowerCase() === lowerCity) {
      return COUNTY_TAX_RATES[mappedCounty] || DEFAULT_TAX_RATE;
    }
  }
  
  return DEFAULT_TAX_RATE;
}

/**
 * Get county name from city
 */
export function getCountyByCity(city: string | null | undefined): string | null {
  if (!city) return null;
  
  const normalized = city.trim();
  const county = CITY_TO_COUNTY[normalized];
  if (county) return county;
  
  const lowerCity = normalized.toLowerCase();
  for (const [mappedCity, mappedCounty] of Object.entries(CITY_TO_COUNTY)) {
    if (mappedCity.toLowerCase() === lowerCity) {
      return mappedCounty;
    }
  }
  
  return null;
}
