import { parseMoxfieldId } from '../lib/moxfield';
import { deckColor } from '../lib/colors';

export interface DeckInputRow {
  id: string;
  url: string;
  /** Pasted decklist text used instead of the URL (fallback). */
  text: string;
  showText: boolean;
  status: 'idle' | 'loading' | 'ok' | 'error';
  error?: string;
  loadedName?: string;
}

interface Props {
  rows: DeckInputRow[];
  disabled: boolean;
  onChange: (rows: DeckInputRow[]) => void;
  onSubmit: () => void;
}

export function newRow(url = ''): DeckInputRow {
  return { id: Math.random().toString(36).slice(2, 9), url, text: '', showText: false, status: 'idle' };
}

export default function DeckInputs({ rows, disabled, onChange, onSubmit }: Props) {
  const update = (id: string, patch: Partial<DeckInputRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch, status: patch.status ?? 'idle', error: undefined } : r)));

  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const add = () => onChange([...rows, newRow()]);

  const readyCount = rows.filter((r) => (r.showText ? r.text.trim() : parseMoxfieldId(r.url))).length;

  return (
    <form
      className="inputs"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {rows.map((row, i) => {
        const validUrl = row.url.trim() === '' || parseMoxfieldId(row.url) !== null;
        return (
          <div className={`input-row status-${row.status}`} key={row.id}>
            <span className="deck-dot" style={{ background: deckColor(i) }} aria-hidden />
            <div className="input-main">
              <div className="input-line">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://www.moxfield.com/decks/…"
                  value={row.url}
                  disabled={disabled}
                  aria-label={`Deck ${i + 1} Moxfield URL`}
                  aria-invalid={!validUrl}
                  onChange={(e) => update(row.id, { url: e.target.value })}
                />
                <button
                  type="button"
                  className="link-btn"
                  disabled={disabled}
                  onClick={() => update(row.id, { showText: !row.showText })}
                  title="Paste the decklist as text instead of a URL"
                >
                  {row.showText ? 'Use URL' : 'Paste list'}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={disabled || rows.length <= 2}
                  onClick={() => remove(row.id)}
                  aria-label="Remove deck"
                  title={rows.length <= 2 ? 'At least two decks are needed' : 'Remove deck'}
                >
                  ×
                </button>
              </div>
              {row.showText && (
                <textarea
                  rows={6}
                  placeholder={'Paste a decklist export, e.g.\n1 Sol Ring (C21) 263\n4 Lightning Bolt\nSideboard\n2 Rest in Peace'}
                  value={row.text}
                  disabled={disabled}
                  aria-label={`Deck ${i + 1} decklist text`}
                  onChange={(e) => update(row.id, { text: e.target.value })}
                />
              )}
              {!validUrl && <div className="hint error">That doesn’t look like a Moxfield deck URL.</div>}
              {row.status === 'error' && <div className="hint error">{row.error}</div>}
              {row.status === 'ok' && row.loadedName && <div className="hint ok">Loaded: {row.loadedName}</div>}
            </div>
          </div>
        );
      })}
      <div className="input-actions">
        <button type="button" className="secondary" onClick={add} disabled={disabled || rows.length >= 8}>
          + Add deck
        </button>
        <button type="submit" className="primary" disabled={disabled || readyCount < 2}>
          {disabled ? 'Loading…' : 'Compare'}
        </button>
      </div>
    </form>
  );
}
