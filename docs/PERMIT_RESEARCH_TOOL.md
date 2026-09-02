# Well Permit Plot Map Tool

Interactive visual plot map generator for well drilling permit applications. Creates professional maps showing parcel boundaries, existing wells, septic systems, and required setbacks. **Now with auto-fill permit application PDFs!**

## Features

### 🔍 Search Options
- **Address** - Enter any address with Google Maps autocomplete
- **APN** - Direct search by Assessor Parcel Number (XXX-XXX-XX-XX format)
- **GPS Coordinates** - Enter latitude/longitude directly

### 📝 Permit Application Generator (NEW!)
Auto-fills official county permit application PDFs:
- **San Diego County** - DEH Water Well Permit Application
- **Riverside County** - Environmental Health Well Application
- Pre-fills: Owner info, property data, well specs, SCWS contractor info
- Download ready-to-submit PDF

### 🗺️ Visual Plot Map
Full-screen interactive map with:
- **Satellite/Hybrid imagery** - Best for permit applications
- **Parcel boundary** - Green outline from County GIS
- **Existing wells** - Blue markers with depth labels from CA DWR
- **Septic system markers** - User-placeable tank and leach field markers
- **Setback zones** - 100ft circles around septic, 50ft from property lines
- **North arrow & scale bar** - Built into Google Maps
- **Legend** - Clear identification of all map elements

### 🎛️ Layer Controls
Toggle visibility of:
- Parcel boundary
- Well markers
- Septic markers
- Setback zones
- Labels

### 📍 Manual Septic Placement
Since septic records aren't available via API, users can:
1. Click "Tank" or "Leach Field" button
2. Click on map to place marker
3. 100ft setback circle automatically appears
4. Multiple markers supported
5. Delete markers as needed

### 🖨️ Print / PDF Export
- Click "Print / PDF" button
- Optimized for landscape printing
- Includes:
  - North arrow
  - APN/property info
  - Data source attribution
  - Setback distances
  - Disclaimer text

## Usage

1. **Navigate to**: `/permits/research` (or "Permit Research" in sidebar under Operations)

2. **Search for property**:
   - Enter address, APN, or coordinates
   - County picker defaults to **Auto-detect** (Census / Nominatim county name)
   - Manual override for San Diego, Riverside, or San Bernardino only
   - Addresses outside those three counties return FLAG: county not supported (no San Diego default)
   - Click Search

3. **Add septic location** (if known):
   - Click "Tank" button
   - Click on map where tank is located
   - Repeat for "Leach Field" if applicable
   - 100ft setback circle appears automatically

4. **Review the map**:
   - Green line = property boundary
   - Blue markers = existing wells (from DWR records)
   - Orange/purple markers = septic system
   - Red circles = 100ft no-drill zone from septic

5. **Generate Permit Application**:
   - Click "Generate Permit Application" button
   - Fill in proposed well details (depth, diameter, purpose)
   - Enter/verify customer information
   - Choose **"Official County Form"** to auto-fill the actual DEH permit PDF
   - Or choose **"Summary PDF"** for SCWS-formatted summary
   - Download filled PDF ready for submission

6. **Export Plot Map**:
   - Click "Print / PDF" to open browser print dialog
   - Select "Save as PDF" for digital copy
   - Include with permit application

## Data Sources

| Data | Source | Status |
|------|--------|--------|
| Parcel boundaries | San Diego / Riverside County GIS | ✅ Live API |
| Owner information | County Assessor | ✅ Live API |
| Existing wells | CA DWR Well Completion Reports | ✅ Live API |
| Septic location | Manual entry | 👤 User input |
| Zoning | County Assessor | ✅ Basic data |

## API Endpoints

### POST /api/permits/research
Search for property and well data.
```json
{
  "apn": "123-456-78-90",
  "address": "123 Main St, Escondido, CA",
  "county": "san_diego",
  "lat": 33.1234,
  "lng": -117.5678
}
```

### POST /api/permits/generate-pdf
Generate filled county permit application PDF.
```json
{
  "county": "san_diego",
  "owner": {
    "name": "John Doe",
    "address": "123 Main St",
    "city": "Escondido",
    "state": "CA",
    "zip": "92025",
    "phone": "(760) 555-1234",
    "email": "john@example.com"
  },
  "property": {
    "apn": "123-456-78-90",
    "siteAddress": "456 Well Lane",
    "city": "Valley Center",
    "state": "CA",
    "zip": "92082",
    "latitude": "33.1234",
    "longitude": "-117.5678"
  },
  "proposedWell": {
    "purpose": "domestic_drinking",
    "workType": "new",
    "depth": "400",
    "boreholeDiameter": "8"
  }
}
```
Returns: Filled PDF file download

### GET/POST /api/permits/reports
Save and retrieve research reports linked to customers/jobs.

## Setback Requirements

County-specific (FLAG the source on the plot plan):
- **San Diego** — tank 50 ft / leach 100 ft / PL 10 ft (Bulletin 74 + typical DEH plot-plan practice; Chapter 4 has no numeric PL)
- **Riverside** — tank 100 ft / leach 100 ft / PL 50 ft (Ordinance 682.6)
- **San Bernardino** — tank 100 ft / leach 100 ft / PL 5 ft (EHS Minimum Setbacks / LAMP 3.1; well-to-PL not published in § 33.0638)

*Always verify current requirements with the county environmental health department.*

## Database Tables

Run migration `migrations/002_permit_research_cache.sql` to create:
- `permit_research_cache` - Caches API results for 30 days
- `permit_research_reports` - Stores saved reports

## Technical Notes

### Google Maps Configuration
Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with:
- Maps JavaScript API
- Places API
- Geocoding API

### ArcGIS REST API Endpoints

**San Diego County Parcels (public, token-free):**
```
https://gis-public.sandiegocounty.gov/arcgis/rest/services/cosd_warehouse/parcels_all_for_public_use/MapServer/0
```

**Riverside County Parcels (MMC Parcels, Public — live fields APN / SITUS_STREET / FULL_SITUS_ADDRESS / ACREAGE / CLASS_CODE):**
```
https://gis.countyofriverside.us/arcgis/rest/services/mmc/mmc_mSrvc/MapServer/8
```
Address points: `.../MapServer/4` (HOUSE_NUMBER, STREET_NAME, APN).
OWTS points (not tank/leach polygons): `.../MapServer/30`.
Well permit points: `.../MapServer/33`.

**San Bernardino County Parcels:**
```
https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0
```
Building footprints (2021): `.../2D_Building_Footprints_2021/FeatureServer/0`. OwnerName may be redacted (CA Gov Code 7928.205).

**CA DWR Well Completion Reports:**
```
https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0
```

## County Permit Forms

The tool auto-fills official county permit application PDFs:

### San Diego County
- Form: Water Well Permit Application (DEH/LWQD)
- Source: https://www.sandiegocounty.gov/content/dam/sdc/deh/lwqd/Water%20Well%20Application.pdf
- Stored at: `/public/forms/san-diego-well-permit.pdf`

### Riverside County  
- Form: Monitoring/Water Well Application (EPO-243)
- Source: https://rivcoeh.org/wells
- Stored at: `/public/forms/riverside-well-permit.pdf`

### San Bernardino County
- Form: Application for Well Permit (official blank — not a filled mapping)
- Source: https://ehs.sbcounty.gov/wp-content/uploads/sites/97/Programs/WaterAndWaste/well-permit-application.pdf
- Stored at: `/public/forms/san-bernardino-well-permit.pdf`

### Updating Forms
If the county updates their permit forms:
1. Download the new PDF from the county website
2. Replace the file in `/public/forms/`
3. Update field mappings in `/src/app/api/permits/generate-pdf/route.ts`

## SCWS Company Info
The contractor info is currently hardcoded in the API. To update:
- Edit `SCWS_INFO` object in `/src/app/api/permits/generate-pdf/route.ts`
- Or move to environment variables / settings table

## Future Enhancements

- [ ] Draw custom polygon for proposed well location
- [ ] Calculate exact distances between features
- [ ] Auto-detect if proposed location meets setbacks
- [ ] Import septic data if API becomes available
- [ ] Export to CAD formats for engineers
- [ ] Historical aerial imagery toggle
- [ ] Link permit generator to CRM customer records
- [ ] Save generated permits to customer/job files
