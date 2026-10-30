/* The data model as stored in .bhp project files (shared with the current app). Depths are metres below ground. */
export interface LabResult { v: number | null; lt?: boolean }
export interface GsdPoint { size: number; passing: number | null }
export interface Sample {
  id?: string; depth: number | null; type?: string;
  b1?: number | null; b2?: number | null; b3?: number | null; n?: number | string | null;
  pp?: number | null; su?: number | null; w?: number | null; ll?: number | null; pl?: number | null;
  so4?: number | null; cvc?: number | null; rec?: number | null; rqd?: number | null;
  gsd?: GsdPoint[]; lab?: Record<string, LabResult | undefined>;
}
export interface WaterReading { kind?: string; depth: number | null; date?: string; ref?: string }
export interface SlugTest { H0?: number; data?: [number, number][]; rc?: number; R?: number; Le?: number; date?: string; kind?: string }
export interface Layer { id: string; top: number | null; bottom: number | null; uscs?: string; texture?: string; origin?: string }
export interface Borehole {
  id: string; name: string; project?: string;
  easting?: number | null; northing?: number | null; elevation?: number | null; crs?: string;
  diameter?: number | null; er?: number | null; noLiners?: boolean; gamma?: number; rodStick?: number;
  layers: Layer[]; samples: Sample[]; water: WaterReading[]; slug?: SlugTest[];
}
