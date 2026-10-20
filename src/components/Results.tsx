import { useMemo, useState } from 'react';
import type { CardImage, ComparedCard, ComparisonResult } from '../lib/types';
import { overlapMatrix } from '../lib/compare';
import { deckColor } from '../lib/colors';
import CardSection from './CardSection';

interface Props {
  result: ComparisonResult;
  images: Map<string, CardImage>;
  imageKey: (card: ComparedCard) => string;
  imageProgress?: { done: number; total: number } | null;
}

type View = 'images' | 'compact' | 'list';
const VIEWS: View[] = ['images', 'compact', 'list'];

/** Initial view: ?view=… in the URL, then the last choice saved in localStorage, then images. */
function initialView(): View {
  const fromUrl = new URLSearchParams(window.location.search).get('view');
  if (VIEWS.includes(fromUrl as View)) return fromUrl as View;
  try {
    const saved = localStorage.getItem('dc.view');
    if (VIEWS.includes(saved as View)) return saved as View;
  } catch {
    /* ignore */
  }
  return 'images';
}

export default function Results({ result, images, imageKey, imageProgress }: Props) {
  const { decks, common, partial, unique } = result;
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem('dc.view', v);
    } catch {
      /* ignore */
    }
  };
  const [showQuantities, setShowQuantities] = useState(true);
  const [filter, setFilter] = useState('');
  const [groupPartial, setGroupPartial] = useState(true);

  const matrix = useMemo(() => overlapMatrix(result), [result]);
  const q = filter.trim().toLowerCase();
  const matches = (c: ComparedCard) => !q || c.name.toLowerCase().includes(q);

  // Group partial cards by the exact set of decks they appear in.
  const partialGroups = useMemo(() => {
    const groups = new Map<string, ComparedCard[]>();
    for (const c of partial) {
      const key = c.deckIds.join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [partial]);

  const deckIdx = (id: string) => decks.findIndex((d) => d.id === id);
  const deckLabel = (id: string) => decks[deckIdx(id)]?.name ?? id;
  const totalPerDeck = decks.map((d) => Object.values(result.all).filter((c) => d.id in c.quantities).length);

  return (
    <div className="results">
      <div className="summary">
        <div className="deck-legend">
          {decks.map((d, i) => (
            <div className="legend-item" key={d.id}>
              <span className="deck-dot" style={{ background: deckColor(i) }} />
              <div>
                <div className="legend-name">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer">
                      {d.name}
                    </a>
                  ) : (
                    d.name
                  )}
                </div>
                <div className="legend-meta">
                  {[d.author && `by ${d.author}`, d.format, `${totalPerDeck[i]} distinct cards`, `${unique[d.id].length} unique`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="stats">
          <a className="stat" href="#common">
            <strong>{common.length}</strong>
            <span>in all {decks.length} decks</span>
          </a>
          {decks.length > 2 && (
            <a className="stat" href="#partial">
              <strong>{partial.length}</strong>
              <span>shared by some</span>
            </a>
          )}
          <a className="stat" href="#unique">
            <strong>{Object.values(unique).reduce((s, l) => s + l.length, 0)}</strong>
            <span>unique in total</span>
          </a>
        </div>

        {decks.length > 1 && (
          <table className="overlap" aria-label="Pairwise overlap (Jaccard similarity)">
            <thead>
              <tr>
                <th>Overlap</th>
                {decks.map((d, i) => (
                  <th key={d.id} title={d.name}>
                    <span className="deck-dot" style={{ background: deckColor(i) }} /> {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decks.map((d, i) => (
                <tr key={d.id}>
                  <th title={d.name}>
                    <span className="deck-dot" style={{ background: deckColor(i) }} /> {i + 1}. {d.name}
                  </th>
                  {decks.map((e, j) => (
                    <td
                      key={e.id}
                      className={i === j ? 'diag' : ''}
                      style={i === j ? undefined : { background: `rgba(59,130,246,${0.08 + matrix[i][j] * 0.6})` }}
                    >
                      {i === j ? '—' : `${Math.round(matrix[i][j] * 100)}%`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter cards by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter cards"
        />
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={view === 'images' ? 'on' : ''} onClick={() => setView('images')}>
            Images
          </button>
          <button type="button" className={view === 'compact' ? 'on' : ''} onClick={() => setView('compact')}>
            Compact
          </button>
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            List
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={showQuantities} onChange={(e) => setShowQuantities(e.target.checked)} /> Quantities
        </label>
        {decks.length > 2 && (
          <label className="check">
            <input type="checkbox" checked={groupPartial} onChange={(e) => setGroupPartial(e.target.checked)} /> Group shared by deck combo
          </label>
        )}
        {imageProgress && imageProgress.total > 0 && imageProgress.done < imageProgress.total && (
          <span className="progress">
            Loading images {imageProgress.done}/{imageProgress.total}…
          </span>
        )}
      </div>

      <CardSection
        id="common"
        title={`In all ${decks.length} decks`}
        subtitle="Cards every deck runs"
        accent="#10b981"
        cards={common.filter(matches)}
        decks={decks}
        images={images}
        imageKey={imageKey}
        view={view}
        showQuantities={showQuantities}
      />

      {decks.length > 2 && (
        <div id="partial">
          {groupPartial ? (
            partialGroups.length === 0 ? (
              <CardSection
                id="partial-none"
                title="Shared by some decks"
                accent="#f59e0b"
                cards={[]}
                decks={decks}
                images={images}
                imageKey={imageKey}
                view={view}
                showQuantities={showQuantities}
              />
            ) : (
              partialGroups.map(([key, cards]) => (
                <CardSection
                  key={key}
                  id={`partial-${key}`}
                  title={`Shared by ${cards[0].deckIds.length} of ${decks.length}`}
                  subtitle={cards[0].deckIds.map((id) => `${deckIdx(id) + 1}. ${deckLabel(id)}`).join(' + ')}
                  accent="#f59e0b"
                  cards={cards.filter(matches)}
                  decks={decks}
                  images={images}
                  imageKey={imageKey}
                  view={view}
                  showQuantities={showQuantities}
                />
              ))
            )
          ) : (
            <CardSection
              id="partial-all"
              title="Shared by some decks"
              subtitle="In two or more decks, but not all"
              accent="#f59e0b"
              cards={partial.filter(matches)}
              decks={decks}
              images={images}
              imageKey={imageKey}
              view={view}
              showQuantities={showQuantities}
            />
          )}
        </div>
      )}

      <div id="unique">
        {decks.map((d, i) => (
          <CardSection
            key={d.id}
            id={`unique-${d.id}`}
            title={`Only in ${i + 1}. ${d.name}`}
            accent={deckColor(i)}
            cards={unique[d.id].filter(matches)}
            decks={decks}
            images={images}
            imageKey={imageKey}
            view={view}
            showQuantities={showQuantities}
          />
        ))}
      </div>
    </div>
  );
}
