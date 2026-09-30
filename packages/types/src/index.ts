export const VIBES = [
  "active",
  "calm",
  "games",
  "culture",
  "outdoor",
  "food",
  "unusual",
] as const;
export type Vibe = (typeof VIBES)[number];
export const CATEGORIES = [
  "outdoor",
  "food",
  "games",
  "culture",
  "active",
  "cinema",
  "unusual",
  "volunteer",
] as const;
export type Category = (typeof CATEGORIES)[number];
export interface Coordinates {
  lat: number;
  lon: number;
}
export interface Activity {
  id: string;
  title: string;
  description: string;
  type:
    | "event"
    | "place"
    | "sport"
    | "culture"
    | "tourism"
    | "volunteer"
    | "outdoor"
    | "food"
    | "entertainment";
  category: Category;
  city: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  price_from: number;
  price_to: number;
  duration_minutes: number;
  start_time: string | null;
  end_time: string | null;
  opens_at: string;
  closes_at: string;
  tags: Vibe[];
  age_constraints: number;
  source_name: string;
  source_url: string;
  source_updated_at: string;
  availability_status: "demo" | "available" | "unknown" | "unavailable";
  is_demo_data: boolean;
}
export interface SessionSettings {
  title: string;
  city: string;
  startsAt: string;
  durationMinutes: number;
  budget: number;
  radiusKm: number;
  origin: Coordinates;
  originName?: string;
  expectedParticipants: number;
}
export interface Preference {
  vibes: Vibe[];
  budget: number;
  radiusKm: number;
  availableFrom: string;
  availableUntil: string;
  veto: Category | null;
  age: number;
}
export interface GroupPreferences {
  settings: SessionSettings;
  participants: Preference[];
}
export interface RankedRecommendation {
  activity: Activity;
  score: number;
  consensusCount: number;
  totalParticipants: number;
  factors: Record<string, number>;
  reasons: string[];
}
export interface PlanItem {
  activity: Activity;
  startTime: string;
  endTime: string;
  travelMinutes: number;
}
export interface Explanation {
  text: string;
  mode: "rules";
}
export interface Plan {
  id: string;
  items: PlanItem[];
  priceTotal: number;
  durationMinutes: number;
  distanceKm: number;
  consensusCount: number;
  totalParticipants: number;
  explanation: Explanation;
  mapUrl: string;
  alternatives: RankedRecommendation[];
  vetoes: Category[];
  revision: number;
}
export interface PublicParticipant {
  id: string;
  displayName: string;
  answered: boolean;
}
export interface SessionView {
  id: string;
  settings: SessionSettings;
  participants: PublicParticipant[];
  myPreference: Preference | null;
  me: string;
  revision: number;
  plan: Plan | null;
  isDemo: boolean;
  expiresAt: string;
  inviteUrl: string;
  canGenerate: boolean;
}
export interface Identity {
  id: string;
  displayName: string;
  kind: "max" | "demo";
}
