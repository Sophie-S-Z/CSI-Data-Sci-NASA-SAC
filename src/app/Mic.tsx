import { useEffect, useRef, useState } from 'react';
import { Mic as MicIcon, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** The part of the Web Speech API that this button uses. TypeScript has no built-in type for it. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const SpeechCtor: RecognitionCtor | undefined = typeof window === 'undefined' ? undefined
  : ((window as unknown as Record<string, RecognitionCtor | undefined>).SpeechRecognition ?? (window as unknown as Record<string, RecognitionCtor | undefined>).webkitSpeechRecognition);

/** The one session that listens now. A new tap on any Mic stops it first, so 2 sessions never overlap. */
let live: Recognition | null = null;

/**
 * Voice input for a text field. Tap, speak, and the words go to `onText`.
 * In a browser without speech recognition, the button is disabled and the field works as before.
 */
export function Mic({ onText, label = 'Speak', className }: { onText: (text: string) => void; label?: string; className?: string }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  // Without speech recognition (for example Firefox), the button stays in place, disabled, and says why. Typing still works.
  if (!SpeechCtor) {
    return (
      <Button type="button" variant="outline" size="icon" disabled aria-label={`${label}: voice input is not available in this browser. Type instead.`}
        title="Voice input needs Chrome, Edge, or Safari. Type instead." className={cn('size-11 shrink-0 rounded-md', className)}>
        <MicOff className="size-5" aria-hidden="true" />
      </Button>
    );
  }

  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const r = new SpeechCtor();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => {
      const text = Array.from(e.results, (x) => x[0].transcript).join(' ').trim();
      if (text) onText(text);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone blocked. Allow it in the browser settings.' : 'No speech heard. Try again.');
    r.onend = () => { setOn(false); if (live === r) live = null; };
    live?.stop();
    live = r;
    rec.current = r;
    setError('');
    setOn(true);
    r.start();
  };

  return (
    <Button type="button" variant={on ? 'default' : 'outline'} size="icon" onClick={toggle}
      aria-label={on ? 'Stop voice input' : label} aria-pressed={on} title={error || (on ? 'Listening. Tap to stop.' : label)}
      className={cn('size-11 shrink-0 rounded-md', on && 'pulse-ring', className)}>
      {error && !on ? <MicOff className="size-5" aria-hidden="true" /> : <MicIcon className="size-5" aria-hidden="true" />}
    </Button>
  );
}
