import L from 'leaflet'

import pizzaVisited from '../icons/pizza/marker-pizza-colored.svg'
import pizzaUnvisited from '../icons/pizza/marker-pizza-grey.svg'
import pizzaGolden from '../icons/pizza/marker-pizza-gold.svg'
import tacoVisited from '../icons/taco/marker-taco-colored.svg'
import tacoUnvisited from '../icons/taco/marker-taco-grey.svg'
import tacoGolden from '../icons/taco/marker-taco-gold.svg'
import { isHistoricalLifecycle } from '../lib/lifecycle'

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

export function getMarkerIcon(site, status = 'visited', lifecycleStatus = null) {
  const safeStatus = status && iconBySiteStatus[site] && iconBySiteStatus[site][status] ? status : 'visited'
  const iconUrl = iconBySiteStatus[site][safeStatus]
  const historical = isHistoricalLifecycle(lifecycleStatus)

  const options = {
    iconUrl,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -28],
    className: `leaflet-marker-icon ${site}-marker${historical ? ' place-marker--historical' : ''}`,
  }

  if (site === 'taco') {
    options.className = `leaflet-marker-icon taco-marker${safeStatus === 'golden' ? ' taco-marker--golden' : ''}${historical ? ' place-marker--historical' : ''}`
  }

  return L.icon(options)
}
