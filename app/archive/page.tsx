import { listPublishedIssues } from "@/lib/queries";
import Link from "next/link";

export const revalidate = 3600;

export default async function ArchivePage() {
  const issues = await listPublishedIssues();

  return (
    <main>
      <header className="border-b-2 border-ink py-4 px-7 flex justify-between items-end max-md:px-5">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-wider text-muted hover:text-red transition-colors"
        >
          ← Back home
        </Link>
        <div className="font-display font-black text-[28px] tracking-tight text-center max-md:text-[22px]">
          <span className="italic font-normal text-lg mr-1 text-muted">The</span>
          NYC Hype Index
        </div>
        <div className="w-[150px] max-md:hidden" />
      </header>

      <section className="hero py-20 px-7 border-b border-ink text-center relative overflow-hidden max-md:py-14 max-md:px-5">
        <span className="inline-block font-mono text-[11px] uppercase tracking-widest text-red mb-7 border border-red px-3.5 py-1.5 rounded-full bg-red/5">
          The Archive
        </span>
        <h1 className="font-display font-black text-[clamp(54px,9vw,132px)] leading-[0.92] tracking-tighter mx-auto max-w-[14ch]">
          Every issue, <em className="italic font-normal text-red">forever</em>.
        </h1>
      </section>

      <section className="px-7 py-16 max-w-3xl mx-auto max-md:px-5 max-md:py-12">
        {issues.length === 0 ? (
          <div className="text-center py-20">
            <div className="font-display text-6xl text-muted opacity-40 mb-4">∅</div>
            <p className="font-display italic text-2xl text-ink-soft">No published issues yet.</p>
          </div>
        ) : (
          <div>
            {issues.map((iss) => (
              <div
                key={iss.number}
                className="grid grid-cols-[100px_1fr] gap-6 py-7 border-b border-ink/15 items-baseline"
              >
                <div className="font-display font-extrabold text-4xl tracking-tighter text-red">
                  №{iss.number}
                </div>
                <div className="font-display text-2xl tracking-tight max-md:text-xl">
                  Week of{" "}
                  <em className="italic font-normal">
                    {new Date(iss.published_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </em>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
