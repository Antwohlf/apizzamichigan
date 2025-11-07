export interface Place {
  id: string;
  type: 'pizza' | 'taco';
  name: string;
  lat: number;
  lng: number;
  price?: string | null;
  status?: 'visited' | 'unvisited' | 'golden' | string | null;
  rating?: number | null;
  address?: string | null;
  notes?: string | null;
  review?: string | null;
  photoUrl?: string | null;
  photos?: string[] | null;
  favorited?: boolean | null;
  place_type?: string | null;
  placeType?: string | null;
  marker_icon_url?: string | null;
  markerIconUrl?: string | null;
}

export type PlaceId = Place['id'];
