import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckInputs, { newRow, type DeckInputRow } from './components/DeckInputs';
import Results from './components/Results';
import TrafficNotice from './components/TrafficNotice';
import { compareDecks } from './lib/compare';
import { loadMoxfieldDeck, parseMoxfieldId, parseTextDecklist } from './lib/moxfield';
import { cacheKeyFor, fetchCardImages, type Identifier } from './lib/scryfall';
import { fetchTrafficStatus, type TrafficStatus } from './lib/status';
import type { CardImage, ComparedCard, Deck } from './lib/types';

function rowsFromUrl(): DeckInputRow[] {
  const params = new URLSearchParams(window.location.search);
  const ids = (params.get('d') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = ids.map((id) => newRow(`https://www.moxfield.com/decks/${id}`));
  while (rows.length < 2) rows.push(newRow());
  return rows;
}

function identifierFor(card: ComparedCard): Identifier {
  return card.scryfallId ? { id: card.scryfallId } : { name: card.name.split(' // ')[0] };
}

export default function App() {
  const [rows, setRows] = useState<DeckInputRow[]>(rowsFromUrl);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<Map<string, CardImage>>(new Map());
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [traffic, setTraffic] = useState<TrafficStatus | null>(null);

  // Poll the rate-limit schedule: once on load, then every 2.5 s while decks are loading,
  // so users see when they are queued behind other people's requests.
  useEffect(() => {
    const ac = new AbortController();
    const tick = () => void fetchTrafficStatus(ac.signal).then((s) => s && setTraffic(s));
    tick();
    if (!loading) return () => ac.abort();
    const timer = setInterval(tick, 2500);
    return () => {
      clearInterval(timer);
      ac.abort();
    };
  }, [loading]);

  const result = useMemo(() => (decks && decks.length >= 2 ? compareDecks(decks) : null), [decks]);

  const imageKey = useCallback((card: ComparedCard) => cacheKeyFor(identifierFor(card)), []);

  // Load Scryfall images whenever the compared card set changes.
  useEffect(() => {
    if (!result) return;
    const cards = Object.values(result.all);
    if (cards.length === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setImageError(null);
    const idents = cards.map(identifierFor);
    fetchCardImages(idents, (done, total) => setImageProgress({ done, total }), ac.signal)
      .then((map) => {
        if (ac.signal.aborted) return;
        setImages((prev) => new Map([...prev, ...map]));
        setImageProgress(null);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setImageError(`Could not load card images from Scryfall: ${(err as Error).message}`);
        setImageProgress(null);
      });
    return () => ac.abort();
  }, [result]);

  const compare = async () => {
    setLoading(true);
    setDecks(null);
    const active = rows.filter((r) => (r.showText ? r.text.trim() : r.url.trim()));
    const loaded: (Deck | null)[] = new Array(active.length).fill(null);
    const next = rows.map((r) => ({ ...r, status: active.includes(r) ? ('loading' as const) : ('idle' as const), error: undefined }));
    setRows(next);

    // Decks are loaded one after another: the server allows one Moxfield call per
    // second globally, so parallel requests would only queue up behind each other.
    for (const [i, row] of active.entries()) {
      const deckId = `d${i}`;
      try {
        let deck: Deck;
        if (row.showText && row.text.trim()) {
          const publicId = parseMoxfieldId(row.url);
          deck = parseTextDecklist(row.text, deckId, `Pasted deck ${i + 1}`);
          if (publicId) {
            deck.url = `https://www.moxfield.com/decks/${publicId}`;
            deck.publicId = publicId;
          }
        } else {
          const publicId = parseMoxfieldId(row.url);
          if (!publicId) throw new Error('Not a valid Moxfield deck URL.');
          deck = await loadMoxfieldDeck(publicId, deckId, undefined, (seconds) =>
            setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: 'loading', loadedName: `Queued, retrying in ${seconds}s…` } : r))),
          );
        }
        if (deck.cards.length === 0) throw new Error('No cards found in this deck.');
        loaded[i] = deck;
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: 'ok', loadedName: deck.name } : r)));
      } catch (err) {
        const message = (err as Error).message;
        setRows((rs) =>
          rs.map((r) =>
            r.id === row.id
              ? { ...r, status: 'error', error: message, loadedName: undefined, showText: r.showText || /403|refused|non-JSON|reach/i.test(message) }
              : r,
          ),
        );
      }
    }

    const ok = loaded.filter((d): d is Deck => d !== null);
    if (ok.length >= 2) {
      setDecks(ok);
      // Shareable URL: only for Moxfield-sourced decks.
      const ids = ok.map((d) => d.publicId).filter(Boolean);
      const url = new URL(window.location.href);
      if (ids.length === ok.length) url.searchParams.set('d', ids.join(','));
      else url.searchParams.delete('d');
      window.history.replaceState(null, '', url.toString());
    }
    setLoading(false);
  };

  // Auto-compare when arriving with ?d=… in the URL.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (rows.filter((r) => parseMoxfieldId(r.url)).length >= 2) void compare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failedCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Decklist Compare</h1>
        <p className="tagline">
          Paste two or more <a href="https://www.moxfield.com">Moxfield</a> deck links to see which mainboard cards they share and which
          are unique.
        </p>
        <ul className="limitations" aria-label="How this app works and its limitations">
          <li>
            <strong>One Moxfield request per second, for everyone.</strong> When
            several people compare at once, requests queue up and loading is slower. A notice appears above when that happens.
          </li>
          <li>
            <strong>Decks are cached for up to 12 hours.</strong> Edits made on Moxfield after a deck was first loaded here may not
            show until the cache expires.
          </li>
        </ul>
      </header>

      <TrafficNotice status={traffic} />

      <DeckInputs rows={rows} disabled={loading} onChange={setRows} onSubmit={() => void compare()} />

      {failedCount > 0 && !loading && (
        <p className="notice">
          {failedCount} deck{failedCount > 1 ? 's' : ''} could not be loaded. Fix the URL, or use “Paste list” to paste the
          decklist text (Moxfield: More → Export).
        </p>
      )}
      {imageError && <p className="notice">{imageError}</p>}

      {result && <Results result={result} images={images} imageKey={imageKey} imageProgress={imageProgress} />}

      <footer className="app-footer">
        Card data and images from <a href="https://scryfall.com">Scryfall</a>. Decklists from{' '}
        <a href="https://www.moxfield.com">Moxfield</a>. Not affiliated with either, nor with Wizards of the Coast.
      </footer>
    </div>
  );
}
