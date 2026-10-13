// Markdown note -> teleprompter script.
//   # Title                      -> script name (not read out)
//   ## Slide 3, Why now (0:30)   -> [Slide 3 · Why now · 0:30] section label
//   > notes, frontmatter, code, tables, rules, (stage directions in italics) -> dropped
//   **bold**, _italic_, `code`, [links](url), [[wiki|links]] -> plain text
// Works with Obsidian notes as well as any other Markdown file.

(function (root) {
  function inline(s) {
    return s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // images
      .replace(/!\[\[[^\]]*\]\]/g, '')                      // embeds
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')        // [[note|alias]]
      .replace(/\[\[([^\]]+)\]\]/g, '$1')                   // [[note]]
      .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')          // [text](url)
      .replace(/<[^>]+>/g, '')                              // html tags
      .replace(/(\*\*|__)(.+?)\1/g, '$2')                   // bold
      .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1$2') // *italic*
      .replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1$2')  // _italic_
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/==(.+?)==/g, '$1')                          // ==highlight==
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+$/, '');
  }

  // "Slide 3, Why this matters now (0:30)" -> "Slide 3 · Why this matters now · 0:30"
  function heading(text) {
    let t = inline(text).trim();
    let time = '';
    const m = t.match(/\s*\((\d{1,2}:\d{2})(?:\s*(?:to|-|–)\s*\d{1,2}:\d{2})?\)\s*$/);
    if (m) { time = m[1]; t = t.slice(0, m.index).trim(); }
    const slide = t.match(/^(slide\s+\d+)\s*[,:.\-–]\s*(.+)$/i);
    const parts = slide ? [slide[1], slide[2]] : [t];
    if (time) parts.push(time);
    return '[' + parts.join(' · ').replace(/[[\]]/g, '') + ']';
  }

  function convert(md, fallbackName) {
    let text = md.replace(/\r\n?/g, '\n');
    text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');      // frontmatter
    let name = fallbackName || 'Imported script';
    const out = [];
    let fence = false;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      if (/^\s*>/.test(line)) continue;                       // blockquotes / callouts = notes
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;  // horizontal rules
      if (/^\s*\|/.test(line)) continue;                      // tables
      if (/^\s*%%/.test(line)) continue;                      // obsidian comments
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        if (h[1].length === 1 && name === (fallbackName || 'Imported script') && !out.some(Boolean)) { name = inline(h[2]).trim(); continue; }
        out.push('', heading(h[2]));
        continue;
      }
      // A whole line in italics that starts with "(" is a stage direction, not script.
      if (/^\s*[*_]\(.*\)[*_]\s*$/.test(line)) continue;
      const item = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
      out.push(inline(item));
    }
    // Headings sit directly above their first paragraph; collapse extra blank lines.
    const script = out.join('\n')
      .replace(/(\[[^\]\n]+\])\n\s*\n/g, '$1\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { name, script };
  }

  const api = { convert, heading, inline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OnTopMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
