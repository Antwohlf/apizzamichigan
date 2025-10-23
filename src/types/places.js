/**
 * @typedef {Object} ReviewPhoto
 * @property {string} id
 * @property {string} path
 * @property {string|null} [publicUrl]
 * @property {number} [sortOrder]
 *
 * @typedef {'visited' | 'unvisited' | 'golden'} PlaceStatus
 *
 * @typedef {Object} PizzaPlace
 * @property {string} id
 * @property {string} name
 * @property {number|null} rating
 * @property {PlaceStatus} status
 * @property {string} style
 * @property {string} price
 * @property {number} lat
 * @property {number} lng
 * @property {string} [review]
 * @property {string} [notes]
 * @property {ReviewPhoto[]} [photos]
 *
 * @typedef {Object} TacoPlace
 * @property {string} id
 * @property {string} name
 * @property {number|null} rating
 * @property {PlaceStatus} status
 * @property {string} style
 * @property {string} price
 * @property {number} lat
 * @property {number} lng
 * @property {string} [review]
 * @property {string} [notes]
 * @property {ReviewPhoto[]} [photos]
 */
export {}
