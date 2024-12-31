// src/CustomControl.js
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import ReactDOM from 'react-dom';

const CustomControl = ({ position, children }) => {
  const map = useMap();

  useEffect(() => {
    const control = L.control({ position });

    control.onAdd = function () {
      const div = L.DomUtil.create('div', 'leaflet-control leaflet-bar');
      ReactDOM.render(children, div);
      return div;
    };

    control.addTo(map);

    return () => {
      control.remove();
    };
  }, [map, position, children]);

  return null;
};

export default CustomControl;