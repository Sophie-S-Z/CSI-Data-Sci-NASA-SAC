import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useUi, type Tab, type Theme } from './context';
import { Mic } from './Mic';
import { ENGINE_LABEL, ROLES, initials } from './profile';
import { Seg } from './parts';

const field = 'h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

/** The crew member's profile: name, role, look, and links to the AI and personal limits. All of it stays on this device. */
export function ProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile: p, setProfile, theme, setTheme, go } = useUi();
  const to = (t: Tab) => { go(t); onOpenChange(false); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <div className="grid size-14 place-items-center rounded-full bg-primary/15 text-xl font-semibold text-primary ring-1 ring-primary/30" aria-hidden="true">{initials(p)}</div>
          <SheetTitle>Your profile</SheetTitle>
          <SheetDescription>Saved on this device only.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8">
          <div>
            <label htmlFor="pf-name" className="mb-1.5 block text-sm font-medium">Name</label>
            <div className="flex gap-2">
              <input id="pf-name" value={p.name} onChange={(e) => setProfile({ ...p, name: e.target.value })} placeholder="Crew A" autoComplete="name" className={field} />
              <Mic label="Say your name" onText={(t) => setProfile({ ...p, name: t })} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium">Role</div>
            <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={p.role === r} onClick={() => setProfile({ ...p, role: r })}
                  className={cn('h-10 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors', p.role === r ? 'bg-foreground text-background ring-foreground' : 'ring-border hover:bg-accent')}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium">Look</div>
            <Seg<Theme> label="Theme" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </div>
          <div className="space-y-2">
            <Button variant="outline" className="h-12 w-full justify-between rounded-md" onClick={() => to('ask')}>
              <span>AI assistant: <b>{ENGINE_LABEL[p.engine]}</b></span><ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" className="h-12 w-full justify-between rounded-md" onClick={() => to('body')}>
              Your alert limits<ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" className="h-12 w-full justify-between rounded-md" onClick={() => to('report')}>
              Daily report<ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
