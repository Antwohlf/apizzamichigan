// src/ZoomButtons.js
import React from 'react';
import { useMap } from 'react-leaflet';

const ZoomButtons = () => {
  const map = useMap();

  const handleZoomOut = () => {
    map.setView([20, 0], 2);
  };

  const handleZoomIn = () => {
    map.setView([44.3148, -85.6024], 6);
  };

  return (
    <div className="zoom-buttons">
      <button onClick={handleZoomOut}>And Beyond</button>
      <button onClick={handleZoomIn}>Back to Michigan</button>
    </div>
  );
};

export default ZoomButtons;