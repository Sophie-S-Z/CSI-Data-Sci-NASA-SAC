import { createContext, useContext } from 'react';
import type { Sim } from '../ui/useSim';
import type { Profile } from './profile';

export type Tab =
  | 'mission' | 'radiation' | 'weather' | 'air' | 'body' | 'checkin' | 'log' | 'report' | 'ask' | 'cmo' | 'ground' | 'explorer'
  | 'evidence' | 'research' | 'sources';
export type Theme = 'dark' | 'light';

export interface Ui {
  sim: Sim;
  tab: Tab;
  go: (tab: Tab) => void;
  openSource: (key: string) => void;
  /** The crew asked to see SH-1. It shows only while a procedure is open. */
  procOpen: boolean;
  setProcOpen: (open: boolean) => void;
  openProcedure: () => void;
  /** Record a crew action on the action line, so each tap gives a visible change. */
  note: (msg: string) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  profile: Profile;
  setProfile: (p: Profile) => void;
  openProfile: () => void;
}

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const u = useContext(UiContext);
  if (!u) throw new Error('UiContext missing');
  return u;
}
