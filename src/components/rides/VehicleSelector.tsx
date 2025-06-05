import React from 'react';
import { VehicleType, VEHICLE_OPTIONS } from '../../types';

interface VehicleSelectorProps {
  selectedVehicle: VehicleType;
  onVehicleChange: (vehicle: VehicleType) => void;
  className?: string;
  isFilter?: boolean;
  availableVehicles?: VehicleType[]; 
  vehicleCounts?: { [key in VehicleType]?: number };
}

const VehicleSelector: React.FC<VehicleSelectorProps> = ({
  selectedVehicle,
  onVehicleChange,
  className = "",
  isFilter = false,
  availableVehicles,
  vehicleCounts
}) => {
  // Filter options based on available vehicles if provided
  const optionsToShow = availableVehicles 
    ? VEHICLE_OPTIONS.filter(option => availableVehicles.includes(option.value))
    : VEHICLE_OPTIONS;

  return (
    <div className={`space-y-3 ${className}`}>
      {!isFilter && (
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Select Vehicle Type
        </label>
      )}
      
      <div className={`grid gap-3 ${isFilter ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
        {optionsToShow.map((option) => {
          const rideCount = vehicleCounts?.[option.value];
          return (
            <div
              key={option.value}
              className={`
                relative cursor-pointer rounded-lg border-2 p-3 transition-all duration-200 hover:shadow-md
                ${selectedVehicle === option.value
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
                }
                ${isFilter ? 'p-2' : 'p-4'}
              `}
              onClick={() => onVehicleChange(option.value)}
            >
              <div className={`flex ${isFilter ? 'flex-col items-center' : 'items-start'} space-x-3 ${isFilter ? 'space-x-0 space-y-1' : 'space-x-3'}`}>
                <span className={`flex-shrink-0 ${isFilter ? 'text-xl' : 'text-2xl'}`}>{option.icon}</span>
                <div className={`flex-1 min-w-0 ${isFilter ? 'text-center' : ''}`}>
                  <div className={`flex ${isFilter ? 'flex-col' : 'items-center space-x-2'} mb-1`}>
                    <span className={`font-medium text-gray-900 ${isFilter ? 'text-xs' : 'text-sm'}`}>
                      {option.label}
                    </span>
                    {!isFilter && (
                      <span className="text-xs text-gray-500">
                        {option.bengaliName}
                      </span>
                    )}
                  </div>
                  
                  {/* Show ride count in filter mode */}
                  {isFilter && rideCount !== undefined && (
                    <span className="text-xs text-gray-500">
                      {rideCount} ride{rideCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  
                  {!isFilter && (
                    <p className="text-xs text-gray-600 mb-2 line-clamp-2">
                      {option.description}
                    </p>
                  )}
                  
                  <div className={`flex ${isFilter ? 'justify-center' : 'items-center justify-between'}`}>
                    {!isFilter && (
                      <span className="text-xs font-medium text-green-600">
                        {option.estimatedCost}
                      </span>
                    )}
                    {selectedVehicle === option.value && (
                      <div className={`bg-blue-500 rounded-full flex items-center justify-center ${isFilter ? 'w-3 h-3 mt-1' : 'w-4 h-4'}`}>
                        <div className={`bg-white rounded-full ${isFilter ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {!isFilter && (
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-xs text-yellow-800">
            💡 <strong>Tip:</strong> Choose the vehicle type you plan to use. This helps other passengers 
            know what to expect and share costs accordingly.
          </p>
        </div>
      )}
    </div>
  );
};

export default VehicleSelector;