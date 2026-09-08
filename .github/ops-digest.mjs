// Weekly Ops Digest — runs in GitHub Actions (.github/workflows/ops-digest.yml).
//
// Every Monday morning, after the three scans have run, this collects what they found
// (open issues labeled dsma-scan / coverage-scan / this-weekend-freshness) plus the
// standing weekly to-do list, and emails Jason ONE digest. It replaces the
// "GitHub issues nobody reads" pattern with a single email he actually sees.
//
// Heartbeat: it emails every Monday even when nothing was flagged, so a broken job
// can't hide as a quiet week.
//
// Delivery reuses the newsletter's Buttondown key (no new secret): it creates a draft,
// sends a preview of it to Jason (send-draft delivers to any address), then deletes the
// throwaway draft so the San Mateo Local newsletter account stays clean.
//
// Run locally with no key to print the digest (a safe dry run):
//   GITHUB_TOKEN=$(gh auth token) node .github/ops-digest.mjs

const PREVIEW_TO = 'regino.jason@gmail.com';
const BD_KEY = process.env.BUTTONDOWN_API_KEY || '';
const BD_API = 'https://api.buttondown.com/v1/emails';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'jasonregino/san-mateo-local';

const SECTIONS = [
  { label: 'dsma-scan', heading: 'New downtown businesses to review (DSMA)' },
  { label: 'coverage-scan', heading: 'Missing businesses to review (coverage scan)' },
  { label: 'this-weekend-freshness', heading: 'Homepage "This Weekend" lead' },
];

async function openIssues(label) {
  if (!GH_TOKEN) return [];
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=open&labels=${label}&per_page=20`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ops-digest' } },
    );
    if (!r.ok) return [];
    const arr = await r.json();
    return (Array.isArray(arr) ? arr : [])
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, url: i.html_url, created: i.created_at }));
  } catch { return []; }
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

function buildDigest(found) {
  const total = found.reduce((n, s) => n + s.issues.length, 0);
  const L = [];
  L.push('Hi Jason,', '');
  L.push(total
    ? `Here's your San Mateo Local week. ${total} item${total === 1 ? '' : 's'} the weekly scans flagged for you, plus your standing checklist.`
    : "Here's your San Mateo Local week. The scans flagged nothing new, so it's just your standing checklist below.");
  L.push('');

  L.push('## What the scans found');
  for (const s of found) {
    L.push(`### ${s.heading}`);
    if (s.issues.length) {
      for (const it of s.issues) L.push(`- [${it.title}](${it.url}) · flagged ${fmtDate(it.created)}`);
    } else {
      L.push('- Nothing flagged this week.');
    }
    L.push('');
  }

  L.push('## Your weekly to-do');
  L.push('- Review and approve any new businesses flagged above');
  L.push('- Write the new "This Weekend" homepage lead if it was flagged as stale');
  L.push('- Thursday: review the newsletter preview and click Send if it looks good');
  L.push('- Review any community Best-Of submissions in the suggest.html queue');
  L.push('');

  L.push('## Where to look');
  L.push(`- Full detail on any item: https://github.com/${REPO}/issues`);
  L.push(`- Job runs: https://github.com/${REPO}/actions`);
  L.push('');
  L.push('That is the week. Nothing here sends or changes anything on its own.');
  return { subject: `San Mateo Local — your week (${total} to review)`, body: L.join('\n') };
}

// --- Run ---------------------------------------------------------------------------
const found = [];
for (const s of SECTIONS) found.push({ ...s, issues: await openIssues(s.label) });

const { subject, body } = buildDigest(found);
const total = found.reduce((n, s) => n + s.issues.length, 0);
console.log(`Ops digest assembled: ${total} flagged item(s) across ${SECTIONS.length} scans.`);

if (!BD_KEY) {
  console.log('\nNo BUTTONDOWN_API_KEY set — dry run. Digest below.\n');
  console.log('SUBJECT: ' + subject + '\n');
  console.log(body);
  process.exit(0);
}

// Create a throwaway draft, preview it to Jason, then delete the draft.
let draftId;
try {
  const r = await fetch(BD_API, {
    method: 'POST',
    headers: { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, body, status: 'draft' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Draft create failed:', r.status, JSON.stringify(j)); process.exit(1); }
  draftId = j.id;
  console.log('Digest draft created:', draftId);
} catch (e) { console.error('Draft create error:', e.message); process.exit(1); }

try {
  const r = await fetch(`${BD_API}/${draftId}/send-draft`, {
    method: 'POST',
    headers: { Authorization: `Token ${BD_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [PREVIEW_TO] }),
  });
  if (!r.ok) { console.error('Preview send failed:', r.status, await r.text()); process.exit(1); }
  console.log(`Digest emailed to ${PREVIEW_TO}.`);
} catch (e) { console.error('Preview send error:', e.message); process.exit(1); }

// Clean up: the digest is an internal email, not a newsletter issue, so remove the draft.
try {
  const r = await fetch(`${BD_API}/${draftId}`, {
    method: 'DELETE',
    headers: { Authorization: `Token ${BD_KEY}` },
  });
  console.log(r.ok ? 'Throwaway draft deleted (account stays clean).' : `Note: draft not deleted (${r.status}); harmless, can clear later.`);
} catch (e) { console.log('Note: draft delete errored (harmless):', e.message); }
