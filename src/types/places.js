/**
 * @typedef {Object} ReviewPhoto
 * @property {string} id
 * @property {string} path
 * @property {string|null} [publicUrl]
 * @property {number} [sortOrder]
 *
 * @typedef {'visited' | 'unvisited' | 'golden'} PlaceStatus
 * @typedef {'closed' | 'replaced' | 'demolished'} LifecycleStatus
 *
 * @typedef {Object} PizzaPlace
 * @property {string} id
 * @property {string} name
 * @property {number|null} rating
 * @property {PlaceStatus} status
 * @property {LifecycleStatus|null} [lifecycleStatus]
 * @property {string} style
 * @property {string} price
 * @property {number} lat
 * @property {number} lng
 * @property {string} [review]
 * @property {string} [notes]
 * @property {ReviewPhoto[]} [photos]
 * @property {boolean} [favorited]
 * @property {'pizzeria'|'taqueria'|'tamaleria'} [place_type]
 * @property {string} [marker_icon_url]
 *
 * @typedef {Object} TacoPlace
 * @property {string} id
 * @property {string} name
 * @property {number|null} rating
 * @property {PlaceStatus} status
 * @property {LifecycleStatus|null} [lifecycleStatus]
 * @property {string} style
 * @property {string} price
 * @property {number} lat
 * @property {number} lng
 * @property {string} [review]
 * @property {string} [notes]
 * @property {ReviewPhoto[]} [photos]
 * @property {boolean} [favorited]
 * @property {'pizzeria'|'taqueria'|'tamaleria'} [place_type]
 * @property {string} [marker_icon_url]
 */
export {}
