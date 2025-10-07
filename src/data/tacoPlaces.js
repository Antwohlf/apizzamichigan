// Lightweight fallback data for TacoBoutMichigan until Supabase taco_places is live.
// Fields mirror the pizza_places schema used by the map.
export const tacoPlacesFallback = [
  {
    name: 'Taqueria Lupita',
    style: 'Street',
    price: '$',
    lat: 42.3129,
    lng: -83.1002,
    rating: 9.0,
    review: 'Handmade tortillas and late-night hours keep this a Southwest Detroit staple.',
    notes: 'Try the lengua with green salsa.',
    status: 'visited',
  },
  {
    name: 'La Jalisciense',
    style: 'Al Pastor',
    price: '$',
    lat: 42.3468,
    lng: -83.4843,
    rating: 8.5,
    review: 'Spit-roasted pastor carved to order with charred pineapple.',
    notes: 'Cash only, limited seating.',
    status: 'visited',
  },
  {
    name: 'Birria Tacos El Gordo',
    style: 'Birria',
    price: '$$',
    lat: 42.2086,
    lng: -83.1509,
    rating: 8.0,
    review: 'Rich consomé and cheesy quesabirria with a modern truck vibe.',
    notes: 'Weekend pop-up in Wyandotte—check socials for schedule.',
    status: 'visited',
  },
]
