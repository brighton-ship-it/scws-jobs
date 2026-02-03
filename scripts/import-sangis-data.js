/**
 * Import SanGIS GeoJSON data into Supabase
 * Run: node scripts/import-sangis-data.js
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DATA_DIR = '/Users/jarvis/clawd/scws/permit-data/san-diego/sangis';

async function importSepticSewer() {
  console.log('=== Importing WW_Septic_Sewer_Public ===');
  
  const filePath = path.join(DATA_DIR, 'ww_septic_sewer_full.geojson');
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Loaded ${data.features.length} features`);
  
  const BATCH_SIZE = 1000;
  let imported = 0;
  let errors = 0;
  
  for (let i = 0; i < data.features.length; i += BATCH_SIZE) {
    const batch = data.features.slice(i, i + BATCH_SIZE).map(f => ({
      apn: f.properties.apn,
      sewer_septic_designation: f.properties.sewer_septic_parcel_designation,
      designation_confidence: f.properties.septic_sewer_designation_confid,
      designation_updated_at: f.properties.date_of_last_update 
        ? new Date(f.properties.date_of_last_update).toISOString() 
        : null,
      latitude: f.geometry?.coordinates?.[1],
      longitude: f.geometry?.coordinates?.[0],
      x_coord: f.properties.x_coord,
      y_coord: f.properties.y_coord,
      data_source: 'sangis'
    })).filter(r => r.apn); // Skip records without APN
    
    const { error } = await supabase
      .from('parcel_infrastructure')
      .upsert(batch, { onConflict: 'apn' });
    
    if (error) {
      console.error(`Batch ${i}-${i + BATCH_SIZE} error:`, error.message);
      errors++;
    } else {
      imported += batch.length;
    }
    
    if ((i / BATCH_SIZE) % 50 === 0) {
      console.log(`  Progress: ${imported.toLocaleString()} imported, ${errors} errors`);
    }
  }
  
  console.log(`✓ Imported ${imported.toLocaleString()} parcel records`);
}

async function importWaterMains() {
  console.log('\n=== Importing Water_Main_SD ===');
  
  const filePath = path.join(DATA_DIR, 'water_main_full.geojson');
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Loaded ${data.features.length} features`);
  
  const BATCH_SIZE = 500;
  let imported = 0;
  
  for (let i = 0; i < data.features.length; i += BATCH_SIZE) {
    const batch = data.features.slice(i, i + BATCH_SIZE).map(f => ({
      facility_id: f.properties.fac_id || f.id?.toString(),
      material: f.properties.matl_desc,
      diameter_inches: f.properties.size_inches,
      install_date: f.properties.inst_dt 
        ? new Date(f.properties.inst_dt).toISOString().split('T')[0]
        : null,
      status: f.properties.fac_stat_cd,
      geom_json: JSON.stringify(f.geometry)
    }));
    
    const { error } = await supabase
      .from('water_mains')
      .insert(batch);
    
    if (error) {
      console.error(`Batch error:`, error.message);
    } else {
      imported += batch.length;
    }
  }
  
  console.log(`✓ Imported ${imported.toLocaleString()} water main segments`);
}

async function importSewerMains() {
  console.log('\n=== Importing Sewer_Main_SD ===');
  
  const filePath = path.join(DATA_DIR, 'sewer_main_full.geojson');
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Loaded ${data.features.length} features`);
  
  const BATCH_SIZE = 500;
  let imported = 0;
  
  for (let i = 0; i < data.features.length; i += BATCH_SIZE) {
    const batch = data.features.slice(i, i + BATCH_SIZE).map(f => ({
      facility_id: f.properties.fac_id || f.id?.toString(),
      material: f.properties.matl_desc,
      diameter_inches: f.properties.size_inches,
      install_date: f.properties.inst_dt 
        ? new Date(f.properties.inst_dt).toISOString().split('T')[0]
        : null,
      status: f.properties.fac_stat_cd,
      forced_main: f.properties.forced_main_ind === 'Y',
      geom_json: JSON.stringify(f.geometry)
    }));
    
    const { error } = await supabase
      .from('sewer_mains')
      .insert(batch);
    
    if (error) {
      console.error(`Batch error:`, error.message);
    } else {
      imported += batch.length;
    }
  }
  
  console.log(`✓ Imported ${imported.toLocaleString()} sewer main segments`);
}

async function linkCustomersToInfrastructure() {
  console.log('\n=== Linking Customers to Infrastructure ===');
  
  // This would match customers by address/APN
  // For now, just log that it needs to be done
  console.log('TODO: Match customers by address geocoding or APN lookup');
}

async function main() {
  console.log('SanGIS Data Import');
  console.log('==================');
  console.log('Started:', new Date().toISOString());
  
  await importSepticSewer();
  await importWaterMains();
  await importSewerMains();
  await linkCustomersToInfrastructure();
  
  console.log('\n=== Complete ===');
}

main().catch(console.error);
