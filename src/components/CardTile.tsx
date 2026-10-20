import { useState } from 'react';
import type { CardImage, ComparedCard, Deck } from '../lib/types';
import { deckColor } from '../lib/colors';

interface Props {
  card: ComparedCard;
  image?: CardImage;
  decks: Deck[];
  /** Show quantity badges per deck. */
  showQuantities: boolean;
  /** Small tile: low-res image, no caption. */
  compact?: boolean;
}

export default function CardTile({ card, image, decks, showQuantities, compact = false }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [broken, setBroken] = useState(false);
  const src = flipped && image?.backImage ? image.backImage : compact ? image?.imageSmall ?? image?.image : image?.image;
  const deckIndex = (id: string) => decks.findIndex((d) => d.id === id);

  const memberDecks = card.deckIds.map((id) => decks[deckIndex(id)]).filter(Boolean);
  const title = `${card.name}\n` + memberDecks.map((d) => `${d.name}: ${card.quantities[d.id]}`).join('\n');

  return (
    <figure className={`card-tile${compact ? ' compact' : ''}`} title={title}>
      <div className="card-img-wrap">
        {src && !broken ? (
          <img src={src} alt={card.name} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <div className="card-placeholder">
            <span>{card.name}</span>
            {!image && <small>image unavailable</small>}
          </div>
        )}
        {image?.backImage && (
          <button
            type="button"
            className="flip-btn"
            onClick={(e) => {
              e.preventDefault();
              setFlipped((f) => !f);
            }}
            aria-label="Flip card"
            title="Flip"
          >
            ⇄
          </button>
        )}
        {showQuantities && (
          <div className="qty-badges">
            {card.deckIds.map((id) => (
              <span key={id} className="qty-badge" style={{ background: deckColor(deckIndex(id)) }}>
                {card.quantities[id]}
              </span>
            ))}
          </div>
        )}
      </div>
      {!compact && (
      <figcaption>
        {image?.scryfallUri ? (
          <a href={image.scryfallUri} target="_blank" rel="noreferrer">
            {card.name}
          </a>
        ) : (
          card.name
        )}
      </figcaption>
      )}
    </figure>
  );
}
