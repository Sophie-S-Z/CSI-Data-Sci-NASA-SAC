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

/**
 * Voice input for a text field. Tap, speak, and the words go to `onText`.
 * The button does not show in a browser without speech recognition, so the field works as before.
 */
export function Mic({ onText, label = 'Speak', className }: { onText: (text: string) => void; label?: string; className?: string }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!SpeechCtor) return null;

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
    r.onend = () => setOn(false);
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
