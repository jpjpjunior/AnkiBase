import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wand2, Loader2, AlertTriangle, Settings2, Trash2, Sparkles, CheckCircle2, CheckSquare, Square, RotateCcw } from 'lucide-react';
import { decks, flashcards, notes, settings, type GeneratedFlashcard, type ProviderInfo } from '../api';
import { AiPanel, Select, type AiChoice } from './story/AiPanel';
import { Stepper } from './quizlet/ui';

const LANGUAGES = ['English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Russian', 'Hindi', 'Arabic', 'Turkish', 'Dutch', 'Polish', 'Vietnamese', 'Thai', 'Indonesian'];

const STYLE_OPTIONS = [
  { value: 'qa', label: 'Question → Answer' },
  { value: 'vocab', label: 'Vocabulary (term → meaning)' },
  { value: 'list', label: 'Key facts' },
];

interface DraftCard extends GeneratedFlashcard { include: boolean }

function loadChoice(): AiChoice {
  try {
    const c = JSON.parse(localStorage.getItem('story-ai') || 'null');
    if (c && typeof c.provider === 'string') return { provider: c.provider, model: c.model || '' };
  } catch { /* ignore */ }
  return { provider: '', model: '' };
}

export function AiFlashcards() {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [choice, setChoice] = useState<AiChoice>(loadChoice);
  const [panelOpen, setPanelOpen] = useState(false);

  const [source, setSource] = useState('');
  const [count, setCount] = useState(10);
  const [style, setStyle] = useState('qa');
  const [language, setLanguage] = useState('auto');
  const [defLang, setDefLang] = useState('');
  const [extra, setExtra] = useState('');

  const [cards, setCards] = useState<DraftCard[] | null>(null);
  const [genMeta, setGenMeta] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckNames, setDeckNames] = useState<string[]>([]);
  const [busyState, setBusyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; deck: string } | null>(null);
  const [savedDeckId, setSavedDeckId] = useState<number | null>(null);

  useEffect(() => { localStorage.setItem('story-ai', JSON.stringify(choice)); }, [choice]);

  const loadProviders = useCallback(() => {
    settings.getProviders().then(d => {
      setProviders(d.providers);
      setConfigured(Object.fromEntries(Object.entries(d.providers).map(([k, v]) => [k, v.configured])));
    }).catch(() => {});
  }, []);
  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => {
    decks.names().then(d => setDeckNames(Object.keys(d.decks).sort())).catch(() => {});
  }, []);

  const anyConfigured = Object.values(configured).some(Boolean);
  const pickedCount = cards?.filter(c => c.include && c.front.trim() && c.back.trim()).length ?? 0;

  const busyRef = useRef(false);
  const busy = busyState || busyRef.current;
  const generate = async () => {
    if (busyRef.current) return;
    setError(null); setResult(null); setSavedDeckId(null);
    if (source.trim().length < 3) { setError('Paste some source text first (or describe a topic).'); return; }
    busyRef.current = true;
    setBusyState(true);
    try {
      const r = await flashcards.generate({
        text: source, count, style, language,
        definition_language: defLang || undefined,
        extra_instructions: extra || undefined,
        provider: choice.provider || undefined,
        model: choice.model || undefined,
      });
      setCards(r.cards.map(c => ({ ...c, include: true })));
      setGenMeta([r.provider_used, r.model_used].filter(Boolean).join(' · ') || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally { busyRef.current = false; setBusyState(false); }
  };

  const savingRef = useRef(false);
  const save = async () => {
    const picked = (cards ?? []).filter(c => c.include && c.front.trim() && c.back.trim());
    if (!deckName.trim() || !picked.length || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError(null);
    try {
      const r = await notes.bulk(deckName.trim(), picked.map(c => ({ front: c.front, back: c.back, tags: c.tags })));
      setResult({ created: r.created, skipped: r.skipped, deck: r.deck });
      setCards(null); setSource('');
      const names = await decks.names();
      setDeckNames(Object.keys(names.decks).sort());
      setSavedDeckId(Object.entries(names.decks).find(([n]) => n === r.deck)?.[1] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the cards');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const updateCard = (i: number, patch: Partial<DraftCard>) =>
    setCards(cs => (cs ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-(--accent)/15 text-(--accent) flex items-center justify-center shrink-0">
          <Wand2 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight">AI Flashcards</h1>
          <p className="text-sm text-(--text-secondary)">Paste any text — get ready-to-study cards in your deck.</p>
        </div>
        <button onClick={() => setPanelOpen(true)} className="btn btn-secondary text-sm shrink-0 inline-flex items-center gap-2">
          <Settings2 className="w-4 h-4" /> AI settings
        </button>
      </div>

      {!anyConfigured && (
        <div className="card border border-(--warning)/40 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-(--warning) shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium">No AI provider connected yet.</p>
            <p className="text-(--text-secondary) mt-0.5">
              Add an API key for OpenAI, Claude or Gemini — or point the <b>Custom</b> provider at any OpenAI-compatible
              server (Ollama, LM Studio, OpenRouter…).
            </p>
            <button onClick={() => setPanelOpen(true)} className="btn btn-primary text-sm mt-3 inline-flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Connect a provider
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="card bg-red-400/10 border border-red-400/30 flex items-center gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Source */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold">Source material</h2>
          <p className="text-xs text-(--text-secondary) mt-0.5">
            Class notes, an article, song lyrics, a Wikipedia section, or just a topic like “Japanese counters”.
          </p>
        </div>
        <textarea value={source} onChange={e => setSource(e.target.value)}
          placeholder="Paste your text here…"
          className="input w-full h-40 resize-y leading-relaxed" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-(--text-secondary) block mb-1.5">Cards</label>
            <Stepper value={count} min={1} max={50} onChange={setCount} />
          </div>
          <div>
            <label className="text-xs text-(--text-secondary) block mb-1.5">Style</label>
            <Select value={style} onChange={setStyle} options={STYLE_OPTIONS} />
          </div>
          <div>
            <label className="text-xs text-(--text-secondary) block mb-1.5">Card language</label>
            <Select value={language} onChange={setLanguage}
              options={[{ value: 'auto', label: 'Auto-detect' }, ...LANGUAGES.map(l => ({ value: l, label: l }))]} />
          </div>
          <div>
            <label className="text-xs text-(--text-secondary) block mb-1.5">Back side in</label>
            <Select value={defLang} onChange={setDefLang}
              options={[{ value: '', label: 'Same as front' }, ...LANGUAGES.map(l => ({ value: l, label: l }))]} />
          </div>
        </div>
        <input type="text" value={extra} onChange={e => setExtra(e.target.value)}
          placeholder="Optional instructions, e.g. “beginner level, focus on verbs”"
          className="input w-full text-sm" />
        <button onClick={generate} disabled={busy || !anyConfigured}
          className="btn btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? 'Generating…' : `Generate ${count} cards`}
        </button>
      </div>

      {/* Preview & edit */}
      {cards && cards.length > 0 && (
        <div className="card space-y-3 anim-pop">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold flex-1">{cards.length} cards generated{genMeta ? ` · ${genMeta}` : ''}</h2>
            <button onClick={() => setCards(cs => (cs ?? []).map(c => ({ ...c, include: true })))}
              className="btn btn-secondary text-xs py-1.5 px-3">Select all</button>
            <button onClick={() => setCards(cs => (cs ?? []).map(c => ({ ...c, include: false })))}
              className="btn btn-secondary text-xs py-1.5 px-3">None</button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {cards.map((c, i) => (
              <div key={i} className={`rounded-xl p-2.5 transition ${c.include ? 'bg-(--bg-tertiary)/60' : 'bg-(--bg-tertiary)/20 opacity-50'}`}>
                <div className="flex items-start gap-2.5">
                  <button onClick={() => updateCard(i, { include: !c.include })} className="mt-1.5 text-(--text-secondary) hover:text-(--accent)" title={c.include ? 'Exclude' : 'Include'}>
                    {c.include ? <CheckSquare className="w-4 h-4 text-(--accent)" /> : <Square className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 grid gap-2 sm:grid-cols-2">
                    <input type="text" value={c.front} onChange={e => updateCard(i, { front: e.target.value })}
                      placeholder="Front" className="input w-full text-sm" />
                    <input type="text" value={c.back} onChange={e => updateCard(i, { back: e.target.value })}
                      placeholder="Back" className="input w-full text-sm" />
                  </div>
                  <button onClick={() => setCards(cs => (cs ?? []).filter((_, j) => j !== i))}
                    className="icon-btn icon-btn-danger shrink-0" title="Delete card"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {c.tags && c.tags.length > 0 && (
                  <div className="flex gap-1.5 mt-1.5 ml-7">
                    {c.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-(--text-secondary)">{t}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Destination */}
      {cards && cards.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Add to deck</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" value={deckName} onChange={e => setDeckName(e.target.value)} list="ai-deck-list"
              placeholder="Deck name (new or existing)" className="input flex-1" />
            <datalist id="ai-deck-list">{deckNames.map(n => <option key={n} value={n} />)}</datalist>
            <button onClick={save} disabled={saving || !deckName.trim() || pickedCount === 0}
              className="btn btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Add {pickedCount} card{pickedCount === 1 ? '' : 's'}
            </button>
          </div>
          <p className="text-xs text-(--text-secondary)">Duplicates are skipped automatically.</p>
        </div>
      )}

      {result && (
        <div className="card bg-green-400/10 border border-green-400/30 anim-pop space-y-2">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <p className="text-sm flex-1">
              <b>{result.created}</b> card{result.created === 1 ? '' : 's'} added to <b>{result.deck}</b>
              {result.skipped > 0 && <> · {result.skipped} duplicate{result.skipped === 1 ? '' : 's'} skipped</>}
            </p>
            {savedDeckId && (
              <Link to={`/anki/${savedDeckId}/study`} className="btn btn-primary text-sm shrink-0">Study now</Link>
            )}
          </div>
        </div>
      )}

      {panelOpen && (
        <AiPanel providers={providers} configured={configured} choice={choice} onChoice={setChoice}
          onKeysChanged={loadProviders} onClose={() => setPanelOpen(false)} title="AI settings" />
      )}

      {/* Hidden helper for styling parity with the rest of the app (reset affordance kept subtle) */}
      {cards && cards.length === 0 && (
        <div className="card text-center text-sm text-(--text-secondary) flex items-center justify-center gap-2">
          No cards made it through — try adjusting the instructions. <RotateCcw className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
