import { COPY_PASTE_LIMITS, detectCopyPaste, parseCopyPasteInput, safePostUrl } from '@/services/copy-paste-detector';

let nextId = 0;

/** A deliberately local import: the dashboard feeds do not carry account age/follower metadata. */
export function createCopyPasteCheck(): HTMLElement {
  const root = document.createElement('details');
  root.className = 'copy-paste-check';
  const summary = document.createElement('summary');
  summary.textContent = 'Check copied social posts';
  root.append(summary);

  const intro = document.createElement('p');
  intro.textContent = 'Paste public post data to check it on this device. This tool does not collect posts, monitor accounts, or send or save your input. Account details are supplied by you, not independently verified.';
  root.append(intro);
  const rules = document.createElement('p');
  rules.textContent = 'Flags at least 5 distinct accounts posting near-identical text within 30 minutes. Each account must be at most 30 days old when posting, or have fewer than 100 followers. Text needs at least 12 words and 90% matching word triplets. Unknown account details stay unassessed.';
  root.append(rules);

  const id = `copy-paste-input-${++nextId}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Post data (JSON array, up to 500 posts)';
  const input = document.createElement('textarea');
  input.id = id;
  input.rows = 6;
  input.maxLength = COPY_PASTE_LIMITS.inputCharacters;
  input.spellcheck = false;
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.placeholder = '[{"platform":"x","accountId":"example","text":"Full public post text…","postedAt":"2026-01-01T12:00:00Z","accountCreatedAt":null,"followers":null}]';
  root.append(label, input);
  const help = document.createElement('p');
  help.id = `${id}-help`;
  help.textContent = 'Use ISO timestamps with a time zone, or epoch milliseconds. Omit accountCreatedAt or followers (or use null) when unknown. Optional url must be an http(s) link. Use stable account IDs; do not paste credentials or private data.';
  input.setAttribute('aria-describedby', help.id);
  root.append(help);

  const example = document.createElement('details');
  const exampleLabel = document.createElement('summary');
  exampleLabel.textContent = 'JSON format example (fictional, not a live report)';
  const code = document.createElement('pre');
  code.style.whiteSpace = 'pre-wrap';
  code.style.overflowWrap = 'anywhere';
  code.textContent = JSON.stringify([{
    platform: 'example', accountId: 'account-1',
    text: 'Example claim only: the local demonstration service is temporarily unavailable while scheduled work is completed.',
    postedAt: '2026-01-01T12:00:00Z', accountCreatedAt: '2025-12-25T12:00:00Z', followers: 12,
    url: 'https://example.com/post/1',
  }], null, 2);
  example.append(exampleLabel, code);
  root.append(example);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Check pasted posts';
  const output = document.createElement('div');
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-atomic', 'true');
  root.append(button, output);
  button.addEventListener('click', () => {
    output.replaceChildren();
    const parsed = parseCopyPasteInput(input.value);
    input.setAttribute('aria-invalid', String(!parsed.ok));
    if (!parsed.ok) { output.textContent = parsed.error; return; }
    const result = detectCopyPaste(parsed.posts);
    const status = document.createElement('p');
    status.textContent = `${result.postCount} posts checked. ${result.flags.length ? `${result.flags.length} repeated-text group${result.flags.length === 1 ? '' : 's'} flagged.` : 'No group meets these thresholds in the pasted data.'} ${result.unassessedPosts} posts lack enough account information to assess. ${result.shortPosts} qualifying posts have too little text to compare.`;
    output.append(status);
    for (const flag of result.flags) {
      const item = document.createElement('p');
      item.textContent = `${flag.accountCount} distinct new or low-follower accounts posted similar text from ${new Date(flag.firstPostedAt).toISOString()} to ${new Date(flag.lastPostedAt).toISOString()}.`;
      const quotation = document.createElement('blockquote');
      quotation.textContent = flag.posts[0]!.text;
      output.append(item, quotation);
      const sources = document.createElement('ul');
      for (const post of flag.posts) {
        const row = document.createElement('li');
        const url = post.url ? safePostUrl(post.url) : null;
        const source = document.createElement(url ? 'a' : 'span');
        source.textContent = `${post.platform}: ${post.accountId}`;
        if (source instanceof HTMLAnchorElement && url) {
          source.href = url;
          source.target = '_blank';
          source.rel = 'noopener noreferrer';
        }
        row.append(source);
        sources.append(row);
      }
      output.append(sources);
    }
    const caveat = document.createElement('p');
    caveat.textContent = 'A flag shows repeated wording, not proof of falsehood or coordination. No flag does not verify a claim. Check the linked official sources and reporting before sharing.';
    output.append(caveat);
  });
  return root;
}
