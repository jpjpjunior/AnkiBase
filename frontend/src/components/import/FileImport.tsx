import { useRef, useState } from 'react';
import { FileText, Upload, Loader2, CheckCircle2, AlertCircle, ClipboardPaste, Type } from 'lucide-react';
import { notes, type BulkSaveResult } from '../../api';

/** Delimiter-aware CSV line split (handles "quoted, values" and "" escapes). */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
  let best = ','; let bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map(l => splitLine(l, d).length);
    const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
    const consistent = counts.every(c => c === counts[0]) ? 1 : 0.5;
    const score = (avg - 1) * consistent;
    if (avg > 1 && score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** SRT / WebVTT cue texts in order (timestamps and markup stripped). */
function parseSubtitles(text: string): string[] {
  const clean = text.replace(/^WEBVTT.*$/m, '').replace(/^(Kind|Language):.*$/gm, '');
  const cues: string[] = [];
  for (const block of clean.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/).filter(l => l.trim());
    const idx = lines.findIndex(l => l.includes('-->'));
    if (idx === -1) continue;
    const cue = lines.slice(idx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (cue) cues.push(cue);
  }
  return cues;
}

const HEADER_RE = /^(front|back|term|definition|word|meaning|translation|question|answer|tags?)$/i;

interface Parsed {
  kind: 'delimited' | 'subtitles';
  delim: string;
  header: string[] | null;   // delimited: first row if it looks like a header
  matrix: string[][];        // delimited: data rows
  cues: string[];            // subtitles: cue texts
}

function parseFile(name: string, text: string): Parsed {
  const isSub = /\.(srt|vtt)$/i.test(name) || /^\uFEFF?WEBVTT/m.test(text);
  if (isSub) {
    return { kind: 'subtitles', delim: '', header: null, matrix: [], cues: parseSubtitles(text) };
  }
  const delim = sniffDelimiter(text);
  const allLines = text.split(/\r?\n/).filter(l => l.trim());
  const matrix = allLines.map(l => splitLine(l, delim));
  let header: string[] | null = null;
  if (matrix.length > 1) {
    const first = matrix[0];
    const hits = first.filter(c => HEADER_RE.test(c.trim())).length;
    if (hits >= 2 || (hits >= 1 && first.length >= 2 && first.every(c => c.length < 40))) {
      header = first;
      matrix.shift();
    }
  }
  return { kind: 'delimited', delim, header, matrix, cues: [] };
}

const LABEL = (v: string) => v.length > 28 ? v.slice(0, 28) + '…' : v;

export function FileImport() {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [colFront, setColFront] = useState(0);
  const [colBack, setColBack] = useState(1);
  const [colTags, setColTags] = useState(-1);
  const [deckName, setDeckName] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkSaveResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const ingest = (name: string, text: string) => {
    setError(null); setResult(null);
    try {
      const p = parseFile(name, text);
      if (p.kind === 'subtitles' && p.cues.length === 0) { setError('No subtitle cues found in that file.'); return; }
      if (p.kind === 'delimited' && (p.matrix.length === 0 || (p.matrix[0]?.length ?? 0) < 2)) {
        setError('Could not detect two columns. Use a separator like comma, semicolon, tab or | between front and back.');
        return;
      }
      setParsed(p);
      setFileName(name);
      setDeckName(name.replace(/\.[^.]+$/, '').trim() || 'Imported deck');
      if (p.kind === 'delimited') { setColFront(0); setColBack(1); setColTags(-1); }
    } catch {
      setError('Could not read that file.');
    }
  };

  const onFile = (file: File | undefined | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File too large (max 5 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => ingest(file.name, String(reader.result || ''));
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  // Cards built from the current mapping (max 1000 — the backend batch limit)
  const buildCards = () => {
    if (!parsed) return [];
    if (parsed.kind === 'subtitles') {
      return parsed.cues.slice(0, 1000).map(c => ({ front: c, back: '', tags: ['subtitle'] }));
    }
    const width = parsed.header?.length ?? parsed.matrix[0]?.length ?? 0;
    const f = Math.min(colFront, width - 1);
    const b = Math.min(colBack, width - 1);
    return parsed.matrix.slice(0, 1000).map(r => ({
      front: r[f] ?? '',
      back: r[b] ?? '',
      tags: colTags >= 0 && r[colTags] ? r[colTags].split(/[,;]\s*/).filter(Boolean).slice(0, 5) : [],
    })).filter(c => c.front);
  };

  const preview = buildCards();

  const save = async () => {
    if (!deckName.trim() || !preview.length || savingRef.current) return;
    savingRef.current = true;
    setBusy(true); setError(null);
    try {
      setResult(await notes.bulk(deckName.trim(), preview));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally { savingRef.current = false; setBusy(false); }
  };

  const colOptions = parsed?.kind === 'delimited'
    ? Array.from({ length: parsed.header?.length ?? parsed.matrix[0]?.length ?? 0 }, (_, i) => ({
      value: i, label: parsed.header ? LABEL(parsed.header[i] || `Column ${i + 1}`) : `Column ${i + 1}`,
    }))
    : [];

  return (
    <div className="space-y-4">
      {/* Drop zone / paste */}
      {!parsed && (
        <div className="card space-y-4">
          <div>
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Type className="w-4 h-4 text-(--accent)" /> From CSV, TSV or subtitles</h3>
            <p className="text-(--text-secondary) text-sm">
              Vocabulary lists (.csv / .tsv), or subtitle files (.srt / .vtt) — each cue becomes the front of a card.
            </p>
          </div>

          {!pasteMode ? (
            <>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition ${dragOver ? 'border-(--accent) bg-(--accent)/5' : 'border-(--bg-tertiary) hover:border-(--accent)/50'}`}
              >
                <Upload className="w-8 h-8 mx-auto text-(--text-secondary) mb-2" />
                <p className="text-sm font-medium">Drop a file here, or click to browse</p>
                <p className="text-xs text-(--text-secondary) mt-1">.csv · .tsv · .txt · .srt · .vtt (max 5 MB)</p>
                <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.srt,.vtt" className="hidden"
                  onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              <button onClick={() => setPasteMode(true)}
                className="btn btn-secondary text-sm inline-flex items-center gap-2 w-full sm:w-auto">
                <ClipboardPaste className="w-4 h-4" /> Or paste spreadsheet rows
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={'word,meaning\nこんにちは,hello\nありがとう,thank you'}
                className="input w-full h-36 font-mono text-sm resize-y" />
              <div className="flex gap-2">
                <button onClick={() => ingest('Pasted rows.csv', pasteText)} disabled={!pasteText.trim()}
                  className="btn btn-primary text-sm disabled:opacity-50">Parse text</button>
                <button onClick={() => { setPasteMode(false); setPasteText(''); }}
                  className="btn btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mapping + preview */}
      {parsed && (
        <div className="card space-y-4 anim-pop">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-(--accent)" />
            <h3 className="font-semibold flex-1 truncate">{fileName}</h3>
            <button onClick={() => { setParsed(null); setResult(null); }} className="btn btn-secondary text-xs py-1.5 px-3">Start over</button>
          </div>

          {parsed.kind === 'delimited' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-(--text-secondary) block mb-1.5">Front column</label>
                <select value={colFront} onChange={e => setColFront(Number(e.target.value))} className="input w-full text-sm">
                  {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-(--text-secondary) block mb-1.5">Back column</label>
                <select value={colBack} onChange={e => setColBack(Number(e.target.value))} className="input w-full text-sm">
                  {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-(--text-secondary) block mb-1.5">Tags column (optional)</label>
                <select value={colTags} onChange={e => setColTags(Number(e.target.value))} className="input w-full text-sm">
                  <option value={-1}>None</option>
                  {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {parsed.kind === 'subtitles' && (
            <p className="text-sm text-(--text-secondary)">
              {parsed.cues.length} subtitle cues found — each becomes a card with the cue on the front and an empty back
              you can fill in later.
            </p>
          )}

          <div className="rounded-xl border border-(--bg-tertiary) overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-(--bg-tertiary)/60 text-left text-xs text-(--text-secondary)">
                  <th className="px-3 py-2 font-medium">Front</th>
                  <th className="px-3 py-2 font-medium">Back</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 15).map((c, i) => (
                  <tr key={i} className="border-t border-(--bg-tertiary)">
                    <td className="px-3 py-2 align-top">{c.front || <span className="text-(--text-secondary)">—</span>}</td>
                    <td className="px-3 py-2 align-top">{c.back || <span className="text-(--text-secondary)">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-(--text-secondary)">
            Showing {Math.min(15, preview.length)} of <b>{preview.length}</b> cards{preview.length >= 1000 ? ' (first 1000 will import)' : ''}
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" value={deckName} onChange={e => setDeckName(e.target.value)}
              placeholder="Deck name" className="input flex-1" />
            <button onClick={save} disabled={busy || !deckName.trim() || !preview.length}
              className="btn btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Import {preview.length} card{preview.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="card bg-red-400/10 border border-red-400/30 flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="card bg-green-400/10 border border-green-400/30 flex items-center gap-3 text-sm anim-pop">
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
          <span><b>{result.created}</b> cards imported into <b>{result.deck}</b>
            {result.skipped > 0 && <> · {result.skipped} duplicates skipped</>}</span>
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold mb-3">Tips</h3>
        <ul className="list-disc list-inside space-y-2 text-(--text-secondary) text-sm">
          <li>Comma, semicolon, tab and | separators are detected automatically; quoted fields are supported.</li>
          <li>A header row like <code className="text-xs">front,back,tags</code> is detected and used for column mapping.</li>
          <li>For language decks put the word in the front column and its meaning/translation in the back column.</li>
          <li>Already-imported cards are skipped as duplicates, so re-importing after edits is safe.</li>
        </ul>
      </div>
    </div>
  );
}
