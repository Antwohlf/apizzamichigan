import L from 'leaflet'

import pizzaVisited from '../icons/pizza/marker-pizza-colored.svg'
import pizzaUnvisited from '../icons/pizza/marker-pizza-grey.svg'
import pizzaGolden from '../icons/pizza/marker-pizza-gold.svg'
import tacoVisited from '../icons/taco/marker-taco-colored.svg'
import tacoUnvisited from '../icons/taco/marker-taco-grey.svg'
import tacoGolden from '../icons/taco/marker-taco-gold.svg'

const iconBySiteStatus = {
  pizza: {
    visited: pizzaVisited,
    unvisited: pizzaUnvisited,
    golden: pizzaGolden,
  },
  taco: {
    visited: tacoVisited,
    unvisited: tacoUnvisited,
    golden: tacoGolden,
  },
}

export function getMarkerIcon(site, status = 'visited') {
  const safeStatus = status && iconBySiteStatus[site] && iconBySiteStatus[site][status] ? status : 'visited'
  const iconUrl = iconBySiteStatus[site][safeStatus]

  const options = {
    iconUrl,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -28],
  }

  if (site === 'taco') {
    options.className = `leaflet-marker-icon taco-marker${safeStatus === 'golden' ? ' taco-marker--golden' : ''}`
  }

  return L.icon(options)
}
