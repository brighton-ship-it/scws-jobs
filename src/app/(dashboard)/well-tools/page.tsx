'use client';

import { useState } from 'react';
import { Calculator, Droplets, History, Save, RefreshCw, Info } from 'lucide-react';

// Pump sizing calculations
function calculateTotalDynamicHead(
  pumpingLevel: number,
  pressurePsi: number,
  frictionLoss: number,
  elevationChange: number
): number {
  const pressureHead = pressurePsi * 2.31; // Convert PSI to feet
  return pumpingLevel + pressureHead + frictionLoss + elevationChange;
}

function calculateRequiredHP(gpm: number, tdh: number): number {
  // HP = (GPM × TDH) / (3960 × pump efficiency)
  // Assuming 60% pump efficiency
  return (gpm * tdh) / (3960 * 0.6);
}

function recommendedWireSize(hp: number, distance: number): string {
  // Simplified wire sizing chart for 230V single phase
  if (hp <= 0.5) return distance > 300 ? '12 AWG' : '14 AWG';
  if (hp <= 1) return distance > 200 ? '10 AWG' : '12 AWG';
  if (hp <= 2) return distance > 150 ? '8 AWG' : '10 AWG';
  if (hp <= 3) return distance > 100 ? '6 AWG' : '8 AWG';
  if (hp <= 5) return distance > 100 ? '4 AWG' : '6 AWG';
  return distance > 100 ? '2 AWG' : '4 AWG';
}

function pressureTankSize(gpm: number): { gallons: number; drawdown: number } {
  // Rule of thumb: tank drawdown should be about 1 minute of pump run time
  // Drawdown is typically 25-30% of tank volume
  const minDrawdown = gpm * 1; // 1 minute of flow
  const tankGallons = minDrawdown / 0.25; // 25% drawdown
  
  // Round up to common sizes
  const commonSizes = [20, 32, 44, 62, 86, 119];
  const recommended = commonSizes.find(s => s >= tankGallons) || 119;
  
  return { gallons: recommended, drawdown: Math.round(recommended * 0.25) };
}

export default function WellToolsPage() {
  const [activeTab, setActiveTab] = useState<'pump-sizing' | 'well-depth'>('pump-sizing');
  
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

  // Calculate results
  const pumpingLevel = parseFloat(staticLevel || '0') + parseFloat(drawdown || '0');
  
  // Friction loss calculation (simplified Hazen-Williams)
  const frictionLossPer100 = pipeDiameter === '1' ? 5.2 : pipeDiameter === '1.25' ? 2.1 : pipeDiameter === '1.5' ? 1.0 : 0.5;
  const totalFrictionLoss = (parseFloat(pipeLength || '0') / 100) * frictionLossPer100 * (parseFloat(desiredGPM || '10') / 10);
  
  const tdh = calculateTotalDynamicHead(
    pumpingLevel,
    parseFloat(desiredPressure || '50'),
    totalFrictionLoss,
    parseFloat(elevationChange || '0')
  );
  
  const requiredHP = calculateRequiredHP(parseFloat(desiredGPM || '10'), tdh);
  const recommendedHP = Math.ceil(requiredHP * 2) / 2; // Round up to nearest 0.5
  const wireSize = recommendedWireSize(recommendedHP, parseFloat(pipeLength || '0') + pumpingLevel);
  const tank = pressureTankSize(parseFloat(desiredGPM || '10'));

  const handleCalculate = () => {
    setShowResults(true);
  };

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Well Tools</h1>
        <p className="text-gray-500">Pump sizing calculator and well depth tracking</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
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

      {activeTab === 'pump-sizing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Form */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Well & System Parameters</h2>
            
            <div className="space-y-4">
              {/* Well Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Total Well Depth (ft)
                  </label>
                  <input
                    type="number"
                    value={wellDepth}
                    onChange={(e) => setWellDepth(e.target.value)}
                    placeholder="400"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Static Water Level (ft)
                  </label>
                  <input
                    type="number"
                    value={staticLevel}
                    onChange={(e) => setStaticLevel(e.target.value)}
                    placeholder="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Drawdown (ft)
                    <span className="text-gray-400 font-normal ml-1">(during pumping)</span>
                  </label>
                  <input
                    type="number"
                    value={drawdown}
                    onChange={(e) => setDrawdown(e.target.value)}
                    placeholder="50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Desired Flow (GPM)
                  </label>
                  <input
                    type="number"
                    value={desiredGPM}
                    onChange={(e) => setDesiredGPM(e.target.value)}
                    placeholder="15"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* System Info */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Piping & Pressure</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Desired Pressure (PSI)
                    </label>
                    <select
                      value={desiredPressure}
                      onChange={(e) => setDesiredPressure(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="40">40 PSI (30/50)</option>
                      <option value="50">50 PSI (40/60)</option>
                      <option value="60">60 PSI (50/70)</option>
                      <option value="70">70 PSI (60/80)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pipe Diameter
                    </label>
                    <select
                      value={pipeDiameter}
                      onChange={(e) => setPipeDiameter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="1">1"</option>
                      <option value="1.25">1-1/4"</option>
                      <option value="1.5">1-1/2"</option>
                      <option value="2">2"</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pipe Run Length (ft)
                      <span className="text-gray-400 font-normal ml-1">(to tank)</span>
                    </label>
                    <input
                      type="number"
                      value={pipeLength}
                      onChange={(e) => setPipeLength(e.target.value)}
                      placeholder="100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Elevation Change (ft)
                      <span className="text-gray-400 font-normal ml-1">(+ uphill)</span>
                    </label>
                    <input
                      type="number"
                      value={elevationChange}
                      onChange={(e) => setElevationChange(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCalculate}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                >
                  <Calculator className="h-4 w-4" />
                  Calculate
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            {showResults && (
              <>
                {/* TDH Breakdown */}
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

                {/* Recommendations */}
                <div className="bg-green-50 rounded-xl border border-green-200 p-6">
                  <h2 className="text-lg font-semibold text-green-900 mb-4">Recommendations</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pump Size</p>
                      <p className="text-2xl font-bold text-gray-900">{recommendedHP} HP</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Calculated: {requiredHP.toFixed(2)} HP
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Wire Size</p>
                      <p className="text-2xl font-bold text-gray-900">{wireSize}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        For {(parseFloat(pipeLength || '0') + pumpingLevel).toFixed(0)} ft run
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pressure Tank</p>
                      <p className="text-2xl font-bold text-gray-900">{tank.gallons} gal</p>
                      <p className="text-xs text-gray-500 mt-1">
                        ~{tank.drawdown} gal drawdown
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pump Setting</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.min(parseFloat(wellDepth || '0') - 20, pumpingLevel + 50).toFixed(0)} ft
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Min 20ft above bottom
                      </p>
                    </div>
                  </div>
                </div>

                {/* Save Option */}
                <div className="flex gap-3">
                  <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    <Save className="h-4 w-4" />
                    Save to Job/Quote
                  </button>
                  <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    <History className="h-4 w-4" />
                    Save as Preset
                  </button>
                </div>
              </>
            )}

            {!showResults && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
                <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">Enter well parameters and click Calculate</p>
              </div>
            )}

            {/* Info Card */}
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Calculation Notes</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Assumes 60% pump efficiency (conservative)</li>
                    <li>Wire sizing based on 230V single phase, 3% voltage drop max</li>
                    <li>Always verify with pump manufacturer curves</li>
                    <li>Add 10-20% safety factor for motor HP in hot climates</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'well-depth' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Property Search */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Select Property</h3>
              <input
                type="text"
                placeholder="Search properties..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent mb-4"
              />
              <div className="space-y-2">
                {['Oak Tree Ranch - Valley Center', 'Johnson Residence - Ramona', 'Chen Property - Escondido'].map((property, i) => (
                  <button
                    key={i}
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-50 border border-gray-200 transition-colors"
                  >
                    <p className="font-medium text-gray-900">{property.split(' - ')[0]}</p>
                    <p className="text-sm text-gray-500">{property.split(' - ')[1]}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Well Info & Readings */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Oak Tree Ranch</h2>
                <button className="text-sm text-green-600 hover:text-green-700 font-medium">
                  + Add Reading
                </button>
              </div>

              {/* Current Well Stats */}
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

              {/* Reading History */}
              <h3 className="font-medium text-gray-900 mb-3">Reading History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Type</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Depth to Water</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-700">Yield</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    <tr>
                      <td className="px-3 py-2">Jan 15, 2026</td>
                      <td className="px-3 py-2">Static Level</td>
                      <td className="px-3 py-2 text-right font-medium">142 ft</td>
                      <td className="px-3 py-2 text-right">—</td>
                      <td className="px-3 py-2 text-gray-500">Annual service visit</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2">Jan 15, 2026</td>
                      <td className="px-3 py-2">Yield Test</td>
                      <td className="px-3 py-2 text-right font-medium">168 ft</td>
                      <td className="px-3 py-2 text-right font-medium text-green-600">18 GPM</td>
                      <td className="px-3 py-2 text-gray-500">30 min test, good recovery</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2">Aug 22, 2025</td>
                      <td className="px-3 py-2">Static Level</td>
                      <td className="px-3 py-2 text-right font-medium">148 ft</td>
                      <td className="px-3 py-2 text-right">—</td>
                      <td className="px-3 py-2 text-gray-500">Summer check</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2">Jan 10, 2025</td>
                      <td className="px-3 py-2">Yield Test</td>
                      <td className="px-3 py-2 text-right font-medium">165 ft</td>
                      <td className="px-3 py-2 text-right font-medium text-green-600">20 GPM</td>
                      <td className="px-3 py-2 text-gray-500">Annual service</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Trend Chart Placeholder */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Water Level Trend</h3>
              <div className="h-48 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400">
                Chart showing static water level over time
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
