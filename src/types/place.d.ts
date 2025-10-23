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
}

export type PlaceId = Place['id'];
