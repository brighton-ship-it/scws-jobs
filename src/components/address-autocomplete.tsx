'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

interface AddressComponents {
  address: string;
  city: string;
  county: string;
  zip: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  onAddressSelect: (components: AddressComponents) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
}

// Southern California bounds (San Diego + Riverside counties area)
const SOCAL_BOUNDS = {
  north: 34.1,
  south: 32.5,
  east: -114.5,
  west: -117.6,
};

// Singleton loader to prevent multiple script loads
let loaderInstance: Loader | null = null;
let placesLibraryPromise: Promise<google.maps.PlacesLibrary> | null = null;

function getPlacesLibrary(): Promise<google.maps.PlacesLibrary> {
  if (placesLibraryPromise) return placesLibraryPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key not configured'));
  }

  loaderInstance = new Loader({
    apiKey,
    version: 'weekly',
    libraries: ['places'],
  });

  placesLibraryPromise = loaderInstance.importLibrary('places');
  return placesLibraryPromise;
}

function parseAddressComponents(place: google.maps.places.PlaceResult): AddressComponents {
  const components: AddressComponents = {
    address: '',
    city: '',
    county: '',
    zip: '',
  };

  if (!place.address_components) return components;

  let streetNumber = '';
  let route = '';

  for (const component of place.address_components) {
    const types = component.types;

    if (types.includes('street_number')) {
      streetNumber = component.long_name;
    } else if (types.includes('route')) {
      route = component.long_name;
    } else if (types.includes('locality')) {
      components.city = component.long_name;
    } else if (types.includes('administrative_area_level_2')) {
      // County - remove " County" suffix if present
      components.county = component.long_name.replace(/ County$/i, '');
    } else if (types.includes('postal_code')) {
      components.zip = component.long_name;
    }
  }

  // Combine street number and route for address
  components.address = [streetNumber, route].filter(Boolean).join(' ');

  return components;
}

export function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  label = 'Street Address',
  placeholder = '123 Main St',
  required = false,
  error,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handlePlaceChanged = useCallback(() => {
    const autocomplete = autocompleteRef.current;
    if (!autocomplete) return;

    const place = autocomplete.getPlace();
    if (!place.address_components) return;

    const parsed = parseAddressComponents(place);
    
    // Update the input with the street address
    onChange(parsed.address);
    
    // Notify parent of all components
    onAddressSelect(parsed);
  }, [onChange, onAddressSelect]);

  useEffect(() => {
    let mounted = true;

    async function initAutocomplete() {
      if (!inputRef.current) return;

      try {
        await getPlacesLibrary();
        
        if (!mounted || !inputRef.current) return;

        // Create autocomplete instance
        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'us' },
          bounds: SOCAL_BOUNDS,
          fields: ['address_components', 'formatted_address'],
        });

        // Bias towards Southern California
        autocomplete.setBounds(SOCAL_BOUNDS);

        autocomplete.addListener('place_changed', handlePlaceChanged);
        autocompleteRef.current = autocomplete;
        
        setIsLoading(false);
      } catch (err) {
        if (mounted) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load Google Maps');
          setIsLoading(false);
        }
      }
    }

    initAutocomplete();

    return () => {
      mounted = false;
      // Clean up listener
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [handlePlaceChanged]);

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={isLoading && !loadError}
          className={`
            block w-full rounded-lg border px-3 py-2 text-sm
            placeholder:text-gray-400
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:bg-gray-50 disabled:text-gray-500
            ${error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}
          `}
          autoComplete="off"
        />
        {isLoading && !loadError && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loadError && (
        <p className="text-xs text-amber-600">
          Address suggestions unavailable. You can still type manually.
        </p>
      )}
    </div>
  );
}
