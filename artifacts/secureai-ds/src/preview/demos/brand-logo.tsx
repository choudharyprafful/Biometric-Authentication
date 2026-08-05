import logoUrl from '../../assets/logo.svg';

export function BrandLogoDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold font-mono tracking-widest uppercase text-sm">Brand mark</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The SecureAI shield — used in the app header and favicon. Always use
            on a dark background; the mark is a single-colour cyan path.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex h-40 items-center justify-center rounded border bg-background">
            <img src={logoUrl} alt="SecureAI logo" className="h-16 w-16" />
          </div>
          <div className="flex h-40 items-center justify-center rounded border border-border bg-card">
            <div className="flex flex-col items-center gap-2">
              <img src={logoUrl} alt="SecureAI logo" className="h-10 w-10" />
              <span className="font-mono text-xs tracking-[0.25em] uppercase text-muted-foreground">
                Identity Verification
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="font-semibold font-mono tracking-widest uppercase text-sm">Usage rules</h2>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
          <li>Always place the mark on the dark navy background (#070c18) or card surface (#09101e).</li>
          <li>Never recolour the mark — it is always Electric Cyan (#04d9ee).</li>
          <li>Minimum clear space: half the mark height on all sides.</li>
          <li>Never distort, rotate, or apply drop-shadows to the mark.</li>
          <li>Pair with the wordmark in JetBrains Mono, uppercase, wide tracking (tracking-[0.25em]).</li>
        </ul>
      </section>
    </div>
  );
}
