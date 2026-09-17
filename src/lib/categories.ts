import type { CategoryId } from "./types";

export type CategoryMeta = {
  id: CategoryId;
  name: string;
  blurb: string;
  /** Hue anchor used for the category's signal colour. */
  hue: number;
};

export const CATEGORIES: CategoryMeta[] = [
  { id: "physics", name: "Physics", blurb: "Motion, fields, light, the very small", hue: 268 },
  { id: "rf", name: "Radio & RF", blurb: "Spectrum, antennas, propagation, links", hue: 24 },
  { id: "compeng", name: "Computer Engineering", blurb: "Logic, silicon, buses, boards", hue: 190 },
  { id: "economics", name: "Economics", blurb: "Scarcity, markets, money, policy", hue: 142 },
  { id: "history", name: "History", blurb: "Empires, revolutions, wars, people", hue: 38 },
  { id: "geography", name: "Geography", blurb: "Places, borders, terrain, capitals", hue: 172 },
  { id: "general", name: "General Knowledge", blurb: "Science, space, words, world facts", hue: 310 },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryMeta(id: string): CategoryMeta {
  return byId.get(id as CategoryId) ?? { id: "general", name: "Mixed", blurb: "", hue: 310 };
}

export function categoryName(id: string): string {
  return categoryMeta(id).name;
}

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
