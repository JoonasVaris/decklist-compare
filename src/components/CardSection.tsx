import { useState } from 'react';
import type { CardImage, ComparedCard, Deck } from '../lib/types';
import CardTile from './CardTile';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  accent?: string;
  cards: ComparedCard[];
  decks: Deck[];
  images: Map<string, CardImage>;
  imageKey: (card: ComparedCard) => string;
  view: 'images' | 'compact' | 'list';
  showQuantities: boolean;
  defaultOpen?: boolean;
}

export default function CardSection({
  id,
  title,
  subtitle,
  accent,
  cards,
  decks,
  images,
  imageKey,
  view,
  showQuantities,
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card-section" id={id} style={accent ? { ['--accent' as string]: accent } : undefined}>
      <button type="button" className="section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="section-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="section-title">{title}</span>
        <span className="section-count">
          {cards.length} card{cards.length === 1 ? '' : 's'}
        </span>
        {subtitle && <span className="section-subtitle">{subtitle}</span>}
      </button>
      {open &&
        (cards.length === 0 ? (
          <p className="empty">None.</p>
        ) : view !== 'list' ? (
          <div className={`card-grid${view === 'compact' ? ' compact' : ''}`}>
            {cards.map((c) => (
              <CardTile
                key={c.key}
                card={c}
                image={images.get(imageKey(c))}
                decks={decks}
                showQuantities={showQuantities}
                compact={view === 'compact'}
              />
            ))}
          </div>
        ) : (
          <ul className="card-list">
            {cards.map((c) => {
              const img = images.get(imageKey(c));
              return (
                <li key={c.key}>
                  {showQuantities && (
                    <span className="list-qty">
                      {decks.map((d) => (
                        <span key={d.id} className={c.quantities[d.id] ? 'has' : 'none'}>
                          {c.quantities[d.id] ?? '–'}
                        </span>
                      ))}
                    </span>
                  )}
                  {img?.scryfallUri ? (
                    <a href={img.scryfallUri} target="_blank" rel="noreferrer" className="list-name">
                      {c.name}
                    </a>
                  ) : (
                    <span className="list-name">{c.name}</span>
                  )}
                  {img?.typeLine && <span className="list-type">{img.typeLine}</span>}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
