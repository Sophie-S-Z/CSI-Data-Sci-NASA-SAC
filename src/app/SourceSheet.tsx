import { ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import rules from '../data/rules.json';
import { resolveSource, sources } from './sources';
import { Prov } from './parts';

/**
 * Source panel (FR-06). Each threshold on screen opens this panel: the value, the
 * citation, the evidence level, and a flag when the value is a team value.
 */
export function SourceSheet({ k, onClose }: { k: string | null; onClose: () => void }) {
  const views = k ? resolveSource(k) : [];
  return (
    <Sheet open={k !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Source</SheetTitle>
          <SheetDescription>Where this value comes from, and how strong the evidence is.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {k && views.length === 0 && <p className="text-sm">No source entry for {k}.</p>}
            {views.map((v, i) => {
              const src = sources[v.sourceKey];
              return (
                <section key={i} className="rounded-md bg-muted/50 p-4 ring-1 ring-border">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 text-sm font-semibold">{v.title}</h3>
                    {v.team ? <Prov kind="team" /> : <Prov kind={v.sourceKey === 'rad2012' || v.sourceKey === 'phase4' ? 'measured' : 'standard'}>{v.sourceKey === 'rad2012' || v.sourceKey === 'phase4' ? 'Measured data' : 'Published'}</Prov>}
                  </div>
                  {v.value && <p className="num mt-2 text-[15px] font-medium">{v.value}</p>}
                  {v.team && <p className="mt-2 text-xs text-muted-foreground">Team value for the demo. Not a NASA flight rule.</p>}
                  {v.basis && <p className="mt-2 text-sm leading-relaxed">{v.basis}</p>}
                  {v.formula && <p className="mt-2 rounded-md bg-card p-2 font-mono text-xs">{v.formula}</p>}
                  <p className="mt-3 text-sm"><span className="font-medium">Citation.</span> {src?.citation}</p>
                  {src?.url && <a href={src.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Open the source <ExternalLink className="size-3.5" aria-hidden="true" /></a>}
                  <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium">Evidence.</span> {v.evidence}</p>
                </section>
              );
            })}
            <p className="text-xs text-muted-foreground">All thresholds are in rules.json ({rules.version}). The Science owner can change a value with no code change.</p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
