import React from 'react';
import { VehicleType, VEHICLE_OPTIONS } from '../../types';

interface VehicleSelectorProps {
  selectedVehicle: VehicleType;
  onVehicleChange: (vehicle: VehicleType) => void;
  className?: string;
}

const VehicleSelector: React.FC<VehicleSelectorProps> = ({
  selectedVehicle,
  onVehicleChange,
  className = ""
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Select Vehicle Type
      </label>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {VEHICLE_OPTIONS.map((option) => (
          <div
            key={option.value}
            className={`
              relative cursor-pointer rounded-lg border-2 p-4 transition-all duration-200 hover:shadow-md
              ${selectedVehicle === option.value
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 bg-white hover:border-gray-300'
              }
            `}
            onClick={() => onVehicleChange(option.value)}
          >
            <div className="flex items-start space-x-3">
              <span className="text-2xl flex-shrink-0">{option.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-medium text-gray-900 text-sm">
                    {option.label}
                  </span>
                  <span className="text-xs text-gray-500">
                    {option.bengaliName}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mb-2 line-clamp-2">
                  {option.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-green-600">
                    {option.estimatedCost}
                  </span>
                  {selectedVehicle === option.value && (
                    <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
        <p className="text-xs text-yellow-800">
          💡 <strong>Tip:</strong> Choose the vehicle type you plan to use. This helps other passengers 
          know what to expect and share costs accordingly.
        </p>
      </div>
    </div>
  );
};

export default VehicleSelector;