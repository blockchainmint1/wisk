import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import changelogMd from "../../CHANGELOG.md?raw";

export const Route = createFileRoute("/change-log")({
  head: () => ({
    meta: [
      { title: "Changelog — TEXIT Runner" },
      {
        name: "description",
        content: "A running log of changes, fixes, and new features for the TEXIT Runner swap platform.",
      },
    ],
  }),
  component: ChangelogPage,
});

function ChangelogPage() {
  const sections = parseChangelog(changelogMd);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-12 md:py-20">
        <div className="mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Protocol Updates
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Change <span className="text-accent">Log</span>
          </h1>
        </div>

        <div className="space-y-16">
          {sections.map((section) => (
            <section key={section.date}>
              <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-accent mb-6 pb-2 border-b border-border">
                {section.date}
              </h2>
              <ul className="space-y-6">
                {section.entries.map((entry, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    <div className="flex items-start gap-3">
                      <span className="mt-1.5 size-1.5 rounded-full bg-accent shrink-0" />
                      <div className="space-y-1">
                        <p className="text-foreground">{entry.title}</p>
                        {entry.body.map((line, j) => (
                          <p key={j} className="text-muted-foreground">
                            {renderBold(line)}
                          </p>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-border">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 font-mono uppercase tracking-widest"
          >
            ← Back Home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

interface Section {
  date: string;
  entries: Entry[];
}

interface Entry {
  title: string;
  body: string[];
}

function parseChangelog(raw: string): Section[] {
  const lines = raw.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let currentEntry: Entry | null = null;
  let inHowTo = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## How to use this log")) {
      inHowTo = true;
      continue;
    }
    if (inHowTo) continue;

    if (trimmed.startsWith("## ")) {
      const date = trimmed.replace("## ", "").trim();
      currentSection = { date, entries: [] };
      sections.push(currentSection);
      currentEntry = null;
      continue;
    }

    if (!currentSection) continue;

    if (trimmed.startsWith("- **")) {
      const titleMatch = trimmed.match(/^- \*\*(.+)\*\*\.?\s*(.*)$/);
      const title = titleMatch ? titleMatch[1] + (titleMatch[2] ? ". " + titleMatch[2] : "") : trimmed;
      currentEntry = { title, body: [] };
      currentSection.entries.push(currentEntry);
      continue;
    }

    if (trimmed.startsWith("- ") && currentEntry) {
      // Continuation of a multi-line bullet (indented continuation from markdown)
      // The original markdown uses hanging indents, so lines after a bullet
      // that don't start with `- ` are part of the same bullet.
      // Here we treat a fresh `- ` as a new entry if it has `**`
      if (trimmed.startsWith("- **")) {
        const titleMatch = trimmed.match(/^- \*\*(.+)\*\*\.?\s*(.*)$/);
        const title = titleMatch ? titleMatch[1] + (titleMatch[2] ? ". " + titleMatch[2] : "") : trimmed;
        currentEntry = { title, body: [] };
        currentSection.entries.push(currentEntry);
      } else {
        currentEntry.title += " " + trimmed.replace("- ", "").trim();
      }
      continue;
    }

    if (trimmed.startsWith("- ") && !currentEntry) {
      // A list item before any date section; skip
      continue;
    }

    if (trimmed && currentEntry) {
      currentEntry.body.push(trimmed);
    }
  }

  return sections;
}
