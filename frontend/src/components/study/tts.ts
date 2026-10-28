/** Text-to-speech pronunciation for cards (Web Speech API — free, offline, no keys). */

export interface TtsLocale { code: string; label: string }

export const TTS_LOCALES: TtsLocale[] = [
  { code: '', label: 'Auto language' },
  { code: 'en-US', label: 'English' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'th-TH', label: 'Thai' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'el-GR', label: 'Greek' },
  { code: 'he-IL', label: 'Hebrew' },
];

export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Card field HTML -> speakable plain text (strips Anki audio markers, tags, entities). */
export function htmlToText(html: string): string {
  let s = html || '';
  s = s.replace(/\[sound:[^\]]*\]/gi, ' ');
  s = s.replace(/\[anki:play:[qa]:\d+\]/gi, ' ');
  try {
    const doc = new DOMParser().parseFromString(s, 'text/html');
    s = doc.body?.textContent ?? '';
  } catch {
    s = s.replace(/<[^>]*>/g, ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Speak text with the given BCP-47 locale ('' = browser default). Returns false if unavailable. */
export function speakText(text: string, locale: string = '', rate = 0.95): boolean {
  if (!ttsAvailable() || !text) return false;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  if (locale) u.lang = locale;
  u.rate = rate;
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (ttsAvailable()) window.speechSynthesis.cancel();
}
