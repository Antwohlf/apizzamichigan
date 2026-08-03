import pizzaVisited from '../icons/pizza/marker-pizza-colored.svg'
import pizzaUnvisited from '../icons/pizza/marker-pizza-grey.svg'
import pizzaGolden from '../icons/pizza/marker-pizza-gold.svg'
import tacoVisited from '../icons/taco/marker-taco-colored.svg'
import tacoUnvisited from '../icons/taco/marker-taco-grey.svg'
import tacoGolden from '../icons/taco/marker-taco-gold.svg'

export const markerAssets = {
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

export const markerAssetsFor = site => markerAssets[site] || markerAssets.pizza

export const markerAssetFor = (site, status = 'unvisited') => {
  const assets = markerAssetsFor(site)
  return assets[status] || assets.unvisited
}
