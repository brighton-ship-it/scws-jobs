'use client';

import { useState } from 'react';
import { Calculator, Droplets, History, Save, RefreshCw, Info, Search, MapPin, Loader2 } from 'lucide-react';

// Pump sizing calculations
function calculateTotalDynamicHead(
  pumpingLevel: number,
  pressurePsi: number,
  frictionLoss: number,
  elevationChange: number
): number {
  const pressureHead = pressurePsi * 2.31;
  return pumpingLevel + pressureHead + frictionLoss + elevationChange;
}

function calculateRequiredHP(gpm: number, tdh: number): number {
  return (gpm * tdh) / (3960 * 0.6);
}

function recommendedWireSize(hp: number, distance: number): string {
  if (hp <= 0.5) return distance > 300 ? '12 AWG' : '14 AWG';
  if (hp <= 1) return distance > 200 ? '10 AWG' : '12 AWG';
  if (hp <= 2) return distance > 150 ? '8 AWG' : '10 AWG';
  if (hp <= 3) return distance > 100 ? '6 AWG' : '8 AWG';
  if (hp <= 5) return distance > 100 ? '4 AWG' : '6 AWG';
  return distance > 100 ? '2 AWG' : '4 AWG';
}

function pressureTankSize(gpm: number): { gallons: number; drawdown: number } {
  const minDrawdown = gpm * 1;
  const tankGallons = minDrawdown / 0.25;
  const commonSizes = [20, 32, 44, 62, 86, 119];
  const recommended = commonSizes.find(s => s >= tankGallons) || 119;
  return { gallons: recommended, drawdown: Math.round(recommended * 0.25) };
}

interface WellResult {
  wcr_number?: string;
  total_drill_depth?: number;
  well_yield?: number;
  static_water_level?: number;
  date_work_ended?: string;
  drilling_method?: string;
  distance_miles: number;
  distance_feet: number;
  county?: string;
  city?: string;
}

interface WellStats {
  totalWells: number;
  avgDepth: number | null;
  minDepth: number | null;
  maxDepth: number | null;
  avgYield: number | null;
  setbackFeet: number;
  radiusMiles: number;
}

export default function WellToolsPage() {
  const [activeTab, setActiveTab] = useState<'well-lookup' | 'pump-sizing' | 'well-depth'>('well-lookup');
  
  // Well Lookup State
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupRadius, setLookupRadius] = useState('2');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<{ wells: WellResult[]; stats: WellStats } | null>(null);
  
  // Pump Sizing State
  const [wellDepth, setWellDepth] = useState<string>('');
  const [staticLevel, setStaticLevel] = useState<string>('');
  const [drawdown, setDrawdown] = useState<string>('');
  const [desiredGPM, setDesiredGPM] = useState<string>('');
  const [desiredPressure, setDesiredPressure] = useState<string>('50');
  const [pipeLength, setPipeLength] = useState<string>('');
  const [pipeDiameter, setPipeDiameter] = useState<string>('1.25');
  const [elevationChange, setElevationChange] = useState<string>('0');
  const [showResults, setShowResults] = useState(false);

  // Calculate pump sizing results
  const pumpingLevel = parseFloat(staticLevel || '0') + parseFloat(drawdown || '0');
  const frictionLossPer100 = pipeDiameter === '1' ? 5.2 : pipeDiameter === '1.25' ? 2.1 : pipeDiameter === '1.5' ? 1.0 : 0.5;
  const totalFrictionLoss = (parseFloat(pipeLength || '0') / 100) * frictionLossPer100 * (parseFloat(desiredGPM || '10') / 10);
  const tdh = calculateTotalDynamicHead(
    pumpingLevel,
    parseFloat(desiredPressure || '50'),
    totalFrictionLoss,
    parseFloat(elevationChange || '0')
  );
  const requiredHP = calculateRequiredHP(parseFloat(desiredGPM || '10'), tdh);
  const recommendedHP = Math.ceil(requiredHP * 2) / 2;
  const wireSize = recommendedWireSize(recommendedHP, parseFloat(pipeLength || '0') + pumpingLevel);
  const tank = pressureTankSize(parseFloat(desiredGPM || '10'));

  const handleCalculate = () => setShowResults(true);
  const handleReset = () => {
    setWellDepth('');
    setStaticLevel('');
    setDrawdown('');
    setDesiredGPM('');
    setDesiredPressure('50');
    setPipeLength('');
    setPipeDiameter('1.25');
    setElevationChange('0');
    setShowResults(false);
  };

  // Well Lookup Handler
  const handleWellLookup = async () => {
    if (!lookupAddress.trim()) {
      setLookupError('Please enter an address');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setLookupResults(null);

    try {
      // Geocode the address using Nominatim
      const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(lookupAddress)}&format=json&limit=1&countrycodes=us`;
      const geoRes = await fetch(geocodeUrl, {
        headers: { 'User-Agent': 'SCWS-WellLookup/1.0' }
      });
      const geoData = await geoRes.json();

      if (!geoData.length) {
        setLookupError('Could not find that address. Try adding the city and zip code.');
        setLookupLoading(false);
        return;
      }

      const lat = parseFloat(geoData[0].lat);
      const lng = parseFloat(geoData[0].lon);

      // Query our wells API
      const wellsRes = await fetch(`/api/wells/nearby?lat=${lat}&lng=${lng}&radius=${lookupRadius}`);
      const wellsData = await wellsRes.json();

      if (wellsData.error) {
        setLookupError(wellsData.error);
        setLookupLoading(false);
        return;
      }

      setLookupResults(wellsData);
    } catch (err: any) {
      setLookupError(err.message || 'Failed to lookup wells');
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Well Tools</h1>
        <p className="text-gray-500">Well depth lookup, pump sizing calculator, and well tracking</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('well-lookup')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'well-lookup'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Search className="h-4 w-4 inline mr-2" />
            Well Depth Lookup
          </button>
          <button
            onClick={() => setActiveTab('pump-sizing')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'pump-sizing'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calculator className="h-4 w-4 inline mr-2" />
            Pump Sizing Calculator
          </button>
          <button
            onClick={() => setActiveTab('well-depth')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'well-depth'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Droplets className="h-4 w-4 inline mr-2" />
            Well Depth Tracker
          </button>
        </nav>
      </div>

      {/* Well Lookup Tab */}
      {activeTab === 'well-lookup' && (
        <div className="space-y-6">
          {/* Search Box */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Find Nearby Wells</h2>
            <p className="text-sm text-gray-500 mb-4">
              Enter an address to find well depth data from the California DWR database.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Property Address
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      value={lookupAddress}
                      onChange={(e) => setLookupAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleWellLookup()}
                      placeholder="123 Main St, Ramona, CA 92065"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <select
                    value={lookupRadius}
                    onChange={(e) => setLookupRadius(e.target.value)}
                    className="px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="0.5">0.5 mi</option>
                    <option value="1">1 mi</option>
                    <option value="2">2 mi</option>
                    <option value="5">5 mi</option>
                  </select>
                  <button
                    onClick={handleWellLookup}
                    disabled={lookupLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                  >
                    {lookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Search
                  </button>
                </div>
              </div>
            </div>

            {lookupError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {lookupError}
              </div>
            )}
          </div>

          {/* Results */}
          {lookupResults && (
            <>
              {/* Stats */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Well Data Summary
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({lookupResults.stats.totalWells} wells within {lookupResults.stats.radiusMiles} miles)
                  </span>
                </h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-green-700">
                      {lookupResults.stats.avgDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Avg Depth</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-gray-700">
                      {lookupResults.stats.minDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Min Depth</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-gray-700">
                      {lookupResults.stats.maxDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Max Depth</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-blue-700">
                      {lookupResults.stats.avgYield || '—'}<span className="text-lg"> GPM</span>
                    </p>
                    <p className="text-sm text-gray-600">Avg Yield</p>
                  </div>
                </div>

                {/* Cost Estimate */}
                {lookupResults.stats.avgDepth && (
                  <div className="mt-6 p-4 bg-gradient-to-r from-green-600 to-green-700 rounded-lg text-white">
                    <h4 className="font-semibold mb-1">Estimated Drilling Cost</h4>
                    <p className="text-2xl font-bold">
                      ${(lookupResults.stats.avgDepth * 50).toLocaleString()} - ${(lookupResults.stats.avgDepth * 80).toLocaleString()}
                    </p>
                    <p className="text-sm opacity-80 mt-1">
                      Based on {lookupResults.stats.avgDepth}' avg depth × $50-80/foot
                    </p>
                  </div>
                )}
              </div>

              {/* Well List */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Nearby Wells</h3>
                </div>
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {lookupResults.wells.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      No wells found in this area. Try increasing the search radius.
                    </div>
                  ) : (
                    lookupResults.wells.map((well, i) => (
                      <div key={i} className="px-6 py-3 hover:bg-gray-50">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-lg font-semibold text-gray-900">
                              {well.total_drill_depth || '—'}' deep
                            </span>
                            {well.well_yield && (
                              <span className="ml-3 text-sm text-blue-600">
                                {well.well_yield} GPM
                              </span>
                            )}
                          </div>
                          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {well.distance_miles} mi
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-500 space-x-3">
                          {well.city && <span>📍 {well.city}</span>}
                          {well.drilling_method && <span>🔧 {well.drilling_method}</span>}
                          {well.static_water_level && <span>💧 Static: {well.static_water_level}'</span>}
                          {well.wcr_number && <span className="text-gray-400">#{well.wcr_number}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Empty State */}
          {!lookupResults && !lookupLoading && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-12 text-center">
              <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">Enter an address above to find nearby well data</p>
              <p className="text-sm text-gray-400 mt-2">
                Data from California DWR Well Completion Reports
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pump Sizing Tab */}
      {activeTab === 'pump-sizing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Form */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Well & System Parameters</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Well Depth (ft)</label>
                  <input type="number" value={wellDepth} onChange={(e) => setWellDepth(e.target.value)} placeholder="400"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Static Water Level (ft)</label>
                  <input type="number" value={staticLevel} onChange={(e) => setStaticLevel(e.target.value)} placeholder="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Drawdown (ft)</label>
                  <input type="number" value={drawdown} onChange={(e) => setDrawdown(e.target.value)} placeholder="50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Desired Flow (GPM)</label>
                  <input type="number" value={desiredGPM} onChange={(e) => setDesiredGPM(e.target.value)} placeholder="15"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Piping & Pressure</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Desired Pressure (PSI)</label>
                    <select value={desiredPressure} onChange={(e) => setDesiredPressure(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                      <option value="40">40 PSI (30/50)</option>
                      <option value="50">50 PSI (40/60)</option>
                      <option value="60">60 PSI (50/70)</option>
                      <option value="70">70 PSI (60/80)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pipe Diameter</label>
                    <select value={pipeDiameter} onChange={(e) => setPipeDiameter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                      <option value="1">1"</option>
                      <option value="1.25">1-1/4"</option>
                      <option value="1.5">1-1/2"</option>
                      <option value="2">2"</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pipe Run Length (ft)</label>
                    <input type="number" value={pipeLength} onChange={(e) => setPipeLength(e.target.value)} placeholder="100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Elevation Change (ft)</label>
                    <input type="number" value={elevationChange} onChange={(e) => setElevationChange(e.target.value)} placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={handleCalculate}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors">
                  <Calculator className="h-4 w-4" />Calculate
                </button>
                <button onClick={handleReset}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  <RefreshCw className="h-4 w-4" />Reset
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            {showResults ? (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Total Dynamic Head</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pumping Level (Static + Drawdown)</span>
                      <span className="font-medium">{pumpingLevel.toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pressure Head ({desiredPressure} PSI × 2.31)</span>
                      <span className="font-medium">{(parseFloat(desiredPressure) * 2.31).toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Friction Loss</span>
                      <span className="font-medium">{totalFrictionLoss.toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Elevation Change</span>
                      <span className="font-medium">{elevationChange || 0} ft</span>
                    </div>
                    <div className="border-t border-gray-200 pt-3 flex justify-between">
                      <span className="font-semibold text-gray-900">Total Dynamic Head</span>
                      <span className="font-bold text-green-600 text-lg">{tdh.toFixed(0)} ft</span>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-xl border border-green-200 p-6">
                  <h2 className="text-lg font-semibold text-green-900 mb-4">Recommendations</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pump Size</p>
                      <p className="text-2xl font-bold text-gray-900">{recommendedHP} HP</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Wire Size</p>
                      <p className="text-2xl font-bold text-gray-900">{wireSize}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pressure Tank</p>
                      <p className="text-2xl font-bold text-gray-900">{tank.gallons} gal</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pump Setting</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.min(parseFloat(wellDepth || '0') - 20, pumpingLevel + 50).toFixed(0)} ft
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
                <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">Enter well parameters and click Calculate</p>
              </div>
            )}

            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Calculation Notes</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Assumes 60% pump efficiency</li>
                    <li>Wire sizing based on 230V single phase</li>
                    <li>Always verify with manufacturer specs</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Well Depth Tracker Tab */}
      {activeTab === 'well-depth' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Select Property</h3>
              <input type="text" placeholder="Search properties..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent mb-4" />
              <div className="space-y-2">
                {['Oak Tree Ranch - Valley Center', 'Johnson Residence - Ramona', 'Chen Property - Escondido'].map((property, i) => (
                  <button key={i} className="w-full text-left p-3 rounded-lg hover:bg-gray-50 border border-gray-200 transition-colors">
                    <p className="font-medium text-gray-900">{property.split(' - ')[0]}</p>
                    <p className="text-sm text-gray-500">{property.split(' - ')[1]}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-4 text-center">
                ⚠️ This feature is coming soon
              </p>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Oak Tree Ranch</h2>
                <button className="text-sm text-green-600 hover:text-green-700 font-medium">+ Add Reading</button>
              </div>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">385</p>
                  <p className="text-xs text-gray-500">Total Depth (ft)</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">142</p>
                  <p className="text-xs text-gray-500">Static Level (ft)</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">18</p>
                  <p className="text-xs text-gray-500">Last Yield (GPM)</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">3</p>
                  <p className="text-xs text-gray-500">Pump HP</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 text-center">
                ⚠️ Customer well tracking coming soon
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
