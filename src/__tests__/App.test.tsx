import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';

/** Fake Scryfall: returns a card object for every name identifier. */
function fakeScryfall(identifiers: Array<{ name?: string; id?: string }>) {
  return {
    object: 'list',
    not_found: [],
    data: identifiers.map((i, n) => ({
      id: i.id ?? `id-${n}`,
      name: i.name ?? `Card ${n}`,
      scryfall_uri: `https://scryfall.com/card/${n}`,
      type_line: 'Artifact',
      image_uris: { normal: `https://img/${encodeURIComponent(i.name ?? n)}.jpg`, small: 'https://img/s.jpg' },
    })),
  };
}

const moxDeck = (publicId: string, name: string, cards: Array<[string, number]>) => ({
  publicId,
  name,
  format: 'commander',
  createdByUser: { userName: 'tester' },
  boards: {
    mainboard: {
      count: cards.length,
      cards: Object.fromEntries(cards.map(([n, q], i) => [`k${i}`, { quantity: q, card: { name: n, scryfall_id: `sf-${n}` } }])),
    },
  },
});

let trafficStatus = { busyMs: 0, queuedCalls: 0, minGapMs: 1100 };

describe('App end-to-end (mocked network)', () => {
  beforeEach(() => {
    trafficStatus = { busyMs: 0, queuedCalls: 0, minGapMs: 1100 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/status')) {
          return new Response(JSON.stringify(trafficStatus), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.startsWith('/api/moxfield')) {
          const id = new URL(url, 'http://x').searchParams.get('id');
          if (id === 'AAAAAAAAAAAAAAAAAAAAAA')
            return new Response(JSON.stringify(moxDeck(id, 'Deck Alpha', [['Sol Ring', 1], ['Arcane Signet', 1], ['Island', 30]])), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (id === 'BBBBBBBBBBBBBBBBBBBBBB')
            return new Response(JSON.stringify(moxDeck(id, 'Deck Beta', [['Sol Ring', 1], ['Swamp', 30]])), { status: 200, headers: { 'Content-Type': 'application/json' } });
          return new Response(JSON.stringify({ error: 'Deck not found. Is it public?' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('api.scryfall.com/cards/collection')) {
          const body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify(fakeScryfall(body.identifiers)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads two Moxfield decks, compares them and shows images', async () => {
    render(<App />);
    const inputs = screen.getAllByPlaceholderText(/moxfield\.com\/decks/);
    fireEvent.change(inputs[0], { target: { value: 'https://www.moxfield.com/decks/AAAAAAAAAAAAAAAAAAAAAA' } });
    fireEvent.change(inputs[1], { target: { value: 'https://www.moxfield.com/decks/BBBBBBBBBBBBBBBBBBBBBB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    await screen.findByText('Loaded: Deck Alpha');
    await screen.findByText('Loaded: Deck Beta');

    const common = await screen.findByRole('button', { name: /In all 2 decks/ });
    expect(common).toHaveTextContent('1 card');
    expect(screen.getByRole('button', { name: /Only in 1\. Deck Alpha/ })).toHaveTextContent('2 cards');
    expect(screen.getByRole('button', { name: /Only in 2\. Deck Beta/ })).toHaveTextContent('1 card');
    // No "shared by some" section for two decks.
    expect(screen.queryByText(/Shared by some/)).toBeNull();

    // Images resolved through Scryfall (by scryfall id).
    await waitFor(() => expect(screen.getByAltText('Sol Ring')).toBeInTheDocument());
    // Shareable URL updated.
    expect(window.location.search).toContain('d=AAAAAAAAAAAAAAAAAAAAAA%2CBBBBBBBBBBBBBBBBBBBBBB');
  });

  it('falls back to pasted text and shows the partial category for three decks', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add deck' }));
    const pasteButtons = screen.getAllByRole('button', { name: 'Paste list' });
    expect(pasteButtons).toHaveLength(3);
    pasteButtons.forEach((b) => fireEvent.click(b));
    const areas = screen.getAllByRole('textbox', { name: /decklist text/ });
    fireEvent.change(areas[0], { target: { value: '1 Sol Ring\n1 Counterspell\n1 Island' } });
    fireEvent.change(areas[1], { target: { value: '1 Sol Ring\n1 Counterspell\n1 Swamp' } });
    fireEvent.change(areas[2], { target: { value: '1 Sol Ring\n1 Mountain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    const common = await screen.findByRole('button', { name: /In all 3 decks/ });
    expect(common).toHaveTextContent('1 card');
    const partial = screen.getByRole('button', { name: /Shared by 2 of 3/ });
    expect(partial).toHaveTextContent('1 card');
    expect(within(partial).getByText(/Pasted deck 1 \+ 2\. Pasted deck 2/)).toBeInTheDocument();
    // The URL is not made shareable for pasted decks.
    expect(window.location.search).not.toContain('d=');
  });

  it('shows a per-deck error and opens the paste box when Moxfield refuses', async () => {
    render(<App />);
    const inputs = screen.getAllByPlaceholderText(/moxfield\.com\/decks/);
    fireEvent.change(inputs[0], { target: { value: 'https://www.moxfield.com/decks/AAAAAAAAAAAAAAAAAAAAAA' } });
    fireEvent.change(inputs[1], { target: { value: 'https://www.moxfield.com/decks/CCCCCCCCCCCCCCCCCCCCCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await screen.findByText('Deck not found. Is it public?');
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /In all/ })).toBeNull();
  });

  it('shows a traffic notice when the shared rate-limit queue is busy', async () => {
    trafficStatus = { busyMs: 8049, queuedCalls: 8, minGapMs: 1100 };
    render(<App />);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Busy right now, loading will be slower.');
  });

  it('stays quiet when the queue is short', async () => {
    trafficStatus = { busyMs: 900, queuedCalls: 1, minGapMs: 1100 };
    render(<App />);
    // Let the status fetch resolve.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
