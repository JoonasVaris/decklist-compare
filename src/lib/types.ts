export type Board = 'mainboard' | 'commanders' | 'companions' | 'sideboard' | 'maybeboard';

export interface DeckCard {
  /** Canonical card name as printed on Moxfield (front face for DFCs is joined with " // "). */
  name: string;
  quantity: number;
  board: Board;
  /** Scryfall printing id when known (from Moxfield). */
  scryfallId?: string;
  set?: string;
  collectorNumber?: string;
}

export interface Deck {
  /** Stable id for this deck within the comparison (index-based). */
  id: string;
  name: string;
  author?: string;
  format?: string;
  url?: string;
  /** Moxfield public id if loaded from Moxfield. */
  publicId?: string;
  cards: DeckCard[];
  source: 'moxfield' | 'text';
}

export interface CardImage {
  /** Scryfall card id */
  id: string;
  name: string;
  /** Normal-size image URL (front face for DFCs). */
  image?: string;
  /** Small image URL for thumbnails. */
  imageSmall?: string;
  /** Back face image URL when present. */
  backImage?: string;
  scryfallUri?: string;
  typeLine?: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  colorIdentity?: string[];
}

/** One row of the comparison: a card name, and which decks hold it at what quantity. */
export interface ComparedCard {
  key: string;
  name: string;
  /** deck id -> quantity (only decks containing the card) */
  quantities: Record<string, number>;
  /** Ordered list of deck ids containing the card. */
  deckIds: string[];
  /** Best-known scryfall id for image lookup. */
  scryfallId?: string;
}

export interface ComparisonResult {
  decks: Deck[];
  /** Cards present in every deck. */
  common: ComparedCard[];
  /** Cards present in 2+ decks but not all. Empty when only two decks are compared. */
  partial: ComparedCard[];
  /** Cards only in one deck, keyed by deck id. */
  unique: Record<string, ComparedCard[]>;
  /** Every compared card by key. */
  all: Record<string, ComparedCard>;
}
