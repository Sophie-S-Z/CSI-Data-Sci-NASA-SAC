import { createContext, useContext } from 'react';
import type { Sim } from '../ui/useSim';

export type Tab =
  | 'mission' | 'radiation' | 'weather' | 'air' | 'body' | 'checkin' | 'log' | 'ask' | 'cmo' | 'ground' | 'explorer'
  | 'evidence' | 'sources';
export type Theme = 'dark' | 'light';

export interface Ui {
  sim: Sim;
  tab: Tab;
  go: (tab: Tab) => void;
  openSource: (key: string) => void;
  procOpen: boolean;
  setProcOpen: (open: boolean) => void;
  openProcedure: () => void;
  /** Record a crew action on the action line, so each tap gives a visible change. */
  note: (msg: string) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const u = useContext(UiContext);
  if (!u) throw new Error('UiContext missing');
  return u;
}
